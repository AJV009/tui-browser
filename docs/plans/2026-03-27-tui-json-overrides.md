# tui.json Session Overrides

## Summary

A file-based override system where a `tui.json` in a tmux session's working directory provides custom titles, action buttons, and file browser CWD overrides — auto-discovered by TUI Browser during polling. Also removes the auto-title loop (manual AI title button stays).

## File Format

Located at `<tmux_cwd>/tui.json`, keyed by a project-specific identifier (e.g., Drupal issue number). Each entry has a `sessions` array mapping ephemeral tmux session names to the override:

```json
{
  "3536887": {
    "title": "D.O ISSUE: 3536887",
    "fileCwd": "/home/alphons/drupal/CONTRIB_WORKBENCH/DRUPAL_ISSUES/3536887",
    "sessions": ["drupal-issue-abc1", "drupal-issue-xyz9"],
    "actions": [
      { "id": "issue-page", "label": "Issue", "type": "url", "url": "https://drupal.org/i/3536887" },
      { "id": "comment", "label": "Comment", "type": "file-open", "path": "/home/alphons/drupal/CONTRIB_WORKBENCH/DRUPAL_ISSUES/3536887/issue-comment-3536887.html" }
    ]
  }
}
```

## Files to Modify

| File | Change |
|------|--------|
| `server/index.js:78` | Remove `aiTitles.startAutoTitleLoop(state, discovery)` call |
| `server/session-manager.js:159-177` | Record origin CWD in state after session creation |
| `server/state.js` | Add `originCwds` Map persisted to `data/origin-cwds.json` |
| `server/discovery.js:136-175` | Add tui.json discovery to `discoverAll()` using origin CWDs |
| `server/routes.js:113-117` | Pass tui overrides through `/api/discover` response |
| `server/file-routes.js:308-323` | Check tui.json fileCwd override before returning tmux cwd |
| `public/index.html:82-83` | Add `#tui-actions-container` div in terminal toolbar |
| `public/js/terminal.js:233-270` | Fetch + render action buttons on connect, clear on disconnect |
| `public/css/dashboard.css` | Action button styles (reuse toolbar-icon-btn pattern) |

## Files to Create

| File | Purpose |
|------|---------|
| `server/tui-overrides.js` | New module: tui.json file discovery, caching, reverse index |

## Files to Modify on g5-server (remote)

| File | Change |
|------|---------|
| `~/drupal/CONTRIB_WORKBENCH/drupal-issue.sh` | Add tui.json write before `exec claude` |

---

## Step-by-step Implementation

### Step 1: Record origin CWD on session creation

**`server/state.js`** — Add a new persisted Map for origin CWDs:

```js
const originCwds = loadJson('origin-cwds') || {};  // sessionName → absolutePath
function saveOriginCwds() { saveJson('origin-cwds', originCwds); }
```

Export `originCwds` and `saveOriginCwds`.

**`server/session-manager.js:159-177`** — After `tmux new-session` succeeds, immediately capture and store the pane's cwd (which at this point IS the original launch directory, before any command runs):

```js
// Right after: await exec('tmux', args);
try {
  const initialCwd = await exec('tmux', ['display', '-t', name, '-p', '#{pane_current_path}']);
  const trimmed = initialCwd.trim();
  if (trimmed) {
    state.originCwds[name] = trimmed;
    state.saveOriginCwds();
  }
} catch { /* best effort */ }
```

This gives every new session a permanent record of where it was born. For sessions that predate this change (already running when the server starts), the tui-overrides module falls back to the live `pane_current_path` from discovery.

### Step 2: Create `server/tui-overrides.js`

New module responsible for discovering and caching tui.json files.

```
Exports:
  - getTuiOverrides(sessionName, originCwd) → { title, fileCwd, actions } | null
  - refreshTuiFiles(sessions, originCwds) → void  (called during discovery)
  - getFileCwd(sessionName) → string | null  (convenience for file-routes)
```

**Logic:**
1. Maintain a cache: `Map<filePath, { mtime, data, reverseIndex }>` where `reverseIndex` maps session names to override keys.
2. `refreshTuiFiles(sessions, originCwds)` — for each session, look up origin CWD from `originCwds[session.name]`. If not found (legacy session), fall back to the first pane's live `pane_current_path`. Collect unique cwds. For each cwd, check if `<cwd>/tui.json` exists via `fs.statSync`. If mtime hasn't changed, use cache. Otherwise `fs.readFileSync` + `JSON.parse`, build reverse index from all entries' `sessions` arrays.
3. `getTuiOverrides(sessionName, cwd)` — look up the file cache for the cwd path, then check reverse index for the session name. Return the matching override object or null.

**Error handling:** Invalid JSON or missing files are silently ignored (log once). A broken tui.json must never crash discovery.

**Concurrency:** Discovery runs every 3s. File reads are synchronous (stat + readFile) to avoid race conditions with frequent polls. These are tiny files (<50KB), so sync reads are fine.

### Step 3: Remove auto-title loop

**`server/index.js:76-78`** — Comment out or remove:
```js
// ---------- AI Auto-Title Loop ----------
// REMOVED: auto-title disabled, manual AI title button still works
// aiTitles.startAutoTitleLoop(state, discovery);
```

The `generateTitle()` export in `ai-titles.js` stays — it's used by `POST /api/sessions/:name/generate-title` (routes.js:219).

### Step 4: Integrate tui.json into discovery

**`server/discovery.js:136-175`** — In `discoverAll()`, after building the unified session objects, call tui-overrides to apply overrides. The origin CWD is the primary lookup; live pane cwd is the fallback for legacy sessions:

```js
const tuiOverrides = require('./tui-overrides');
const state = require('./state');

async function discoverAll() {
  // ... existing tmux + kitty discovery ...

  const sessions = tmuxSessions.map((s) => ({
    ...s,
    kittyWindows: matchedKittyBySession.get(s.name) || [],
  }));

  // --- NEW: tui.json overrides ---
  tuiOverrides.refreshTuiFiles(sessions, state.originCwds);
  for (const s of sessions) {
    const cwd = state.originCwds[s.name] || s.panes?.[0]?.cwd || '';
    const overrides = tuiOverrides.getTuiOverrides(s.name, cwd);
    if (overrides) {
      if (overrides.title) s.tuiTitle = overrides.title;
      if (overrides.fileCwd) s.fileCwd = overrides.fileCwd;
      if (overrides.actions) s.actions = overrides.actions;
    }
  }

  return { sessions, unmatchedKitty };
}
```

Note: `#{pane_current_path}` does NOT need to be added to the PANE_FORMAT in discovery.js. The origin CWD from state is the primary source. The live pane cwd is only needed as a fallback for pre-existing sessions, and for those we can do a one-time tmux query. However, for simplicity, we DO still add it to PANE_FORMAT so the fallback path is available without an extra tmux call.

**`server/discovery.js:36-45`** — Add `#{pane_current_path}` to `PANE_FORMAT`:
```js
const PANE_FORMAT = [
  '#{pane_id}', '#{pane_tty}', '#{pane_pid}', '#{pane_current_command}',
  '#{pane_width}', '#{pane_height}', '#{pane_active}', '#{pane_title}',
  '#{pane_current_path}',   // <-- NEW: fallback cwd for legacy sessions
].join(SEP);
```

**`server/discovery.js:86-98`** — Parse the new field in `listPanes()`:
```js
const [id, tty, pid, command, width, height, active, title, cwd] = line.split(SEP);
return {
  id, tty, pid: parseInt(pid, 10), command,
  width: parseInt(width, 10), height: parseInt(height, 10),
  active: active === '1', title: title || '',
  cwd: cwd || '',   // <-- NEW
};
```

### Step 5: Apply tui title in state annotation

**`server/state.js:68-69`** or **`server/routes.js:113-117`** — When annotating sessions, if a session has `tuiTitle` from tui.json AND the title was not manually renamed via UI, use the tui title as displayTitle:

In `routes.js` `/api/discover` handler (or in `state.annotateSessions`):
```js
// After annotate(result.sessions):
for (const s of result.sessions) {
  if (s.tuiTitle) {
    const dt = displayTitles.get(s.name);
    if (!dt || !dt.manuallyRenamed) {
      s.displayTitle = s.tuiTitle;
    }
  }
}
```

This means: tui.json title takes precedence over AI/default titles, but a manual rename via UI still wins. This preserves user agency.

### Step 6: fileCwd override in file-routes

**`server/file-routes.js:308-323`** — Before returning the tmux pane cwd, check for a tui.json override. Import the tui-overrides module and check:

```js
const tuiOverrides = require('./tui-overrides');

app.get('/api/files/cwd', apiHandler(async (req, res) => {
  const session = req.query.session;
  if (!session) return res.status(400).json({ error: 'session parameter required' });

  // Check tui.json override first
  const override = tuiOverrides.getFileCwd(session);
  if (override) return res.json({ path: override });

  // Fallback: tmux pane cwd
  try {
    const cwd = await run('tmux', ['display', '-t', session, '-p', '#{pane_current_path}']);
    const trimmed = cwd.trim();
    if (trimmed) return res.json({ path: trimmed });
  } catch {}
  res.json({ path: os.homedir() });
}));
```

`getFileCwd(sessionName)` is a convenience wrapper in tui-overrides that does the reverse index lookup and returns just the `fileCwd` field.

### Step 7: Action buttons HTML container

**`public/index.html:82-83`** — Add a container for dynamic action buttons in the terminal toolbar, between the Claude remote button and reconnect button:

```html
<button id="claude-remote-btn" class="toolbar-icon-btn claude-remote-btn" style="display:none" title="Claude Remote Control">...</button>
<span id="tui-actions-container"></span>  <!-- NEW -->
<button id="reconnect-btn" ...>...</button>
```

### Step 8: Action button rendering in terminal.js

**`public/js/terminal.js`** — Add functions to fetch and render tui actions when connecting to a session.

After `checkClaudeStatus()` in the `ws.onopen` handler (line 270), also fetch session data for actions:

```js
ws.onopen = () => {
  // ... existing ...
  checkClaudeStatus(sessionName, serverName);
  loadTuiActions(sessionName, serverName);  // <-- NEW
};
```

New functions:

```js
let tuiActions = [];

async function loadTuiActions(sessionName, serverName) {
  try {
    const origin = serverName ? ServerManager.getOrigin(serverName) : '';
    const res = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionName)}`);
    const data = await res.json();
    renderTuiActions(data.actions || []);
    // Also update title if tui override provides one
    if (data.displayTitle) {
      document.getElementById('terminal-session-name').textContent = data.displayTitle;
    }
  } catch { /* ignore */ }
}

function renderTuiActions(actions) {
  tuiActions = actions;
  const container = document.getElementById('tui-actions-container');
  container.innerHTML = '';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = 'toolbar-icon-btn tui-action-btn';
    btn.title = action.label;
    btn.textContent = action.label;
    btn.dataset.actionType = action.type;
    btn.dataset.actionId = action.id;
    if (action.type === 'url') btn.dataset.url = action.url;
    if (action.type === 'file-open') btn.dataset.path = action.path;
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      handleTuiAction(action);
    });
    container.appendChild(btn);
  }
}

function handleTuiAction(action) {
  if (action.type === 'url') {
    window.open(action.url, '_blank');
  } else if (action.type === 'file-open') {
    // Open file browser, then immediately open the file in editor
    const serverName = App.getCurrentServer();
    const origin = serverName ? ServerManager.getOrigin(serverName) : '';
    FileEditor.open(action.path, origin);
  }
}

function clearTuiActions() {
  tuiActions = [];
  const container = document.getElementById('tui-actions-container');
  if (container) container.innerHTML = '';
}
```

Call `clearTuiActions()` in `disconnect()` alongside `hideClaudeRemote()`.

### Step 9: Action button CSS

**`public/css/dashboard.css`** (or a new section at the bottom) — Style the action buttons as small pills matching the toolbar aesthetic:

```css
.tui-action-btn {
  font-family: var(--mono);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--accent);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.tui-action-btn:hover { background: var(--surface-hover); }
#tui-actions-container { display: inline-flex; gap: 4px; align-items: center; }
```

### Step 10: Propagate actions/fileCwd through existing endpoints

**`server/routes.js`** — The `/api/sessions/:name` endpoint (line 45-52) should also include tui overrides so the terminal view can fetch them:

```js
app.get('/api/sessions/:name', apiHandler(async (req, res) => {
  const detail = await discovery.getSessionDetail(req.params.name);
  if (!detail) return res.status(404).json({ error: 'Session not found' });
  detail.webClients = sessions.getClientCount(detail.name);
  const dt = displayTitles.get(detail.name);
  if (dt && dt.title) detail.displayTitle = dt.title;

  // NEW: tui.json overrides
  const paneCwd = detail.panes?.[0]?.cwd || '';
  const tuiOverrides = require('./tui-overrides');
  const overrides = tuiOverrides.getTuiOverrides(detail.name, paneCwd);
  if (overrides) {
    if (overrides.title && (!dt || !dt.manuallyRenamed)) detail.displayTitle = overrides.title;
    if (overrides.actions) detail.actions = overrides.actions;
    if (overrides.fileCwd) detail.fileCwd = overrides.fileCwd;
  }

  res.json(detail);
}));
```

### Step 11: Update `drupal-issue.sh` on g5-server

Add a tui.json write block **before** the `exec claude` calls in both `launch_new_session()` and `resume_session()`. Factor it into a helper function:

```bash
write_tui_json() {
  local tmux_name issue_id issue_dir tui_file
  tmux_name=$(tmux display-message -p '#{session_name}' 2>/dev/null || echo "")
  [[ -z "$tmux_name" ]] && return 0

  issue_id="$1"
  issue_dir="$SCRIPT_DIR/DRUPAL_ISSUES/$issue_id"
  tui_file="$SCRIPT_DIR/tui.json"

  # Read existing or start fresh
  [[ -f "$tui_file" ]] && tui_data=$(cat "$tui_file") || tui_data="{}"

  # Upsert entry: set title, fileCwd, default action, append session name
  tui_data=$(echo "$tui_data" | jq \
    --arg key "$issue_id" \
    --arg title "D.O ISSUE: $issue_id" \
    --arg cwd "$issue_dir" \
    --arg url "https://www.drupal.org/i/$issue_id" \
    --arg sess "$tmux_name" \
    '
    .[$key] //= {} |
    .[$key].title = $title |
    .[$key].fileCwd = $cwd |
    .[$key].actions //= [{"id":"issue-page","label":"Issue","type":"url","url":$url}] |
    .[$key].sessions = ((.[$key].sessions // []) + [$sess] | unique)
    ')
  echo "$tui_data" > "$tui_file"
}
```

Call `write_tui_json "$ISSUE_ID"` in both `launch_new_session()` and `resume_session()` right before the `exec claude` line.

---

## Potential Risks

1. **tmux cwd changes after launch** — SOLVED. The server records the origin CWD at session creation time in `state.originCwds`. tui.json discovery uses this immutable origin CWD, not the live `pane_current_path`. Even if Claude cd's into a subdirectory, the tui.json lookup always points at the original launch directory. For legacy sessions (created before this change), falls back to live pane cwd.

2. **tui.json parse errors** — A malformed file could cause issues. **Mitigation:** Wrap JSON.parse in try/catch, log warning, skip that file. Never let a bad tui.json crash discovery.

3. **Stale mtime cache** — If the clock skews or the file is updated within the same second, mtime-based caching could serve stale data. **Mitigation:** Acceptable for a 3s poll interval — worst case, overrides appear 3-6s late.

4. **File-open action with missing file** — The comment file doesn't exist until the Claude skill creates it. The button renders but clicking it opens FileEditor which will show a 404/error. **Mitigation:** FileEditor already handles missing files gracefully (shows error toast). Alternatively, the Claude skill only adds the action AFTER creating the file.

5. **Performance with many tui.json files** — Each unique cwd gets a stat call every 3s. With <10 active sessions, that's <10 stat calls — negligible. **Mitigation:** Only stat cwds that contain a tui.json we've seen before (cache negative results with a TTL).

6. **Race condition between shell script and Claude skill writing tui.json** — Both `drupal-issue.sh` and the Claude skill could write the file close together. **Mitigation:** The shell script runs first (before `exec claude`), and the skill runs much later (after minutes of analysis). No realistic race condition.

## Execution Order

1. Step 1: Origin CWD tracking in state + session-manager (foundation)
2. Steps 2-3: `tui-overrides.js` module + remove auto-title (independent, server-only)
3. Step 4: Add pane CWD to discovery format + wire tui.json into `discoverAll()`
4. Steps 5-6: Apply tui title in annotation + fileCwd override in file-routes
5. Steps 7-9: Frontend action buttons (HTML + JS + CSS)
6. Step 10: Propagate through `/api/sessions/:name` (server, for terminal view)
7. Step 11: Update `drupal-issue.sh` on g5-server (remote, can be done last)
