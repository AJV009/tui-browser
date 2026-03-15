/**
 * ai-titles.js — AI-powered session title generation using Claude CLI.
 * Generates contextual titles from terminal scrollback output.
 */

const { spawn, execSync } = require('child_process');
const { exec: run } = require('./exec-util');

let claudeAvailable = false;
let claudePath = null;

// Check common paths since systemd has minimal PATH
const fs = require('fs');
const candidatePaths = [
  process.env.HOME + '/.local/bin/claude',
  '/usr/local/bin/claude',
  '/usr/bin/claude',
];
for (const p of candidatePaths) {
  try { if (fs.existsSync(p)) { claudePath = p; claudeAvailable = true; break; } } catch { /* skip */ }
}
if (!claudeAvailable) {
  try { execSync('which claude', { stdio: 'ignore' }); claudePath = 'claude'; claudeAvailable = true; } catch { /* not installed */ }
}

function extractContext(fullOutput) {
  const lines = fullOutput.split('\n');

  let lastPromptIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*[\$%#❯>]\s/.test(lines[i]) || /[\$%#❯>]\s/.test(lines[i])) {
      lastPromptIdx = i;
      break;
    }
  }

  let contextLines = lastPromptIdx >= 0 ? lines.slice(lastPromptIdx) : lines;

  if (contextLines.length > 300) {
    const first = contextLines.slice(0, 150);
    const last = contextLines.slice(-150);
    contextLines = [...first, '--- [middle truncated] ---', ...last];
  }

  return contextLines.join('\n').trim();
}

function runClaudeForTitle(context) {
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
      const title = stdout.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '-').replace(/[.:]/g, '-').slice(0, 40);
      resolve(title);
    });
    proc.stdin.write(`Analyze this terminal output and generate a concise session title.
Rules:
- Maximum 30 characters
- Format: "Action: Focus" (e.g. "Debug: Auth API", "Build: Dashboard")
- Return ONLY the title text, nothing else
- If unclear, use the working directory or main command name

Terminal output:
${context}`);
    proc.stdin.end();
  });
}

async function generateTitle(sessionName, state, force = false) {
  if (!claudeAvailable) throw new Error('claude CLI not available');

  const titleState = state.displayTitles.get(sessionName);
  if (titleState && titleState.manuallyRenamed && !force) {
    return { skipped: true, reason: 'manually renamed' };
  }

  const raw = await run('tmux', ['capture-pane', '-t', sessionName, '-p', '-S', '-']);
  const lineCount = raw.split('\n').filter(l => l.trim()).length;
  const context = extractContext(raw);
  if (!context || context.length < 20) {
    return { skipped: true, reason: 'not enough output' };
  }

  const title = await runClaudeForTitle(context);
  if (!title) throw new Error('empty title from claude');

  state.displayTitles.set(sessionName, { title, manuallyRenamed: false, lastGenAt: Date.now(), lastLineCount: lineCount });
  state.saveTitles();

  return { title, sessionName };
}

function startAutoTitleLoop(state, discovery) {
  setInterval(async () => {
    if (!claudeAvailable) return;
    try {
      const sessionList = await discovery.listSessions();
      for (const s of sessionList) {
        const titleState = state.displayTitles.get(s.name);
        if (titleState && titleState.manuallyRenamed) continue;

        try {
          const raw = await run('tmux', ['capture-pane', '-t', s.name, '-p', '-S', '-']);
          const lineCount = raw.split('\n').filter(l => l.trim()).length;

          if (!titleState) {
            if (lineCount < 15 || Date.now() - s.created < 30000) continue;
          } else {
            if (Date.now() - titleState.lastGenAt < 300000) continue;
            if (lineCount - (titleState.lastLineCount || 0) < 300) continue;
          }

          await generateTitle(s.name, state, false);
        } catch { /* skip this session */ }
      }
    } catch { /* ignore */ }
  }, 60000);
}

module.exports = { claudeAvailable, generateTitle, startAutoTitleLoop };
