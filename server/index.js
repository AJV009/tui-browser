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

const PORT = parseInt(process.env.PORT || process.argv[2], 10) || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- REST API ----------

app.get('/api/health', async (_req, res) => {
  const tmuxOk = await discovery.isTmuxAvailable();
  const serverOk = tmuxOk && (await discovery.isTmuxServerRunning());
  res.json({ tmux: tmuxOk, server: serverOk });
});

app.get('/api/sessions', async (_req, res) => {
  try {
    const list = await discovery.listSessions();
    // annotate with web client counts
    for (const s of list) {
      s.webClients = sessions.getClientCount(s.name);
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:name', async (req, res) => {
  try {
    const detail = await discovery.getSessionDetail(req.params.name);
    if (!detail) return res.status(404).json({ error: 'Session not found' });
    detail.webClients = sessions.getClientCount(detail.name);
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  const { name, command } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Session name is required' });
  }
  try {
    const result = await sessions.createSession(name.trim(), command || 'bash');
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:name', async (req, res) => {
  try {
    await sessions.killSession(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:name/rename', async (req, res) => {
  const { newName } = req.body || {};
  if (!newName || !newName.trim()) {
    return res.status(400).json({ error: 'New name is required' });
  }
  try {
    await sessions.renameSession(req.params.name, newName.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

  // Ensure tmux server is running with at least a default session
  const serverRunning = await discovery.isTmuxServerRunning();
  if (!serverRunning) {
    console.log('No tmux server running — creating default session...');
    await sessions.createSession('default');
  }

  server.listen(PORT, () => {
    console.log(`TUI Browser listening on http://localhost:${PORT}`);
    console.log('Open this URL in your browser (or on your phone on the same network).');
  });
})();
