#!/usr/bin/env node
// Companion server for TUI Browser — raw WebSocket + node-pty
// Usage: npm install node-pty ws && node server.js [port] [command]
// Example: node server.js 3000 bash

const pty = require('node-pty');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2], 10) || 3000;
const CMD = process.argv[3] || 'bash';
const ARGS = process.argv.slice(4);

const wss = new WebSocketServer({ port: PORT });
console.log(`Listening on ws://localhost:${PORT} — will spawn: ${CMD} ${ARGS.join(' ')}`);

wss.on('connection', (ws) => {
  const proc = pty.spawn(CMD, ARGS, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  console.log(`Client connected — PID ${proc.pid}`);

  proc.onData((data) => ws.send(data));

  proc.onExit(({ exitCode }) => {
    console.log(`Process exited (${exitCode})`);
    ws.close();
  });

  ws.on('message', (msg) => {
    const str = msg.toString();
    try {
      const json = JSON.parse(str);
      if (json.type === 'resize' && json.cols && json.rows) {
        proc.resize(json.cols, json.rows);
        return;
      }
    } catch (_) { /* not JSON, treat as input */ }
    proc.write(str);
  });

  ws.on('close', () => {
    console.log(`Client disconnected — killing PID ${proc.pid}`);
    proc.kill();
  });
});
