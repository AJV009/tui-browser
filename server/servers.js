/**
 * servers.js — Multi-server configuration management.
 * Reads/writes data/servers.json for the frontend server list.
 */

const fs = require('fs');
const path = require('path');

const serversPath = path.join(__dirname, '..', 'data', 'servers.json');

function readServers() {
  try {
    return JSON.parse(fs.readFileSync(serversPath, 'utf8'));
  } catch {
    return { servers: [] };
  }
}

function writeServers(data) {
  fs.mkdirSync(path.dirname(serversPath), { recursive: true });
  fs.writeFileSync(serversPath, JSON.stringify(data, null, 2));
}

function setupRoutes(app) {
  app.get('/api/servers', (_req, res) => {
    res.json(readServers());
  });

  app.put('/api/servers', (req, res) => {
    const { servers } = req.body || {};
    if (!Array.isArray(servers)) return res.status(400).json({ error: 'servers array required' });
    for (const s of servers) {
      if (!s.name || typeof s.name !== 'string') return res.status(400).json({ error: 'each server needs a name' });
    }
    const data = { servers: servers.map(s => ({ name: s.name, tunnel: s.tunnel || '', local: Array.isArray(s.local) ? s.local : [] })) };
    writeServers(data);
    res.json(data);
  });
}

module.exports = { setupRoutes, readServers };
