/**
 * ai-titles.js — AI-powered session title generation using Claude CLI.
 * Claude Code sessions get "Claude: <project>", bare shells get "Shell: <dir>",
 * other processes get AI-generated titles from command line + working directory.
 */

const { spawn, execSync } = require('child_process');
const { exec: run } = require('./exec-util');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');

let claudeAvailable = false;
let claudePath = null;

// Check common paths since systemd has minimal PATH
const candidatePaths = [
  process.env.HOME + '/.local/bin/claude',
  '/usr/local/bin/claude',
  '/usr/bin/claude',
];
for (const p of candidatePaths) {
  try { if (fsSync.existsSync(p)) { claudePath = p; claudeAvailable = true; break; } } catch { /* skip */ }
}
if (!claudeAvailable) {
  try { execSync('which claude', { stdio: 'ignore' }); claudePath = 'claude'; claudeAvailable = true; } catch { /* not installed */ }
}

const SHELLS = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'tcsh', 'csh', 'ksh']);

/**
 * Get process context for a tmux session: foreground command + working directory.
 * Returns { isClaude, isShell, command, cmdline, cwd }.
 */
async function getProcessContext(sessionName) {
  const paneRaw = await run('tmux', [
    'list-panes', '-t', sessionName, '-F',
    '#{pane_pid}|||#{pane_current_command}|||#{pane_active}|||#{pane_title}',
  ]);

  const panes = paneRaw.split('\n').map((line) => {
    const [pid, command, active, paneTitle] = line.split('|||');
    return { pid: parseInt(pid, 10), command, active: active === '1', paneTitle: paneTitle || '' };
  });

  const activePane = panes.find((p) => p.active) || panes[0];
  if (!activePane) return null;

  const panePid = activePane.pid;
  const foregroundCmd = activePane.command;
  const paneTitle = activePane.paneTitle;

  // Claude Code session
  if (foregroundCmd === 'claude') {
    let cwd;
    try {
      const pids = await run('pgrep', ['-P', String(panePid), '-x', 'claude']);
      const claudePid = pids.split('\n')[0];
      cwd = await fs.readlink(`/proc/${claudePid}/cwd`);
    } catch {
      try { cwd = await fs.readlink(`/proc/${panePid}/cwd`); } catch { /* fallback below */ }
    }
    return { isClaude: true, isShell: false, command: 'claude', cmdline: null, cwd: cwd || null, paneTitle };
  }

  // Bare shell — no interesting child process
  if (SHELLS.has(foregroundCmd)) {
    let cwd;
    try { cwd = await fs.readlink(`/proc/${panePid}/cwd`); } catch { /* ignore */ }
    return { isClaude: false, isShell: true, command: foregroundCmd, cmdline: null, cwd: cwd || null, paneTitle };
  }

  // Other process — find child and get full cmdline + cwd
  let targetPid = panePid;
  try {
    const childPids = await run('pgrep', ['-P', String(panePid)]);
    const firstChild = childPids.split('\n')[0];
    if (firstChild) targetPid = parseInt(firstChild, 10);
  } catch { /* use panePid */ }

  let cmdline, cwd;
  try {
    const raw = await fs.readFile(`/proc/${targetPid}/cmdline`, 'utf8');
    cmdline = raw.replace(/\0/g, ' ').trim();
  } catch { cmdline = foregroundCmd; }
  try { cwd = await fs.readlink(`/proc/${targetPid}/cwd`); } catch { /* ignore */ }

  return { isClaude: false, isShell: false, command: foregroundCmd, cmdline, cwd: cwd || null, paneTitle };
}

function runClaudeForTitle(cmdline, cwd, paneTitle) {
  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, ['-p', '--model', 'haiku', '--no-session-persistence'], {
      timeout: 30000,
      env: { ...process.env },
    });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('claude exited with code ' + code));
      const title = stdout.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '-').replace(/[.:]/g, '-').slice(0, 20);
      resolve(title);
    });
    const paneTitleLine = paneTitle ? `\nApp-set title: ${paneTitle}` : '';
    proc.stdin.write(`Generate a concise terminal session title from this process info.
Rules:
- Maximum 20 characters
- Format: "Action: Focus" (e.g. "Serve: TUI", "Train: ML", "Edit: Config")
- Return ONLY the title text, nothing else
- Base it on what the command is doing and the project context from the path
- If an app-set title is provided, use it as extra context about what the process is doing

Command: ${cmdline}
Working directory: ${cwd}${paneTitleLine}`);
    proc.stdin.end();
  });
}

async function generateTitle(sessionName, state, force = false) {
  const titleState = state.displayTitles.get(sessionName);
  if (titleState && titleState.manuallyRenamed && !force) {
    return { skipped: true, reason: 'manually renamed' };
  }

  const ctx = await getProcessContext(sessionName);
  if (!ctx) return { skipped: true, reason: 'no pane found' };

  let title;

  if (ctx.isClaude) {
    const project = ctx.cwd ? path.basename(ctx.cwd) : 'unknown';
    title = `Claude: ${project}`;
  } else if (ctx.isShell) {
    const dir = ctx.cwd ? path.basename(ctx.cwd) : 'unknown';
    title = `Shell: ${dir}`;
  } else {
    if (!claudeAvailable) throw new Error('claude CLI not available');
    title = await runClaudeForTitle(ctx.cmdline, ctx.cwd || 'unknown', ctx.paneTitle);
    if (!title) throw new Error('empty title from claude');
  }

  state.displayTitles.set(sessionName, { title, manuallyRenamed: false, lastGenAt: Date.now(), command: ctx.command });
  state.saveTitles();

  return { title, sessionName };
}

function startAutoTitleLoop(state, discovery) {
  setInterval(async () => {
    try {
      const sessionList = await discovery.listSessions();
      for (const s of sessionList) {
        const titleState = state.displayTitles.get(s.name);
        if (titleState && titleState.manuallyRenamed) continue;

        try {
          const ctx = await getProcessContext(s.name);
          if (!ctx) continue;

          const age = Date.now() - s.created;
          const sinceLastGen = titleState ? Date.now() - titleState.lastGenAt : Infinity;
          const commandChanged = titleState ? titleState.command !== ctx.command : false;

          // Claude and shell sessions: instant (no AI cost), title aggressively
          if (ctx.isClaude || ctx.isShell) {
            if (titleState && !commandChanged && sinceLastGen < 30000) continue;
            await generateTitle(s.name, state, false);
            continue;
          }

          // Non-shell process: needs Claude CLI
          if (!claudeAvailable) continue;

          // Let very young sessions settle for a few seconds before AI call
          if (!titleState && age < 5000) continue;

          if (!titleState || commandChanged) {
            await generateTitle(s.name, state, false);
          } else if (sinceLastGen >= 120000) {
            await generateTitle(s.name, state, false);
          }
        } catch { /* skip this session */ }
      }
    } catch { /* ignore */ }
  }, 10000);
}

module.exports = { claudeAvailable, generateTitle, startAutoTitleLoop };
