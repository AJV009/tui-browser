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
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const discovery = require('./discovery');
const sessions = require('./session-manager');
const kittyDiscovery = require('./kitty-discovery');
const { exec: run } = require('./exec-util');

const PORT = parseInt(process.env.PORT || process.argv[2], 10) || 3000;
const PKG_VERSION = require('../package.json').version;              // e.g. "2.0.0"
const BUILD_ID = Date.now().toString(36);                            // changes on each restart
const FULL_VERSION = `${PKG_VERSION.replace(/\.\d+$/, '')}.${BUILD_ID}`; // e.g. "2.0.m4x7k9a"

// ---------- AI Title Generation ----------

// Check if claude CLI is available
let claudeAvailable = false;
try { execSync('which claude', { stdio: 'ignore' }); claudeAvailable = true; } catch { /* not installed */ }

// Track session title state: sessionName → { manuallyRenamed, lastGenAt }
const titleState = new Map();

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
    const proc = spawn('claude', ['-p', '--model', 'haiku', '--no-session-persistence'], {
      timeout: 30000,
      env: { ...process.env },
    });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('claude exited with code ' + code));
      const title = stdout.trim().replace(/^["']|["']$/g, '').slice(0, 40);
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

  const state = titleState.get(sessionName);
  if (state && state.manuallyRenamed && !force) {
    return { skipped: true, reason: 'manually renamed' };
  }

  // Capture scrollback
  const raw = await run('tmux', ['capture-pane', '-t', sessionName, '-p', '-S', '-']);
  const context = extractContext(raw);
  if (!context || context.length < 20) {
    return { skipped: true, reason: 'not enough output' };
  }

  const title = await runClaudeForTitle(context);
  if (!title) throw new Error('empty title from claude');

  // Rename the tmux session
  await run('tmux', ['rename-session', '-t', sessionName, title]);
  titleState.set(title, { manuallyRenamed: false, lastGenAt: Date.now() });
  // Clean old key
  if (title !== sessionName) titleState.delete(sessionName);

  return { title, oldName: sessionName };
}

// Background auto-title: check every 60s for untitled sessions
setInterval(async () => {
  if (!claudeAvailable) return;
  try {
    const sessionList = await discovery.listSessions();
    for (const s of sessionList) {
      const state = titleState.get(s.name);
      if (state) continue; // Skip sessions already titled (manually or by AI)

      // Check if session has enough output (> 15 lines)
      try {
        const raw = await run('tmux', ['capture-pane', '-t', s.name, '-p', '-S', '-']);
        const lineCount = raw.split('\n').filter(l => l.trim()).length;
        if (lineCount < 15) continue;

        // First-time: session must be > 30s old
        if (!state && Date.now() - s.created < 30000) continue;

        await generateTitle(s.name, false);
      } catch { /* skip this session */ }
    }
  } catch { /* ignore */ }
}, 60000);

const app = express();
app.use(express.json());
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

function annotateWebClients(sessionList) {
  for (const s of sessionList) s.webClients = sessions.getClientCount(s.name);
}

// ---------- REST API ----------

app.get('/api/version', (_req, res) => {
  res.json({ version: FULL_VERSION, startedAt: parseInt(BUILD_ID, 36), claudeAvailable });
});

app.get('/api/health', async (_req, res) => {
  const tmuxOk = await discovery.isTmuxAvailable();
  const serverOk = tmuxOk && (await discovery.isTmuxServerRunning());
  const kittyStatus = await kittyDiscovery.isKittyRemoteAvailable();
  res.json({ tmux: tmuxOk, server: serverOk, kitty: kittyStatus.available });
});

app.get('/api/sessions', apiHandler(async (_req, res) => {
  const list = await discovery.listSessions();
  annotateWebClients(list);
  res.json(list);
}));

app.get('/api/sessions/:name', apiHandler(async (req, res) => {
  const detail = await discovery.getSessionDetail(req.params.name);
  if (!detail) return res.status(404).json({ error: 'Session not found' });
  detail.webClients = sessions.getClientCount(detail.name);
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

// Deprecated: Kitty discovery is now part of /api/discover unified response.
// Kept for debugging purposes.
app.get('/api/kitty/windows', apiHandler(async (_req, res) => {
  const result = await kittyDiscovery.discoverKittyWindows();
  res.json(result);
}));

// Unified discovery — tmux sessions + kitty windows in one call
app.get('/api/discover', apiHandler(async (_req, res) => {
  const result = await discovery.discoverAll();
  annotateWebClients(result.sessions);
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
  const trimmed = newName.trim();
  await sessions.renameSession(req.params.name, trimmed);
  // Mark as manually renamed so auto-title skips it
  titleState.delete(req.params.name);
  titleState.set(trimmed, { manuallyRenamed: true, lastGenAt: Date.now() });
  res.json({ ok: true });
}));

// ---------- HTTP + WebSocket ----------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Upgrade HTTP → WebSocket for paths matching /ws/terminal/:sessionName
server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/ws\/terminal\/(.+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const sessionName = decodeURIComponent(match[1]);
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, sessionName);
  });
});

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
    console.log('Open this URL in your browser (or on your phone on the same network).');
  });

  function gracefulShutdown(signal) {
    console.log(`${signal} received — shutting down gracefully...`);
    sessions.shutdown();
    wss.close();
    server.close(() => {
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
