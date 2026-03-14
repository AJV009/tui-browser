/**
 * Shared exec utility — wraps child_process.execFile with a timeout.
 * Used by discovery.js, kitty-discovery.js, and session-manager.js.
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

module.exports = { exec };
