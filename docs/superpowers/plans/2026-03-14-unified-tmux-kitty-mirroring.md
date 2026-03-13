# Unified tmux-Kitty Terminal Mirroring — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate Kitty/tmux dashboard with unified session cards where browser and Kitty mirror the same tmux session (VNC-style terminal sharing).

**Architecture:** tmux sessions become the single source of truth. Kitty windows that run inside tmux are linked via PID matching (tmux client PID = Kitty window PID). The browser connects to the same tmux session, providing true bidirectional mirroring.

**Tech Stack:** Node.js, Express, node-pty, ws, xterm.js, tmux, Kitty remote control

**Spec:** `docs/superpowers/specs/2026-03-14-unified-tmux-kitty-mirroring-design.md`

**Testing:** This project has no test framework. Verify via `node -c` syntax checks and manual testing against the running server (`npm start`, `curl localhost:3000/api/discover`). Per user's CLAUDE.md: always test against actual running endpoints.

---

## Chunk 1: Server-Side Changes

### Task 1: Create the tmux-kitty-shell wrapper script

**Files:**
- Create: `scripts/tmux-kitty-shell`

This is a small shell script that Kitty will use as its `shell` to ensure every Kitty window runs inside tmux.

- [ ] **Step 1: Create the scripts directory and wrapper script**

Run: `mkdir -p scripts`

Then write to `scripts/tmux-kitty-shell`:

```bash
#!/bin/sh
exec tmux new-session -A -s "kitty-$$"
```

The `exec` replaces the script's process with tmux, so `kitten @ ls` reports the tmux client PID (not the script PID). The `-A` flag handles PID recycling gracefully.

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/tmux-kitty-shell`

- [ ] **Step 3: Commit**

```bash
git add scripts/tmux-kitty-shell
git commit -m "feat: add tmux-kitty-shell wrapper for Kitty integration"
```

---

### Task 2: Change `attached` from boolean to integer in discovery.js

**Files:**
- Modify: `server/discovery.js:70`

The status logic needs the numeric attached count to distinguish "only Kitty attached" from "Kitty + other terminal clients."

- [ ] **Step 1: Change the attached field**

In `server/discovery.js`, line 70, change:

```javascript
attached: parseInt(attached, 10) > 0,
```

to:

```javascript
attached: parseInt(attached, 10),
```

- [ ] **Step 2: Verify syntax**

Run: `node -c server/discovery.js`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add server/discovery.js
git commit -m "refactor: return attached as integer for unified status logic"
```

---

### Task 3: Add `listTmuxClients()` to discovery.js

**Files:**
- Modify: `server/discovery.js` — add new function before `discoverAll()`, add to exports

This new function queries tmux for all connected clients and their session names. It's the linchpin of PID matching.

- [ ] **Step 1: Add the CLIENT_FORMAT constant**

After `PANE_FORMAT` (line 52), add:

```javascript
const CLIENT_FORMAT = ['#{client_pid}', '#{session_name}'].join(SEP);
```

- [ ] **Step 2: Add the `listTmuxClients()` function**

After `getSessionDetail()` (line 118), add:

```javascript
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
```

- [ ] **Step 3: Add `listTmuxClients` to module.exports**

In the `module.exports` object, add `listTmuxClients` after `getSessionDetail`.

- [ ] **Step 4: Verify syntax**

Run: `node -c server/discovery.js`
Expected: no output (success)

- [ ] **Step 5: Commit**

```bash
git add server/discovery.js
git commit -m "feat: add listTmuxClients() for PID-based Kitty matching"
```

---

### Task 4: Rewrite `discoverAll()` with PID-based join

**Files:**
- Modify: `server/discovery.js` — rewrite `discoverAll()` function body

**Note:** Line numbers in this task refer to the *original* file. After Tasks 2-3 insert code, lines will have shifted. Locate functions by name, not line number.

The new `discoverAll()` joins tmux sessions + tmux clients + Kitty windows into unified session objects.

- [ ] **Step 1: Rewrite the `discoverAll()` function**

Find the `async function discoverAll()` function and replace it entirely:

```javascript
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
```

- [ ] **Step 2: Verify syntax**

Run: `node -c server/discovery.js`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add server/discovery.js
git commit -m "feat: rewrite discoverAll() with PID-based Kitty-tmux join"
```

---

### Task 5: Simplify `discoverKittyWindows()` — remove `getWindowText()` calls

**Files:**
- Modify: `server/kitty-discovery.js:101-138` — remove preview fetching from `discoverKittyWindows()`

tmux handles previews now via `capture-pane`. The per-window `getWindowText()` calls were the main performance bottleneck. **Important:** Keep `getWindowText()` function and its export — it's still used by the deprecated `/api/kitty/windows` debug endpoint. Only remove the calls from `discoverKittyWindows()`.

- [ ] **Step 1: Rewrite `discoverKittyWindows()` to skip previews**

Replace lines 101-138 with:

```javascript
async function discoverKittyWindows() {
  const { available, socket } = await isKittyRemoteAvailable();
  if (!available) return { available: false, windows: [] };

  const osWindows = await listKittyWindows(socket);

  // Flatten all windows — no preview fetching (tmux handles previews)
  const windows = [];
  for (const osWin of osWindows) {
    for (const tab of osWin.tabs || []) {
      for (const win of tab.windows || []) {
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
          source: 'kitty',
        });
      }
    }
  }

  return { available: true, socket, windows };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c server/kitty-discovery.js`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add server/kitty-discovery.js
git commit -m "perf: remove per-window getWindowText() from Kitty discovery

tmux capture-pane handles previews now. Kitty discovery only returns
metadata for PID matching."
```

---

### Task 6: Add Kitty window launch to `createSession()`

**Files:**
- Modify: `server/session-manager.js:10,117-127` — add `spawn` import, launch Kitty after tmux session creation

When a session is created from the browser, also open a Kitty window on the host attached to the same tmux session.

- [ ] **Step 1: Add `spawn` to the require**

Change line 10:

```javascript
const { execFile } = require('child_process');
```

to:

```javascript
const { execFile, spawn } = require('child_process');
```

- [ ] **Step 2: Add Kitty launch to `createSession()`**

After `await exec('tmux', args);` (line 125) and before `return { name, command };` (line 126), add:

```javascript
  // Best-effort: open a Kitty window attached to this session
  try {
    const kittyProc = spawn('kitty', ['-e', 'tmux', 'attach-session', '-t', name], {
      detached: true,
      stdio: 'ignore',
    });
    kittyProc.on('error', (err) => {
      console.warn(`[session-manager] Kitty launch failed for session ${name}:`, err.message);
    });
    kittyProc.unref();
  } catch (err) {
    console.warn(`[session-manager] Kitty launch failed for session ${name}:`, err.message);
  }
```

- [ ] **Step 3: Verify syntax**

Run: `node -c server/session-manager.js`
Expected: no output (success)

- [ ] **Step 4: Commit**

```bash
git add server/session-manager.js
git commit -m "feat: launch Kitty window when creating sessions from browser"
```

---

### Task 7: Update `/api/discover` handler and deprecate `/api/kitty/windows`

**Files:**
- Modify: `server/index.js:85-107` — update discover handler, add deprecation comment

- [ ] **Step 1: Add deprecation comment to `/api/kitty/windows`**

Before line 85, add a comment:

```javascript
// Deprecated: Kitty discovery is now part of /api/discover unified response.
// Kept for debugging purposes.
```

- [ ] **Step 2: Update the `/api/discover` handler**

Replace lines 96-107:

```javascript
app.get('/api/discover', async (_req, res) => {
  try {
    const result = await discovery.discoverAll();
    // annotate tmux sessions with web client counts
    for (const s of result.tmux) {
      s.webClients = sessions.getClientCount(s.name);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

with:

```javascript
app.get('/api/discover', async (_req, res) => {
  try {
    const result = await discovery.discoverAll();
    // annotate unified sessions with web client counts
    for (const s of result.sessions) {
      s.webClients = sessions.getClientCount(s.name);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Verify syntax**

Run: `node -c server/index.js`
Expected: no output (success)

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat: update /api/discover for unified session response shape"
```

---

## Chunk 2: Client-Side Changes

### Task 8: Rewrite dashboard.js for unified session cards

**Files:**
- Modify: `public/js/dashboard.js` — rewrite `refresh()`, `render()`, remove `renderKittyCard()`, remove `connectKittyToTmux()`, add `renderSessionCard()`, add `renderUnmatchedKitty()`, update event delegation, update status logic

**Note:** All line numbers in this task refer to the *original* file before any modifications. As earlier steps modify the file, lines shift. Locate functions by name, not line number.

This is the largest change — the entire rendering pipeline switches from separate Kitty/tmux sections to unified cards.

- [ ] **Step 1: Update `refresh()` to use the new response shape**

Find the `async function refresh()` function and replace:

```javascript
  async function refresh() {
    try {
      const res = await fetch('/api/discover');
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      render(data.tmux || [], data.kitty || { available: false, windows: [] });
    } catch (err) {
      renderError(err.message);
    }
  }
```

with:

```javascript
  async function refresh() {
    try {
      const res = await fetch('/api/discover');
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      render(data.sessions || [], data.unmatchedKitty || []);
    } catch (err) {
      renderError(err.message);
    }
  }
```

- [ ] **Step 2: Rewrite `render()` for unified cards**

Replace lines 46-88 (the entire `render` function) with:

```javascript
  function render(sessions, unmatchedKitty) {
    const list = document.getElementById('session-list');

    if (sessions.length === 0 && unmatchedKitty.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <h3>No sessions found</h3>
          <p>Create a new tmux session to get started.</p>
        </div>`;
      return;
    }

    let html = '';
    html += sessions.map(renderSessionCard).join('');

    if (unmatchedKitty.length > 0) {
      html += renderUnmatchedKitty(unmatchedKitty);
    }

    list.innerHTML = html;
  }
```

- [ ] **Step 3: Replace `renderTmuxCard()` with `renderSessionCard()`**

Replace lines 90-126 (the entire `renderTmuxCard` function) with:

```javascript
  function renderSessionCard(s) {
    const pane = s.panes && s.panes[0];
    const cmd = pane ? pane.command : 'unknown';
    const size = pane ? `${pane.width}x${pane.height}` : '';
    const created = new Date(s.created).toLocaleString();
    const hasKitty = s.kittyWindows && s.kittyWindows.length > 0;

    // Status logic: accounts for Kitty windows always counting as attached clients
    let statusClass = 'detached';
    let statusLabel = 'Detached';
    if (s.webClients > 0) {
      statusClass = 'web-connected';
      statusLabel = `${s.webClients} web client${s.webClients > 1 ? 's' : ''}`;
    } else if (hasKitty && s.attached === s.kittyWindows.length) {
      statusClass = 'attached';
      statusLabel = 'Kitty attached';
    } else if (s.attached > 0) {
      statusClass = 'attached';
      statusLabel = hasKitty ? 'Host + Kitty attached' : 'Host attached';
    }

    // Kitty badge
    let kittyBadge = '';
    if (hasKitty) {
      const kittyInfo = s.kittyWindows.length === 1
        ? `tab: ${esc(s.kittyWindows[0].tabTitle)}`
        : `${s.kittyWindows.length} Kitty viewers`;
      kittyBadge = `
        <div class="session-meta">
          <span><span class="source-icon kitty-icon">K</span> ${kittyInfo}</span>
          ${s.kittyWindows.some(w => w.isFocused) ? '<span>focused</span>' : ''}
        </div>`;
    }

    return `
      <div class="session-card${hasKitty ? ' kitty-card' : ''}" data-session="${esc(s.name)}">
        <div class="session-card-header">
          <span class="session-name">${esc(s.name)}</span>
          <span class="session-status">
            ${hasKitty ? '<span class="source-badge kitty-badge" style="font-size:10px;padding:1px 5px;margin-right:4px">Kitty</span>' : ''}
            <span class="status-dot ${statusClass}"></span>
            ${statusLabel}
          </span>
        </div>
        ${kittyBadge}
        <div class="session-meta">
          <span>cmd: ${esc(cmd)}</span>
          <span>${s.windows} window${s.windows !== 1 ? 's' : ''}</span>
          ${size ? `<span>${size}</span>` : ''}
          <span>${created}</span>
        </div>
        <div class="session-actions">
          <button class="btn btn-primary" data-action="connect" data-session="${esc(s.name)}">Connect</button>
          <button class="btn btn-danger" data-action="kill" data-session="${esc(s.name)}">Kill</button>
        </div>
      </div>`;
  }
```

- [ ] **Step 4: Remove `renderKittyCard()` entirely**

Delete lines 128-161 (the entire `renderKittyCard` function).

- [ ] **Step 5: Add `renderUnmatchedKitty()` function**

After the new `renderSessionCard()`, add:

```javascript
  function renderUnmatchedKitty(windows) {
    let html = `<div class="source-section unmatched-kitty-section">
      <div class="source-header">
        <span class="source-badge kitty-badge">Kitty</span>
        <span class="source-label">Not available for mirroring — not running inside tmux</span>
      </div>
    </div>`;
    for (const win of windows) {
      const size = win.columns && win.lines ? `${win.columns}x${win.lines}` : '';
      html += `
        <div class="session-card kitty-card unmatched-card" data-kitty-id="${win.id}">
          <div class="session-card-header">
            <span class="session-name">
              <span class="source-icon kitty-icon">K</span>
              ${esc(win.title)}
            </span>
          </div>
          <div class="session-meta">
            ${win.cmdline ? `<span>cmd: ${esc(win.cmdline)}</span>` : ''}
            ${size ? `<span>${size}</span>` : ''}
            ${win.cwd ? `<span>cwd: ${esc(win.cwd)}</span>` : ''}
            <span>tab: ${esc(win.tabTitle)}</span>
          </div>
        </div>`;
    }
    return html;
  }
```

- [ ] **Step 6: Remove `connectKittyToTmux()` entirely**

Delete lines 204-241 (the entire `connectKittyToTmux` function and its JSDoc comment).

- [ ] **Step 7: Remove the `connect-kitty` action from event delegation**

In the `init()` function (lines 24-29), remove:

```javascript
      } else if (action === 'connect-kitty') {
        connectKittyToTmux(
          parseInt(btn.dataset.kittyId, 10),
          btn.dataset.title
        );
```

- [ ] **Step 8: Verify syntax**

Run: `node -c public/js/dashboard.js`
Expected: no output (success)

- [ ] **Step 9: Commit**

```bash
git add public/js/dashboard.js
git commit -m "feat: unified session cards with Kitty enrichment

Replace separate Kitty/tmux sections with unified cards. Sessions
with a linked Kitty window show a purple badge and Kitty metadata.
Unlinked Kitty windows shown in dimmed section at bottom."
```

---

### Task 9: Add dimmed styling for unmatched Kitty cards

**Files:**
- Modify: `public/css/styles.css` — add styles after the existing `.source-section` styles

- [ ] **Step 1: Add unmatched card styles**

After the `.source-label` rule (line 250), add:

```css
.unmatched-kitty-section .source-label {
  color: #555;
  font-style: italic;
}

.unmatched-card {
  opacity: 0.5;
}
```

- [ ] **Step 2: Verify the CSS file is valid**

Run: `head -5 public/css/styles.css`
Expected: starts with `/* ========== Reset & Base ========== */`

- [ ] **Step 3: Commit**

```bash
git add public/css/styles.css
git commit -m "style: add dimmed appearance for unmatched Kitty cards"
```

---

### Task 10: Manual verification against running server

- [ ] **Step 1: Kill existing server and restart**

Run: `pkill -f 'node server/index.js'; sleep 1; npm start &`

- [ ] **Step 2: Test the `/api/discover` endpoint**

Run: `curl -s http://localhost:3000/api/discover | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log('sessions:',j.sessions?.length,'unmatched:',j.unmatchedKitty?.length);console.log('shape OK:',!!j.sessions)"`

Expected: `sessions: N unmatched: M` and `shape OK: true`

- [ ] **Step 3: Open browser to http://localhost:3000**

Verify:
- Dashboard shows session cards in a grid layout
- Cards with Kitty linked show purple badge and Kitty metadata
- Connect button works — opens terminal view, mirrors the tmux session
- Kill button works — removes session (and closes Kitty window if linked)

- [ ] **Step 4: Test creating a new session from browser**

Click "New Session", enter a name. Verify:
- tmux session is created (`tmux list-sessions`)
- A Kitty window opens on the host attached to the same session
- Browser terminal and Kitty window show the same content
- Typing in either updates both

- [ ] **Step 5: Test unlinked Kitty windows**

Run: `kitty --override shell=zsh &`

Verify the unlinked Kitty window appears in a dimmed section at the bottom of the dashboard with "Not available for mirroring" label.

---

## Chunk 3: User Setup & Documentation

### Task 11: Install the wrapper script and update kitty.conf

This task is for the user to run manually (not automated by the server).

- [ ] **Step 1: Copy wrapper script to ~/.local/bin**

Run:
```bash
mkdir -p ~/.local/bin
cp scripts/tmux-kitty-shell ~/.local/bin/tmux-kitty-shell
chmod +x ~/.local/bin/tmux-kitty-shell
```

- [ ] **Step 2: Update kitty.conf**

In `~/.config/kitty/kitty.conf`, set:

```
shell ~/.local/bin/tmux-kitty-shell
```

- [ ] **Step 3: Restart Kitty**

Close all Kitty windows and reopen. Each new Kitty window should now launch inside tmux. Verify with `tmux list-sessions` — should show `kitty-<PID>` sessions.

- [ ] **Step 4: Verify full flow**

1. Open a Kitty window (auto-launches in tmux)
2. Start the server: `npm start`
3. Open browser to `http://localhost:3000`
4. Session card should show with purple Kitty badge
5. Click Connect — browser mirrors the Kitty terminal
6. Type in Kitty — appears in browser. Type in browser — appears in Kitty.

---

### Task 12: Final commit with all changes

- [ ] **Step 1: Verify all files are committed**

Run: `git status`
Expected: clean working tree (all changes committed in previous tasks)

- [ ] **Step 2: If anything remains, commit it**

```bash
git add -A
git commit -m "chore: finalize unified tmux-Kitty mirroring implementation"
```
