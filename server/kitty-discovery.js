/**
 * Kitty terminal discovery — uses `kitten @` remote control to discover
 * Kitty windows/tabs, then connects via tmux for actual terminal I/O.
 *
 * Kitty remote control must be enabled in kitty.conf:
 *   allow_remote_control yes
 *   listen_on unix:/tmp/kitty-socket
 */

const { execFile } = require('child_process');

function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000, ...opts }, (err, stdout) => {
      if (err) return reject(err);
      resolve((stdout || '').trimEnd());
    });
  });
}

/**
 * Check if kitten CLI is available.
 */
async function isKittyAvailable() {
  try {
    await exec('kitten', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Kitty remote control is reachable.
 * Tries the KITTY_LISTEN_ON socket first, then common socket paths.
 */
async function isKittyRemoteAvailable() {
  const sockets = [
    process.env.KITTY_LISTEN_ON,
    '/tmp/kitty-socket',
    `/tmp/kitty-${process.env.USER || 'root'}`,
  ].filter(Boolean);

  for (const sock of sockets) {
    try {
      await exec('kitten', ['@', '--to', `unix:${sock}`, 'ls']);
      return { available: true, socket: sock };
    } catch {
      // try next
    }
  }

  // Try without explicit socket (works if run from within a Kitty window)
  try {
    await exec('kitten', ['@', 'ls']);
    return { available: true, socket: null };
  } catch {
    return { available: false, socket: null };
  }
}

/**
 * Build the `kitten @` command args, including --to if we have a socket.
 */
function kittenArgs(socket, ...rest) {
  const args = ['@'];
  if (socket) args.push('--to', `unix:${socket}`);
  args.push(...rest);
  return args;
}

/**
 * List all Kitty OS windows, tabs, and inner windows.
 * Returns the raw JSON structure from `kitten @ ls`.
 */
async function listKittyWindows(socket) {
  try {
    const raw = await exec('kitten', kittenArgs(socket, 'ls'));
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Get text content from a specific Kitty window.
 */
async function getWindowText(socket, windowId) {
  try {
    const text = await exec('kitten', kittenArgs(socket, 'get-text', '--match', `id:${windowId}`));
    return text;
  } catch {
    return '';
  }
}

/**
 * Discover Kitty windows and normalize them into a flat list
 * compatible with the dashboard display.
 */
async function discoverKittyWindows() {
  const { available, socket } = await isKittyRemoteAvailable();
  if (!available) return { available: false, windows: [] };

  const osWindows = await listKittyWindows(socket);

  const windows = [];
  for (const osWin of osWindows) {
    for (const tab of osWin.tabs || []) {
      for (const win of tab.windows || []) {
        const preview = await getWindowText(socket, win.id);
        windows.push({
          id: win.id,
          title: win.title || `Window ${win.id}`,
          pid: win.pid,
          cwd: win.cwd || '',
          cmdline: (win.cmdline || []).join(' '),
          isFocused: win.is_focused || false,
          osWindowId: osWin.id,
          tabId: tab.id,
          tabTitle: tab.title || `Tab ${tab.id}`,
          columns: win.columns,
          lines: win.lines,
          preview: (preview || '').slice(-500), // last 500 chars
          source: 'kitty',
        });
      }
    }
  }

  return { available: true, socket, windows };
}

module.exports = {
  isKittyAvailable,
  isKittyRemoteAvailable,
  discoverKittyWindows,
  listKittyWindows,
  getWindowText,
};
