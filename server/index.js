#!/usr/bin/env node
/**
 * TUI Browser Server — HTTP + HTTPS + WebSocket orchestrator.
 * Routes, state, and AI titles are in separate modules.
 */

const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const discovery = require('./discovery');
const sessions = require('./session-manager');
const kittyDiscovery = require('./kitty-discovery');
const state = require('./state');
const aiTitles = require('./ai-titles');
const routes = require('./routes');
const fileRoutes = require('./file-routes');

const PORT = parseInt(process.env.PORT || process.argv[2], 10) || 3000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || PORT + 1;
const PKG_VERSION = require('../package.json').version;
const BUILD_ID = Date.now().toString(36);
const FULL_VERSION = `${PKG_VERSION.replace(/\.\d+$/, '')}.${BUILD_ID}`;

// ---------- Express Setup ----------

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Cache control
app.use((req, res, next) => {
  const p = req.path;
  if (p === '/' || p.endsWith('.html') || p.endsWith('sw.js') || p.endsWith('manifest.json')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Routes ----------

routes.setup(app, {
  discovery, sessions, kittyDiscovery, state, aiTitles,
  config: { PORT, HTTPS_PORT, FULL_VERSION, BUILD_ID },
});
fileRoutes.setup(app);

// ---------- AI Auto-Title Loop ----------

aiTitles.startAutoTitleLoop(state, discovery);

// ---------- HTTP + HTTPS ----------

const server = http.createServer(app);

let httpsServer = null;
const certPath = path.join(__dirname, '..', 'certs', 'server.crt');
const keyPath = path.join(__dirname, '..', 'certs', 'server.key');
try {
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    httpsServer = https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app);
  }
} catch {
  console.warn('[server] HTTPS certs not found, local fast-path disabled.');
}

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true });

function handleWsUpgrade(req, socket, head) {
  const match = req.url.match(/^\/ws\/terminal\/(.+)$/);
  if (!match) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, decodeURIComponent(match[1])));
}

server.on('upgrade', handleWsUpgrade);
if (httpsServer) httpsServer.on('upgrade', handleWsUpgrade);

wss.on('connection', (ws, sessionName) => {
  let cols = 80, rows = 24, attached = false;

  ws.on('message', (msg) => {
    const str = msg.toString();
    if (attached && str.charCodeAt(0) !== 123) { sessions.writeInput(sessionName, str); return; }
    try {
      const json = JSON.parse(str);
      if (json.type === 'resize' && json.cols && json.rows) {
        cols = json.cols; rows = json.rows;
        if (attached) sessions.resize(sessionName, cols, rows);
      } else if (json.type === 'attach' && !attached) {
        cols = json.cols || cols; rows = json.rows || rows;
        sessions.attachClient(sessionName, ws, cols, rows);
        attached = true;
      } else if (json.type === 'input' && json.data != null && attached) {
        sessions.writeInput(sessionName, json.data);
      }
    } catch {
      if (attached) sessions.writeInput(sessionName, str);
    }
  });

  ws.on('close', () => { if (attached) sessions.detachClient(sessionName, ws); });
});

// ---------- Startup ----------

(async () => {
  if (!(await discovery.isTmuxAvailable())) {
    console.error('ERROR: tmux is not installed.');
    process.exit(1);
  }

  server.listen(PORT, () => console.log(`TUI Browser listening on http://localhost:${PORT}`));
  if (httpsServer) {
    const os = require('os');
    const ips = [];
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs) { if (a.family === 'IPv4' && !a.internal) ips.push(a.address); }
    }
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`TUI Browser HTTPS on port ${HTTPS_PORT} (local fast-path)`);
      ips.forEach(ip => console.log(`  https://${ip}:${HTTPS_PORT}`));
    });
  }

  function gracefulShutdown(signal) {
    console.log(`${signal} received — shutting down gracefully...`);
    sessions.shutdown();
    wss.close();
    server.close(() => { if (httpsServer) httpsServer.close(); process.exit(0); });
    const t = setTimeout(() => process.exit(1), 5000);
    t.unref();
  }
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
})();
