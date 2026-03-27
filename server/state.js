/**
 * state.js — Persistent server state (display titles, locked sessions, idle expiry, origin CWDs).
 * Shared across routes and AI title modules.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const IDLE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 1 day

// Display titles: tmuxName → { title, manuallyRenamed, lastGenAt, lastLineCount }
const displayTitles = new Map();
const titlesPath = path.join(dataDir, 'display-titles.json');
try {
  const saved = JSON.parse(fs.readFileSync(titlesPath, 'utf8'));
  for (const [k, v] of Object.entries(saved)) displayTitles.set(k, v);
} catch { /* no saved titles */ }

function saveTitles() {
  try {
    fs.writeFileSync(titlesPath, JSON.stringify(Object.fromEntries(displayTitles), null, 2));
  } catch { /* ignore */ }
}

// Locked sessions: Set of session names protected from UI deletion
const lockedSessions = new Set();
const lockedPath = path.join(dataDir, 'locked-sessions.json');
try {
  const saved = JSON.parse(fs.readFileSync(lockedPath, 'utf8'));
  for (const name of saved) lockedSessions.add(name);
} catch { /* no saved locks */ }

function saveLocks() {
  try {
    fs.writeFileSync(lockedPath, JSON.stringify([...lockedSessions]));
  } catch { /* ignore */ }
}

// Idle expiry: tmuxName → expiresAt (epoch ms). Tracks when idle sessions will be auto-killed.
const idleExpiry = new Map();
const expiryPath = path.join(dataDir, 'idle-expiry.json');
try {
  const saved = JSON.parse(fs.readFileSync(expiryPath, 'utf8'));
  for (const [k, v] of Object.entries(saved)) idleExpiry.set(k, v);
} catch { /* no saved expiry */ }

function saveExpiry() {
  try {
    fs.writeFileSync(expiryPath, JSON.stringify(Object.fromEntries(idleExpiry), null, 2));
  } catch { /* ignore */ }
}

// Origin CWDs: tmuxName → absolute path where the session was created
const originCwds = {};
const cwdsPath = path.join(dataDir, 'origin-cwds.json');
try {
  Object.assign(originCwds, JSON.parse(fs.readFileSync(cwdsPath, 'utf8')));
} catch { /* no saved cwds */ }

function saveOriginCwds() {
  try {
    fs.writeFileSync(cwdsPath, JSON.stringify(originCwds, null, 2));
  } catch { /* ignore */ }
}

// Shell names for bulk-kill "no running commands" filter
const SHELL_NAMES = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'nu', 'pwsh', 'login']);

// Annotate session list with web client count, display title, lock status, and expiry
function annotateSessions(sessionList, getClientCount) {
  const activeNames = new Set();
  let expiryChanged = false;

  for (const s of sessionList) {
    activeNames.add(s.name);
    s.webClients = getClientCount(s.name);
    const dt = displayTitles.get(s.name);
    if (dt && dt.title) s.displayTitle = dt.title;
    s.locked = lockedSessions.has(s.name);

    // Determine if session is idle: detached, no web clients, only shells, not locked
    const isIdle = s.attached === 0
      && (s.webClients || 0) === 0
      && !s.locked
      && s.panes && s.panes.every(p => SHELL_NAMES.has(p.command));

    if (isIdle) {
      if (!idleExpiry.has(s.name)) {
        idleExpiry.set(s.name, Date.now() + IDLE_EXPIRY_MS);
        expiryChanged = true;
      }
      s.expiresAt = idleExpiry.get(s.name);
    } else if (idleExpiry.has(s.name)) {
      idleExpiry.delete(s.name);
      expiryChanged = true;
    }
  }

  // Clean up expiry entries for sessions that no longer exist
  for (const name of [...idleExpiry.keys()]) {
    if (!activeNames.has(name)) { idleExpiry.delete(name); expiryChanged = true; }
  }

  if (expiryChanged) saveExpiry();
}

// Auto-kill expired idle sessions (checks every 5 minutes)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [name, expiresAt] of [...idleExpiry.entries()]) {
    if (expiresAt > now) continue;
    execFile('tmux', ['kill-session', '-t', name], { timeout: 5000 }, () => {});
    idleExpiry.delete(name);
    displayTitles.delete(name);
    changed = true;
  }
  if (changed) { saveExpiry(); saveTitles(); }
}, 5 * 60 * 1000);

module.exports = {
  displayTitles,
  saveTitles,
  lockedSessions,
  saveLocks,
  originCwds,
  saveOriginCwds,
  SHELL_NAMES,
  annotateSessions,
};
