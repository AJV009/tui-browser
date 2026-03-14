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
const express = require('express');
const { WebSocketServer } = require('ws');
const discovery = require('./discovery');
const sessions = require('./session-manager');
const kittyDiscovery = require('./kitty-discovery');

const PORT = parseInt(process.env.PORT || process.argv[2], 10) || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));

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

app.post('/api/sessions/:name/rename', apiHandler(async (req, res) => {
  const { newName } = req.body || {};
  if (!newName || !newName.trim()) {
    return res.status(400).json({ error: 'New name is required' });
  }
  await sessions.renameSession(req.params.name, newName.trim());
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

      if (json.type === 'input' && json.data != null) {
        if (attached) {
          sessions.writeInput(sessionName, json.data);
        }
        return;
      }
    } catch {
      // Not JSON — treat as raw terminal input (for simpler clients)
    }

    if (attached) {
      sessions.writeInput(sessionName, str);
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
