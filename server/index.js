#!/usr/bin/env node
/**
 * TUI Browser Server — HTTP + WebSocket
 *
 * Serves the web frontend and provides:
 *   REST API:  /api/sessions (CRUD)
 *   WebSocket: /ws/terminal/:sessionName (terminal I/O)
 */

const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const discovery = require('./discovery');
const sessions = require('./session-manager');
const kittyDiscovery = require('./kitty-discovery');
const { exec: run } = require('./exec-util');

const PORT = parseInt(process.env.PORT || process.argv[2], 10) || 3000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || PORT + 1;
const PKG_VERSION = require('../package.json').version;              // e.g. "2.0.0"
const BUILD_ID = Date.now().toString(36);                            // changes on each restart
const FULL_VERSION = `${PKG_VERSION.replace(/\.\d+$/, '')}.${BUILD_ID}`; // e.g. "2.0.m4x7k9a"

// ---------- AI Title Generation ----------

// Check if claude CLI is available (check common paths since systemd has minimal PATH)
let claudeAvailable = false;
let claudePath = null;
const fs = require('fs');
const candidatePaths = [
  process.env.HOME + '/.local/bin/claude',
  '/usr/local/bin/claude',
  '/usr/bin/claude',
];
for (const p of candidatePaths) {
  try { if (fs.existsSync(p)) { claudePath = p; claudeAvailable = true; break; } } catch { /* skip */ }
}
if (!claudeAvailable) {
  try { execSync('which claude', { stdio: 'ignore' }); claudePath = 'claude'; claudeAvailable = true; } catch { /* not installed */ }
}

// Display titles: tmuxName → { title, manuallyRenamed, lastGenAt, lastLineCount }
// Persisted to disk so titles survive server restarts
const displayTitles = new Map();
const titlesPath = path.join(__dirname, '..', 'data', 'display-titles.json');
try {
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
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
const lockedPath = path.join(__dirname, '..', 'data', 'locked-sessions.json');
try {
  const saved = JSON.parse(fs.readFileSync(lockedPath, 'utf8'));
  for (const name of saved) lockedSessions.add(name);
} catch { /* no saved locks */ }

function saveLocks() {
  try {
    fs.writeFileSync(lockedPath, JSON.stringify([...lockedSessions]));
  } catch { /* ignore */ }
}

function extractContext(fullOutput) {
  const lines = fullOutput.split('\n');

  // Find the last command prompt (search backwards)
  let lastPromptIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*[\$%#❯>]\s/.test(lines[i]) || /[\$%#❯>]\s/.test(lines[i])) {
      lastPromptIdx = i;
      break;
    }
  }

  // Extract from last prompt to end (or all lines if no prompt found)
  let contextLines = lastPromptIdx >= 0 ? lines.slice(lastPromptIdx) : lines;

  // Smart truncation: first 150 + last 150
  if (contextLines.length > 300) {
    const first = contextLines.slice(0, 150);
    const last = contextLines.slice(-150);
    contextLines = [...first, '--- [middle truncated] ---', ...last];
  }

  return contextLines.join('\n').trim();
}

function runClaudeForTitle(context) {
  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, ['-p', '--model', 'haiku', '--no-session-persistence'], {
      timeout: 30000,
      env: { ...process.env },
    });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('claude exited with code ' + code));
      const title = stdout.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '-').replace(/[.:]/g, '-').slice(0, 40);
      resolve(title);
    });
    proc.stdin.write(`Analyze this terminal output and generate a concise session title.
Rules:
- Maximum 30 characters
- Format: "Action: Focus" (e.g. "Debug: Auth API", "Build: Dashboard")
- Return ONLY the title text, nothing else
- If unclear, use the working directory or main command name

Terminal output:
${context}`);
    proc.stdin.end();
  });
}

async function generateTitle(sessionName, force = false) {
  if (!claudeAvailable) throw new Error('claude CLI not available');

  const state = displayTitles.get(sessionName);
  if (state && state.manuallyRenamed && !force) {
    return { skipped: true, reason: 'manually renamed' };
  }

  // Capture scrollback
  const raw = await run('tmux', ['capture-pane', '-t', sessionName, '-p', '-S', '-']);
  const lineCount = raw.split('\n').filter(l => l.trim()).length;
  const context = extractContext(raw);
  if (!context || context.length < 20) {
    return { skipped: true, reason: 'not enough output' };
  }

  const title = await runClaudeForTitle(context);
  if (!title) throw new Error('empty title from claude');

  // Store as display title — tmux session name stays unchanged
  displayTitles.set(sessionName, { title, manuallyRenamed: false, lastGenAt: Date.now(), lastLineCount: lineCount });
  saveTitles();

  return { title, sessionName };
}

// Background auto-title: check every 60s
// - First title: after 15 lines of output and session > 30s old
// - Re-title: every 5 minutes if output has grown by 15+ lines since last title
// - Never touch manually renamed sessions
setInterval(async () => {
  if (!claudeAvailable) return;
  try {
    const sessionList = await discovery.listSessions();
    for (const s of sessionList) {
      const state = displayTitles.get(s.name);
      if (state && state.manuallyRenamed) continue;

      try {
        const raw = await run('tmux', ['capture-pane', '-t', s.name, '-p', '-S', '-']);
        const lineCount = raw.split('\n').filter(l => l.trim()).length;

        if (!state) {
          // Never titled — first-time trigger
          if (lineCount < 15 || Date.now() - s.created < 30000) continue;
        } else {
          // Already titled — re-title after 5min cooldown + 300 new lines
          if (Date.now() - state.lastGenAt < 300000) continue;
          if (lineCount - (state.lastLineCount || 0) < 300) continue;
        }

        await generateTitle(s.name, false);
      } catch { /* skip this session */ }
    }
  } catch { /* ignore */ }
}, 60000);

const app = express();
app.use(express.json());
// CORS — allow cross-origin requests from tunnel domain to local IP (and vice versa)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use((req, res, next) => {
  // HTML, SW, and manifest must never be cached by Cloudflare
  const p = req.path;
  if (p === '/' || p.endsWith('.html') || p.endsWith('sw.js') || p.endsWith('manifest.json')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Helpers ----------

function apiHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

function annotateSessions(sessionList) {
  for (const s of sessionList) {
    s.webClients = sessions.getClientCount(s.name);
    const dt = displayTitles.get(s.name);
    if (dt && dt.title) s.displayTitle = dt.title;
    s.locked = lockedSessions.has(s.name);
  }
}

// ---------- Helpers ----------

function getLocalIPs() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    }
  }
  return ips;
}

// ---------- REST API ----------

app.get('/api/version', (_req, res) => {
  res.json({ version: FULL_VERSION, startedAt: parseInt(BUILD_ID, 36), claudeAvailable });
});

app.get('/api/network', (_req, res) => {
  res.json({ localIPs: getLocalIPs(), httpsPort: HTTPS_PORT, httpPort: PORT });
});

app.get('/api/health', async (_req, res) => {
  const tmuxOk = await discovery.isTmuxAvailable();
  const serverOk = tmuxOk && (await discovery.isTmuxServerRunning());
  const kittyStatus = await kittyDiscovery.isKittyRemoteAvailable();
  res.json({ tmux: tmuxOk, server: serverOk, kitty: kittyStatus.available });
});

app.get('/api/sessions', apiHandler(async (_req, res) => {
  const list = await discovery.listSessions();
  annotateSessions(list);
  res.json(list);
}));

app.get('/api/sessions/:name', apiHandler(async (req, res) => {
  const detail = await discovery.getSessionDetail(req.params.name);
  if (!detail) return res.status(404).json({ error: 'Session not found' });
  detail.webClients = sessions.getClientCount(detail.name);
  const dt = displayTitles.get(detail.name);
  if (dt && dt.title) detail.displayTitle = dt.title;
  res.json(detail);
}));

app.post('/api/sessions', apiHandler(async (req, res) => {
  const { name, command, cwd } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Session name is required' });
  }
  if (cwd != null) {
    if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.includes('\0')) {
      return res.status(400).json({ error: 'Invalid cwd: must be an absolute path' });
    }
  }
  const result = await sessions.createSession(name.trim(), command || 'bash', 80, 24, cwd);
  res.status(201).json(result);
}));

app.delete('/api/sessions/:name', apiHandler(async (req, res) => {
  await sessions.killSession(req.params.name);
  res.json({ ok: true });
}));

const SHELL_NAMES = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'nu', 'pwsh', 'login']);

app.post('/api/sessions/bulk-kill', apiHandler(async (req, res) => {
  const { names, filter, inactiveMinutes } = req.body || {};
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'names array is required' });
  }
  if (names.length > 100) {
    return res.status(400).json({ error: 'Cannot kill more than 100 sessions at once' });
  }

  let targetNames = names.filter(n => !lockedSessions.has(n));

  // Server-side verification: re-check filter conditions before killing
  if (filter) {
    const currentSessions = await discovery.listSessions();
    annotateSessions(currentSessions);
    const requestedSet = new Set(names);

    targetNames = currentSessions
      .filter(s => requestedSet.has(s.name))
      .filter(s => {
        switch (filter) {
          case 'detached':
            return s.attached === 0 && (s.webClients || 0) === 0;
          case 'no-commands':
            return s.panes.every(p => SHELL_NAMES.has(p.command));
          case 'inactive': {
            const cutoffMs = Date.now() - (inactiveMinutes || 10) * 60 * 1000;
            return s.lastActivity < cutoffMs;
          }
          case 'all':
            return true;
          default:
            return false;
        }
      })
      .map(s => s.name);
  }

  const results = await Promise.allSettled(
    targetNames.map(name => sessions.killSession(name))
  );

  const killed = [];
  const failed = [];
  for (let i = 0; i < targetNames.length; i++) {
    if (results[i].status === 'fulfilled') {
      killed.push(targetNames[i]);
    } else {
      failed.push({ name: targetNames[i], error: results[i].reason?.message || 'unknown' });
    }
  }

  // Clean up display titles for killed sessions
  for (const name of killed) displayTitles.delete(name);
  if (killed.length > 0) saveTitles();

  res.json({ killed, failed });
}));

// Deprecated: Kitty discovery is now part of /api/discover unified response.
// Kept for debugging purposes.
app.get('/api/kitty/windows', apiHandler(async (_req, res) => {
  const result = await kittyDiscovery.discoverKittyWindows();
  res.json(result);
}));

// Unified discovery — tmux sessions + kitty windows in one call
app.get('/api/discover', apiHandler(async (_req, res) => {
  const result = await discovery.discoverAll();
  annotateSessions(result.sessions);
  res.json(result);
}));

app.get('/api/sessions/:name/info', apiHandler(async (req, res) => {
  const name = req.params.name;
  const { exec: run } = require('./exec-util');

  // Gather session + pane data in parallel
  const [sessionRaw, panesRaw] = await Promise.all([
    run('tmux', ['list-sessions', '-f', `#{==:#{session_name},${name}}`, '-F',
      '#{session_created}|#{session_activity}|#{session_attached}|#{session_windows}']),
    run('tmux', ['list-panes', '-t', name, '-F',
      '#{pane_index}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}|#{pane_width}|#{pane_height}|#{window_index}']),
  ]);

  if (!sessionRaw) return res.status(404).json({ error: 'Session not found' });
  const [created, activity, attached, windows] = sessionRaw.split('\n')[0].split('|');
  const panes = panesRaw.split('\n').filter(Boolean).map(line => {
    const [index, pid, command, cwd, width, height, winIdx] = line.split('|');
    return { index: +index, pid: +pid, command, cwd, width: +width, height: +height, window: +winIdx, processes: [] };
  });

  // Gather process trees for all panes in parallel
  await Promise.all(panes.map(async (pane) => {
    try {
      // Get the pane shell + all direct children in one shot
      const allPids = [String(pane.pid)];
      try {
        const children = await run('pgrep', ['-P', String(pane.pid)]);
        if (children) allPids.push(...children.split('\n').filter(Boolean));
      } catch { /* no children */ }

      const psOut = await run('ps', ['-p', allPids.join(','), '-o', 'pid,ppid,rss,%cpu,%mem,comm', '--no-headers']);
      pane.processes = psOut.split('\n').filter(Boolean).map(line => {
        const p = line.trim().split(/\s+/);
        return { pid: +p[0], ppid: +p[1], rss: +p[2], cpu: +p[3], mem: +p[4], command: p.slice(5).join(' ') };
      });
    } catch { /* process may have exited */ }
  }));

  // Totals
  const allProcs = panes.flatMap(p => p.processes);
  const totalMemory = allProcs.reduce((s, p) => s + p.rss, 0);
  const totalCpu = allProcs.reduce((s, p) => s + p.cpu, 0);

  // Recent scrollback (last 30 lines)
  let recentOutput = [];
  try {
    const raw = await run('tmux', ['capture-pane', '-t', name, '-p', '-S', '-30']);
    recentOutput = raw.split('\n');
  } catch { /* ignore */ }

  res.json({
    name,
    created: +created,
    lastActivity: +activity,
    attached: +attached,
    windows: +windows,
    panes,
    totalMemory,
    totalCpu,
    processCount: allProcs.length,
    recentOutput,
  });
}));

// ---------- Shortcuts CRUD ----------

const shortcutsPath = path.join(__dirname, '..', 'public', 'shortcuts.json');

app.post('/api/shortcuts', apiHandler(async (req, res) => {
  const { label, command } = req.body || {};
  if (!label || !command) return res.status(400).json({ error: 'label and command required' });

  let shortcuts = [];
  try { shortcuts = JSON.parse(require('fs').readFileSync(shortcutsPath, 'utf8')); } catch { /* empty or missing */ }

  // Avoid duplicates (same label + command)
  if (shortcuts.some(s => s.label === label && s.command === command)) {
    return res.json({ shortcuts });
  }

  shortcuts.push({ label, command });
  require('fs').writeFileSync(shortcutsPath, JSON.stringify(shortcuts, null, 2));
  res.json({ shortcuts });
}));

app.post('/api/sessions/:name/generate-title', apiHandler(async (req, res) => {
  const result = await generateTitle(req.params.name, true); // magic icon = always force
  res.json(result);
}));

app.post('/api/sessions/:name/open-terminal', apiHandler(async (req, res) => {
  sessions.openTerminal(req.params.name);
  res.json({ ok: true });
}));

app.post('/api/sessions/:name/rename', apiHandler(async (req, res) => {
  const { newName } = req.body || {};
  if (!newName || !newName.trim()) {
    return res.status(400).json({ error: 'New name is required' });
  }
  // Store as display title — tmux session name stays stable as the identifier
  displayTitles.set(req.params.name, { title: newName.trim(), manuallyRenamed: true, lastGenAt: Date.now(), lastLineCount: 0 });
  saveTitles();
  res.json({ ok: true });
}));

app.post('/api/sessions/:name/lock', apiHandler(async (req, res) => {
  const name = req.params.name;
  if (lockedSessions.has(name)) {
    lockedSessions.delete(name);
  } else {
    lockedSessions.add(name);
  }
  saveLocks();
  res.json({ locked: lockedSessions.has(name) });
}));

// ---------- HTTP + HTTPS + WebSocket ----------

const server = http.createServer(app);

// HTTPS server (for local network fast path — certs generated by scripts/generate-certs.sh)
let httpsServer = null;
const certPath = path.join(__dirname, '..', 'certs', 'server.crt');
const keyPath = path.join(__dirname, '..', 'certs', 'server.key');
try {
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    httpsServer = https.createServer({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    }, app);
  }
} catch (err) {
  console.warn('[server] HTTPS certs not found, local fast-path disabled. Run: scripts/generate-certs.sh');
}

const wss = new WebSocketServer({ noServer: true });

// Shared WebSocket upgrade handler for both HTTP and HTTPS
function handleWsUpgrade(req, socket, head) {
  const match = req.url.match(/^\/ws\/terminal\/(.+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const sessionName = decodeURIComponent(match[1]);
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, sessionName);
  });
}

server.on('upgrade', handleWsUpgrade);
if (httpsServer) httpsServer.on('upgrade', handleWsUpgrade);

wss.on('connection', (ws, sessionName) => {
  let cols = 80;
  let rows = 24;
  let attached = false;

  ws.on('message', (msg) => {
    const str = msg.toString();

    // Fast path: raw terminal input (most messages — no JSON overhead)
    if (attached && str.charCodeAt(0) !== 123 /* '{' */) {
      sessions.writeInput(sessionName, str);
      return;
    }

    // Slow path: JSON control messages (attach, resize, ping)
    try {
      const json = JSON.parse(str);

      if (json.type === 'resize' && json.cols && json.rows) {
        cols = json.cols;
        rows = json.rows;
        if (attached) {
          sessions.resize(sessionName, cols, rows);
        }
        return;
      }

      if (json.type === 'attach') {
        if (!attached) {
          cols = json.cols || cols;
          rows = json.rows || rows;
          sessions.attachClient(sessionName, ws, cols, rows);
          attached = true;
        }
        return;
      }

      if (json.type === 'ping') return;

      if (json.type === 'input' && json.data != null) {
        if (attached) {
          sessions.writeInput(sessionName, json.data);
        }
        return;
      }
    } catch {
      // Malformed JSON — treat as raw input
      if (attached) {
        sessions.writeInput(sessionName, str);
      }
    }
  });

  ws.on('close', () => {
    if (attached) {
      sessions.detachClient(sessionName, ws);
    }
  });
});

// ---------- Startup ----------

(async () => {
  const tmuxOk = await discovery.isTmuxAvailable();
  if (!tmuxOk) {
    console.error('ERROR: tmux is not installed.');
    console.error('Install it with: sudo apt install tmux  (or brew install tmux on macOS)');
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`TUI Browser listening on http://localhost:${PORT}`);
  });

  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, () => {
      const ips = getLocalIPs();
      console.log(`TUI Browser HTTPS on port ${HTTPS_PORT} (local fast-path)`);
      ips.forEach(ip => console.log(`  https://${ip}:${HTTPS_PORT}`));
    });
  }

  console.log('Open in your browser or on your phone.');

  function gracefulShutdown(signal) {
    console.log(`${signal} received — shutting down gracefully...`);
    sessions.shutdown();
    wss.close();
    server.close(() => {
      if (httpsServer) httpsServer.close();
      console.log('Server closed.');
      process.exit(0);
    });
    // Force exit after 5 seconds if graceful close hangs
    const forceTimer = setTimeout(() => {
      console.log('Forcing exit after timeout.');
      process.exit(1);
    }, 5000);
    forceTimer.unref();
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
})();
