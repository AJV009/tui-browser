/**
 * claude-detect.js — Detects Claude Code sessions and their remote-control status.
 * Checks if a tmux session runs Claude Code and whether remote-control is enabled.
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('./exec-util');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

async function detectClaude(sessionName) {
  const result = { isClaude: false, remoteControlUrl: null };

  // Get active pane info
  let paneRaw;
  try {
    paneRaw = await exec('tmux', [
      'list-panes', '-t', sessionName, '-F',
      '#{pane_pid}|||#{pane_current_command}|||#{pane_active}',
    ]);
  } catch {
    return result;
  }

  const panes = paneRaw.split('\n').map((line) => {
    const [pid, command, active] = line.split('|||');
    return { pid: parseInt(pid, 10), command, active: active === '1' };
  });

  const activePane = panes.find((p) => p.active) || panes[0];
  if (!activePane || activePane.command !== 'claude') return result;

  result.isClaude = true;

  // Find actual claude process PID (child of the pane shell)
  let claudePid;
  try {
    const pids = await exec('pgrep', ['-P', String(activePane.pid), '-x', 'claude']);
    claudePid = pids.split('\n')[0];
  } catch {
    return result;
  }

  // Get claude's working directory
  let cwd;
  try {
    cwd = await fs.readlink(`/proc/${claudePid}/cwd`);
  } catch {
    return result;
  }

  // Map CWD to claude project dir: /home/user/foo → -home-user-foo
  const projectDir = '-' + cwd.replace(/\//g, '-').slice(1);
  const bridgePath = path.join(CLAUDE_DIR, 'projects', projectDir, 'bridge-pointer.json');

  try {
    const data = JSON.parse(await fs.readFile(bridgePath, 'utf8'));
    if (data.sessionId) {
      result.remoteControlUrl = `https://claude.ai/code/${data.sessionId}`;
    }
  } catch {
    // No bridge-pointer = no remote control
  }

  return result;
}

module.exports = { detectClaude };
