/**
 * Session manager — attaches to tmux sessions via node-pty, manages lifecycle.
 *
 * Each tmux session can have multiple web clients viewing/controlling it.
 * When all web clients disconnect, the node-pty attachment is cleaned up
 * but the tmux session keeps running.
 */

const pty = require('node-pty');
const { spawn } = require('child_process');
const { exec } = require('./exec-util');

// Locale env for tmux UTF-8 support (also in scripts/tmux-kitty-shell)
const LOCALE_ENV = { LANG: 'en_IN.UTF-8', LC_ALL: 'en_IN.UTF-8' };

// sessionName → { proc: pty.IPty, clients: Set<WebSocket> }
const activeSessions = new Map();

function closeClient(client, sessionName) {
  try {
    client.send(JSON.stringify({ type: 'session-ended', sessionName }));
    client.close();
  } catch { /* ignore */ }
}

/**
 * Attach a WebSocket client to a tmux session.
 * If this is the first client, spawns a node-pty `tmux attach`.
 * Subsequent clients share the same pty and receive broadcast output.
 */
function attachClient(sessionName, ws, cols = 80, rows = 24) {
  let entry = activeSessions.get(sessionName);

  if (!entry) {
    const proc = pty.spawn('tmux', ['-u', 'attach-session', '-t', sessionName], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME,
      env: { ...process.env, TERM: 'xterm-256color', ...LOCALE_ENV },
    });

    entry = { proc, clients: new Set() };
    activeSessions.set(sessionName, entry);

    proc.onData((data) => {
      for (const client of entry.clients) {
        try {
          client.send(data);
        } catch {
          // client may have closed
        }
      }
    });

    proc.onExit(() => {
      for (const client of entry.clients) closeClient(client, sessionName);
      activeSessions.delete(sessionName);
    });
  }

  entry.clients.add(ws);

  // Resize to match this client (last client wins on size)
  if (cols && rows) {
    entry.proc.resize(cols, rows);
  }

  return entry;
}

/**
 * Write terminal input from a web client to the pty.
 */
function writeInput(sessionName, data) {
  const entry = activeSessions.get(sessionName);
  if (entry) {
    entry.proc.write(data);
  }
}

/**
 * Resize the pty for a session.
 */
function resize(sessionName, cols, rows) {
  const entry = activeSessions.get(sessionName);
  if (entry) {
    entry.proc.resize(cols, rows);
  }
}

/**
 * Detach a web client. If no clients remain, kill the pty attachment
 * (the tmux session itself keeps running).
 */
function detachClient(sessionName, ws) {
  const entry = activeSessions.get(sessionName);
  if (!entry) return;

  entry.clients.delete(ws);

  if (entry.clients.size === 0) {
    entry.proc.kill();
    activeSessions.delete(sessionName);
  }
}

/**
 * Create a new tmux session.
 */
async function createSession(name, command = 'bash', cols = 80, rows = 24, cwd) {
  const args = ['-u', 'new-session', '-d', '-s', name, '-x', String(cols), '-y', String(rows)];
  if (cwd) {
    args.push('-c', cwd);
  }
  if (command && command !== 'bash') {
    args.push(command);
  }
  await exec('tmux', args);

  // Best-effort: open a Kitty window attached to this session
  try {
    const kittyProc = spawn('kitty', ['-e', 'tmux', '-u', 'attach-session', '-t', name], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ...LOCALE_ENV },
    });
    kittyProc.on('error', (err) => {
      console.warn(`[session-manager] Kitty launch failed for session ${name}:`, err.message);
    });
    kittyProc.unref();
  } catch (err) {
    console.warn(`[session-manager] Kitty launch failed for session ${name}:`, err.message);
  }

  return { name, command };
}

/**
 * Kill a tmux session.
 */
async function killSession(name) {
  // Clean up any active pty attachment first
  const entry = activeSessions.get(name);
  if (entry) {
    for (const client of entry.clients) closeClient(client, name);
    entry.proc.kill();
    activeSessions.delete(name);
  }

  await exec('tmux', ['kill-session', '-t', name]);
}

/**
 * Rename a tmux session.
 */
async function renameSession(oldName, newName) {
  await exec('tmux', ['rename-session', '-t', oldName, newName]);
}

/**
 * Get the number of connected web clients for a session.
 */
function getClientCount(sessionName) {
  const entry = activeSessions.get(sessionName);
  return entry ? entry.clients.size : 0;
}

/**
 * Graceful shutdown — close all PTY attachments and notify clients.
 * Does NOT kill tmux sessions (they survive server restarts by design).
 */
function shutdown() {
  for (const [sessionName, entry] of activeSessions) {
    for (const client of entry.clients) closeClient(client, sessionName);
    try { entry.proc.kill(); } catch { /* ignore */ }
  }
  activeSessions.clear();
}

module.exports = {
  attachClient,
  writeInput,
  resize,
  detachClient,
  createSession,
  killSession,
  renameSession,
  getClientCount,
  shutdown,
};
