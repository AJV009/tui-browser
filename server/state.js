/**
 * state.js — Persistent server state (display titles, locked sessions).
 * Shared across routes and AI title modules.
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

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

// Shell names for bulk-kill "no running commands" filter
const SHELL_NAMES = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'nu', 'pwsh', 'login']);

// Annotate session list with web client count, display title, and lock status
function annotateSessions(sessionList, getClientCount) {
  for (const s of sessionList) {
    s.webClients = getClientCount(s.name);
    const dt = displayTitles.get(s.name);
    if (dt && dt.title) s.displayTitle = dt.title;
    s.locked = lockedSessions.has(s.name);
  }
}

module.exports = {
  displayTitles,
  saveTitles,
  lockedSessions,
  saveLocks,
  SHELL_NAMES,
  annotateSessions,
};
