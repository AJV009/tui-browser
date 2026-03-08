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

async function listSessions() {
  let raw;
  try {
    raw = await exec('tmux', ['list-sessions', '-F', SESSION_FORMAT]);
  } catch {
    return []; // no server or no sessions
  }

  if (!raw) return [];

  const sessions = [];
  for (const line of raw.split('\n')) {
    const [id, name, windows, attached, created] = line.split(SEP);
    sessions.push({
      id,
      name,
      windows: parseInt(windows, 10),
      attached: parseInt(attached, 10) > 0,
      created: parseInt(created, 10) * 1000, // ms epoch
      panes: await listPanes(name),
    });
  }
  return sessions;
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

/**
 * Unified discovery — returns tmux sessions + kitty windows in one call.
 */
async function discoverAll() {
  const kittyDiscovery = require('./kitty-discovery');

  const [tmuxSessions, kittyResult] = await Promise.all([
    listSessions(),
    kittyDiscovery.discoverKittyWindows(),
  ]);

  return {
    tmux: tmuxSessions,
    kitty: kittyResult,
  };
}

module.exports = {
  isTmuxAvailable,
  isTmuxServerRunning,
  listSessions,
  listPanes,
  capturePane,
  getSessionDetail,
  discoverAll,
};
