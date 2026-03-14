/**
 * tmux session discovery — queries tmux for active sessions, windows, and panes.
 */

const { execFile } = require('child_process');

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout.trimEnd());
    });
  });
}

async function isTmuxAvailable() {
  try {
    await exec('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
}

async function isTmuxServerRunning() {
  try {
    await exec('tmux', ['list-sessions']);
    return true;
  } catch {
    return false;
  }
}

const SEP = '|||';

const SESSION_FORMAT = [
  '#{session_id}',
  '#{session_name}',
  '#{session_windows}',
  '#{session_attached}',
  '#{session_created}',
].join(SEP);

const PANE_FORMAT = [
  '#{pane_id}',
  '#{pane_tty}',
  '#{pane_pid}',
  '#{pane_current_command}',
  '#{pane_width}',
  '#{pane_height}',
  '#{pane_active}',
].join(SEP);

const CLIENT_FORMAT = ['#{client_pid}', '#{session_name}'].join(SEP);

async function listSessions() {
  let raw;
  try {
    raw = await exec('tmux', ['list-sessions', '-F', SESSION_FORMAT]);
  } catch {
    return []; // no server or no sessions
  }

  if (!raw) return [];

  const parsed = raw.split('\n').map((line) => {
    const [id, name, windows, attached, created] = line.split(SEP);
    return {
      id,
      name,
      windows: parseInt(windows, 10),
      attached: parseInt(attached, 10),
      created: parseInt(created, 10) * 1000, // ms epoch
    };
  });

  const paneResults = await Promise.all(parsed.map((s) => listPanes(s.name)));

  return parsed.map((s, i) => ({ ...s, panes: paneResults[i] }));
}

async function listPanes(sessionName) {
  let raw;
  try {
    raw = await exec('tmux', ['list-panes', '-t', sessionName, '-F', PANE_FORMAT]);
  } catch {
    return [];
  }

  if (!raw) return [];

  return raw.split('\n').map((line) => {
    const [id, tty, pid, command, width, height, active] = line.split(SEP);
    return {
      id,
      tty,
      pid: parseInt(pid, 10),
      command,
      width: parseInt(width, 10),
      height: parseInt(height, 10),
      active: active === '1',
    };
  });
}

async function capturePane(sessionName) {
  try {
    return await exec('tmux', ['capture-pane', '-t', sessionName, '-p']);
  } catch {
    return '';
  }
}

async function getSessionDetail(sessionName) {
  const sessions = await listSessions();
  const session = sessions.find((s) => s.name === sessionName);
  if (!session) return null;
  session.preview = await capturePane(sessionName);
  return session;
}

async function listTmuxClients() {
  let raw;
  try {
    raw = await exec('tmux', ['list-clients', '-F', CLIENT_FORMAT]);
  } catch {
    return [];
  }

  if (!raw) return [];

  return raw.split('\n').map((line) => {
    const [pid, sessionName] = line.split(SEP);
    return { pid: parseInt(pid, 10), sessionName };
  });
}

/**
 * Unified discovery — returns tmux sessions + kitty windows in one call.
 */
async function discoverAll() {
  const kittyDiscovery = require('./kitty-discovery');

  const [tmuxSessions, tmuxClients, kittyResult] = await Promise.all([
    listSessions(),
    listTmuxClients(),
    kittyDiscovery.discoverKittyWindows(),
  ]);

  // Map: client PID → session name (for Kitty matching)
  const pidToSession = new Map();
  for (const client of tmuxClients) {
    pidToSession.set(client.pid, client.sessionName);
  }

  // Match Kitty windows to tmux sessions via PID
  const kittyWindows = kittyResult.available ? kittyResult.windows || [] : [];
  const matchedKittyBySession = new Map(); // sessionName → [kittyWindow, ...]
  const unmatchedKitty = [];

  for (const win of kittyWindows) {
    const sessionName = pidToSession.get(win.pid);
    if (sessionName) {
      if (!matchedKittyBySession.has(sessionName)) {
        matchedKittyBySession.set(sessionName, []);
      }
      matchedKittyBySession.get(sessionName).push(win);
    } else {
      unmatchedKitty.push(win);
    }
  }

  // Build unified session objects
  const sessions = tmuxSessions.map((s) => ({
    ...s,
    kittyWindows: matchedKittyBySession.get(s.name) || [],
  }));

  return { sessions, unmatchedKitty };
}

module.exports = {
  isTmuxAvailable,
  isTmuxServerRunning,
  listSessions,
  listPanes,
  capturePane,
  getSessionDetail,
  listTmuxClients,
  discoverAll,
};
