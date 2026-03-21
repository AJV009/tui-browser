/**
 * routes.js — All REST API route registrations.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec: run } = require('./exec-util');

function apiHandler(fn) {
  return async (req, res) => {
    try { await fn(req, res); } catch (err) { res.status(500).json({ error: err.message }); }
  };
}

function getLocalIPs() {
  const ips = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    }
  }
  return ips;
}

function setup(app, { discovery, sessions, kittyDiscovery, state, aiTitles, config }) {
  const { displayTitles, saveTitles, lockedSessions, saveLocks, SHELL_NAMES, annotateSessions } = state;
  const annotate = (list) => annotateSessions(list, sessions.getClientCount);

  // ---------- Health / Version / Network ----------

  app.get('/api/version', (_req, res) => {
    res.json({ version: config.FULL_VERSION, startedAt: parseInt(config.BUILD_ID, 36), claudeAvailable: aiTitles.claudeAvailable });
  });

  app.get('/api/network', (_req, res) => {
    res.json({ localIPs: getLocalIPs(), httpsPort: config.HTTPS_PORT, httpPort: config.PORT });
  });

  app.get('/api/health', async (_req, res) => {
    const tmuxOk = await discovery.isTmuxAvailable();
    const serverOk = tmuxOk && (await discovery.isTmuxServerRunning());
    const kittyStatus = await kittyDiscovery.isKittyRemoteAvailable();
    res.json({ tmux: tmuxOk, server: serverOk, kitty: kittyStatus.available });
  });

  // ---------- Sessions ----------

  app.get('/api/sessions', apiHandler(async (_req, res) => {
    const list = await discovery.listSessions();
    annotate(list);
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
    if (!name || !name.trim()) return res.status(400).json({ error: 'Session name is required' });
    if (cwd != null && (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.includes('\0'))) {
      return res.status(400).json({ error: 'Invalid cwd: must be an absolute path' });
    }
    const result = await sessions.createSession(name.trim(), command || 'bash', 80, 24, cwd);
    res.status(201).json(result);
  }));

  app.delete('/api/sessions/:name', apiHandler(async (req, res) => {
    await sessions.killSession(req.params.name);
    res.json({ ok: true });
  }));

  // ---------- Bulk Kill ----------

  app.post('/api/sessions/bulk-kill', apiHandler(async (req, res) => {
    const { names, filter, inactiveMinutes } = req.body || {};
    if (!Array.isArray(names) || names.length === 0) return res.status(400).json({ error: 'names array is required' });
    if (names.length > 100) return res.status(400).json({ error: 'Cannot kill more than 100 sessions at once' });

    let targetNames = names.filter(n => !lockedSessions.has(n));

    if (filter) {
      const currentSessions = await discovery.listSessions();
      annotate(currentSessions);
      const requestedSet = new Set(names);
      targetNames = currentSessions
        .filter(s => requestedSet.has(s.name))
        .filter(s => {
          switch (filter) {
            case 'detached': return s.attached === 0 && (s.webClients || 0) === 0;
            case 'no-commands': return s.panes.every(p => SHELL_NAMES.has(p.command));
            case 'inactive': return s.lastActivity < Date.now() - (inactiveMinutes || 10) * 60 * 1000;
            case 'all': return true;
            default: return false;
          }
        })
        .map(s => s.name);
    }

    const results = await Promise.allSettled(targetNames.map(n => sessions.killSession(n)));
    const killed = [], failed = [];
    for (let i = 0; i < targetNames.length; i++) {
      if (results[i].status === 'fulfilled') killed.push(targetNames[i]);
      else failed.push({ name: targetNames[i], error: results[i].reason?.message || 'unknown' });
    }
    for (const name of killed) displayTitles.delete(name);
    if (killed.length > 0) saveTitles();
    res.json({ killed, failed });
  }));

  // ---------- Discovery ----------

  app.get('/api/kitty/windows', apiHandler(async (_req, res) => {
    res.json(await kittyDiscovery.discoverKittyWindows());
  }));

  app.get('/api/discover', apiHandler(async (_req, res) => {
    const result = await discovery.discoverAll();
    annotate(result.sessions);
    res.json(result);
  }));

  // ---------- Session Info ----------

  app.get('/api/sessions/:name/info', apiHandler(async (req, res) => {
    const name = req.params.name;
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

    await Promise.all(panes.map(async (pane) => {
      try {
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

    const allProcs = panes.flatMap(p => p.processes);
    let recentOutput = [];
    try { recentOutput = (await run('tmux', ['capture-pane', '-t', name, '-p', '-S', '-30'])).split('\n'); } catch { /* ignore */ }

    res.json({
      name, created: +created, lastActivity: +activity, attached: +attached, windows: +windows,
      panes, totalMemory: allProcs.reduce((s, p) => s + p.rss, 0),
      totalCpu: allProcs.reduce((s, p) => s + p.cpu, 0), processCount: allProcs.length, recentOutput,
    });
  }));

  // ---------- Claude Code Detection ----------

  app.get('/api/sessions/:name/claude-status', apiHandler(async (req, res) => {
    const claudeDetect = require('./claude-detect');
    res.json(await claudeDetect.detectClaude(req.params.name));
  }));

  // ---------- Shortcuts / Titles / Rename / Lock ----------

  const shortcutsPath = path.join(__dirname, '..', 'public', 'shortcuts.json');

  app.post('/api/shortcuts', apiHandler(async (req, res) => {
    const { label, command } = req.body || {};
    if (!label || !command) return res.status(400).json({ error: 'label and command required' });
    let shortcuts = [];
    try { shortcuts = JSON.parse(fs.readFileSync(shortcutsPath, 'utf8')); } catch { /* empty */ }
    if (shortcuts.some(s => s.label === label && s.command === command)) return res.json({ shortcuts });
    shortcuts.push({ label, command });
    fs.writeFileSync(shortcutsPath, JSON.stringify(shortcuts, null, 2));
    res.json({ shortcuts });
  }));

  app.put('/api/shortcuts/:index', apiHandler(async (req, res) => {
    const idx = parseInt(req.params.index, 10);
    const { label, command } = req.body || {};
    if (!label || !command) return res.status(400).json({ error: 'label and command required' });
    let shortcuts = [];
    try { shortcuts = JSON.parse(fs.readFileSync(shortcutsPath, 'utf8')); } catch { /* empty */ }
    if (idx < 0 || idx >= shortcuts.length) return res.status(404).json({ error: 'shortcut not found' });
    shortcuts[idx] = { label, command };
    fs.writeFileSync(shortcutsPath, JSON.stringify(shortcuts, null, 2));
    res.json({ shortcuts });
  }));

  app.delete('/api/shortcuts/:index', apiHandler(async (req, res) => {
    const idx = parseInt(req.params.index, 10);
    let shortcuts = [];
    try { shortcuts = JSON.parse(fs.readFileSync(shortcutsPath, 'utf8')); } catch { /* empty */ }
    if (idx < 0 || idx >= shortcuts.length) return res.status(404).json({ error: 'shortcut not found' });
    shortcuts.splice(idx, 1);
    fs.writeFileSync(shortcutsPath, JSON.stringify(shortcuts, null, 2));
    res.json({ shortcuts });
  }));

  app.post('/api/sessions/:name/generate-title', apiHandler(async (req, res) => {
    res.json(await aiTitles.generateTitle(req.params.name, state, true));
  }));

  app.post('/api/sessions/:name/open-terminal', apiHandler(async (req, res) => {
    sessions.openTerminal(req.params.name);
    res.json({ ok: true });
  }));

  app.post('/api/sessions/:name/rename', apiHandler(async (req, res) => {
    const { newName } = req.body || {};
    if (!newName || !newName.trim()) return res.status(400).json({ error: 'New name is required' });
    displayTitles.set(req.params.name, { title: newName.trim(), manuallyRenamed: true, lastGenAt: Date.now(), lastLineCount: 0 });
    saveTitles();
    res.json({ ok: true });
  }));

  app.post('/api/sessions/:name/lock', apiHandler(async (req, res) => {
    const name = req.params.name;
    if (lockedSessions.has(name)) lockedSessions.delete(name);
    else lockedSessions.add(name);
    saveLocks();
    res.json({ locked: lockedSessions.has(name) });
  }));
}

module.exports = { setup };
