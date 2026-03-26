/**
 * update.js — Self-update endpoint. Pulls latest code from git and restarts.
 */

const { execFile } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: projectRoot, timeout: 60000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function setupRoutes(app) {
  let updating = false;

  app.get('/api/update/status', (_req, res) => {
    res.json({ updating });
  });

  app.post('/api/update', async (req, res) => {
    if (updating) return res.status(409).json({ error: 'Update already in progress' });
    updating = true;
    try {
      const pullResult = await runCmd('git', ['pull']);
      const needsInstall = pullResult.includes('package-lock.json') || pullResult.includes('package.json');
      if (needsInstall) {
        await runCmd('npm', ['install', '--production']);
      }
      res.json({ ok: true, pullResult, installed: needsInstall });
      // Restart after response is sent
      setTimeout(() => {
        try { execFile('systemctl', ['--user', 'restart', 'tui-browser'], { timeout: 10000 }); }
        catch { process.exit(0); }
      }, 500);
    } catch (err) {
      updating = false;
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { setupRoutes };
