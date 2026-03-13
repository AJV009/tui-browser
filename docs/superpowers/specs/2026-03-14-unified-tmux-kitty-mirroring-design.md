# Unified tmux-Kitty Terminal Mirroring — Design Spec

## Problem

The current architecture treats Kitty windows and tmux sessions as separate worlds. "Connect via tmux" on a Kitty window creates a *new* tmux session in the same directory — it doesn't mirror the Kitty window. The user wants VNC-style terminal mirroring: the browser shows the exact same content as the host terminal, and input from either side goes to the same process.

Research confirmed that there is no way to tap into an existing PTY. The only viable approach is to have all terminals run inside tmux from the start, so both Kitty (on the host) and the browser attach as viewers of the same tmux session.

## Architecture

### Core Principle

**tmux sessions are the single source of truth.** Kitty is one viewer. The browser is another viewer. Both attach to the same tmux session and see identical output.

### Setup: All Kitty Windows Launch Inside tmux

A wrapper script handles tmux session creation with reliable unique naming:

```bash
# ~/.local/bin/tmux-kitty-shell (must be executable)
#!/bin/sh
exec tmux new-session -A -s "kitty-$$"
```

In `~/.config/kitty/kitty.conf`:

```
shell ~/.local/bin/tmux-kitty-shell
```

Why a wrapper script instead of inline `shell tmux new-session -s "kitty-$$"`:
- `$$` is a shell parameter, not an env var — Kitty may not expand it when using `execvp()` directly
- The wrapper ensures `$$` is the PID of the script process (= the Kitty window's child PID), which is what `kitten @ ls` reports as `pid` — making PID matching work correctly
- The `-A` flag handles PID recycling: if a session with that name already exists (from a recycled PID), tmux attaches to it instead of failing with "duplicate session"

Behavior:
- Every new Kitty window/tab spawns a unique tmux session
- The user's default shell (zsh) runs inside tmux — all .zshrc config, aliases, prompt preserved
- tmux status bar can be hidden with `set -g status off` in `.tmux.conf` if desired

### PID Matching: Linking Kitty Windows to tmux Sessions

The unified discovery joins three data sources:

1. **tmux sessions** — `tmux list-sessions -F <format>` (existing)
2. **tmux clients** — `tmux list-clients -F '#{client_pid}|||#{session_name}'` (new)
3. **Kitty windows** — `kitten @ ls` (existing, simplified — no more per-window `get-text`)

Join logic:
- Each Kitty window has a `pid` field — when using the wrapper script, this is the PID of the wrapper (= the tmux client process, since `exec tmux` replaces the script process with tmux)
- Each tmux client has a `client_pid` and the `session_name` it's attached to
- Match: `kitty_window.pid == tmux_client.client_pid` → get `session_name` → link to tmux session

**Multiple Kitty windows on the same session:** A user can manually run `tmux attach -t <session>` in another Kitty window. The join produces a one-to-many relationship (one session, multiple Kitty viewers). The unified session object stores an array of Kitty viewers: `session.kittyWindows = [...]`. The card shows all linked Kitty badges (e.g., "2 Kitty viewers").

**PID matching failure:** If Kitty routes the shell through an intermediate process (not `exec`), `kitty_window.pid` may not equal `client_pid`. The wrapper script with `exec` prevents this. If matching fails for a Kitty window, it appears in the "unlinked" section — graceful degradation, not a crash.

Result: each tmux session is annotated with its Kitty window metadata (tab title, focused state, Kitty window ID) if linked Kitty viewers exist.

### Unified Dashboard Cards

Each card represents one tmux session.

**Always present (from tmux):**
- Session name
- Pane command, window count, dimensions, creation time
- Preview via `tmux capture-pane -p`
- Connect / Kill buttons

**Status logic (revised):**
Since Kitty-linked sessions always have a tmux client attached (the Kitty window itself), the raw `attached` count is misleading. Status is computed as:
- **"N web client(s)"** — if `webClients > 0`, show web client count (blue dot)
- **"Kitty attached"** — if session has linked Kitty windows and `attached` client count equals the number of Kitty viewers (only Kitty is attached, no other terminal clients), show Kitty badge (purple dot)
- **"Host + Kitty attached"** — if `attached` count exceeds the Kitty viewer count (other terminal clients besides Kitty are attached too)
- **"Detached"** — if no clients at all (Kitty window closed but tmux session persists)

**When a Kitty window is linked (from Kitty discovery):**
- Kitty badge/indicator (purple accent)
- Kitty tab title
- Focused / background state
- If multiple Kitty viewers: show count

**When no Kitty window is linked:**
- Standard tmux card appearance (no Kitty badge)
- These are browser-created sessions or manually started tmux sessions

**Unlinked Kitty windows (not running inside tmux):**
- Shown in a dimmed section at the bottom of the dashboard
- Label: "Not available for mirroring — not running inside tmux"
- No connect button

### Connection Flow (Browser)

Unchanged from current tmux flow:

1. Click "Connect" on any card
2. Navigate to `#terminal/<sessionName>`
3. WebSocket opens to `/ws/terminal/<sessionName>`
4. Server spawns `tmux attach-session -t <sessionName>` via node-pty
5. Bidirectional I/O streams — browser mirrors what Kitty sees

### New Session Creation (from Browser)

1. Server creates tmux session: `tmux new-session -d -s <name>`
2. Server launches a Kitty window on the host: `kitty -e tmux attach-session -t <name>` (fire-and-forget, non-blocking via `child_process.spawn` with `detached: true`, `stdio: 'ignore'`, `.unref()`)
3. Browser navigates to terminal view, attaches to the session
4. Both browser and host Kitty window now mirror the same session
5. Next discovery cycle (within 3s) picks up the Kitty window and enriches the card

Best-effort Kitty launch — if `kitty` is not in PATH or `DISPLAY`/Wayland socket is unavailable, the tmux session is still created and usable from browser. Failure is logged as a warning, not an error.

### Session Kill (from Browser)

1. Kill the tmux session (existing `tmux kill-session -t <name>`)
2. The Kitty window's tmux client exits, causing Kitty to close that window automatically
3. Clean teardown, no orphans

### Important Caveats

**tmux server death:** If the tmux server crashes or `tmux kill-server` is run, ALL tmux sessions die. Every Kitty window running inside tmux will close (their tmux client exits). This is a catastrophic event under this architecture — the user should be aware that tmux health is critical.

**Orphaned sessions after Kitty restart:** If Kitty is restarted (new PIDs), old tmux sessions named `kitty-<old-pid>` still exist but no Kitty window matches them. They appear as normal tmux sessions without Kitty badges. The user can kill them manually from the dashboard or reattach from a new terminal.

## File Changes

### `server/discovery.js`

- Change `listSessions()`: return `attached` as an integer (`parseInt(attached, 10)`) instead of coercing to boolean (`> 0`). The status logic needs the numeric count to distinguish "only Kitty attached" from "Kitty + other clients attached".
- Add `listTmuxClients()` (new function): runs `tmux list-clients -F '#{client_pid}|||#{session_name}'`, returns `[{ pid, sessionName }]`
- Rewrite `discoverAll()`: call `listSessions()`, `listTmuxClients()`, and `kittyDiscovery.discoverKittyWindows()` in parallel via `Promise.all`. Kitty discovery MUST NOT throw — it already handles errors internally and returns `{ available: false, windows: [] }`. Join results:
  - Build a map: tmux client PID → session name
  - For each Kitty window, look up its PID in the client map to find the linked session
  - Attach Kitty metadata to the session object as `session.kittyWindows` array
  - Collect unmatched Kitty windows (PID not found in client map) as `unmatchedKitty` array
- Return shape: `{ sessions: [...unified...], unmatchedKitty: [...] }`

### `server/kitty-discovery.js`

- Simplify `discoverKittyWindows()`: remove per-window `getWindowText()` calls (tmux handles previews now via `capture-pane`)
- Return only window metadata: id, pid, title, tabTitle, isFocused, cwd, cmdline, columns, lines
- Keep `getWindowText()` function exported (useful for the deprecated `/api/kitty/windows` debug endpoint) but stop calling it from `discoverKittyWindows()`

### `server/session-manager.js`

- Modify `createSession()`: after `tmux new-session`, spawn `kitty -e tmux attach-session -t <name>` using `child_process.spawn` with `detached: true` and `stdio: 'ignore'`, then `.unref()`. Wrap in try/catch — if `kitty` launch fails (not in PATH, no display), log: `console.warn('[session-manager] Kitty launch failed for session ${name}:', err.message)` and continue.

### `server/index.js`

- Update `GET /api/discover` handler: the response shape changes from `{ tmux: [...], kitty: { ... } }` to `{ sessions: [...], unmatchedKitty: [...] }`. Update the `webClients` annotation loop to iterate `result.sessions` instead of `result.tmux`.
- Deprecate `GET /api/kitty/windows` endpoint: no longer needed since `connectKittyToTmux()` is removed. Keep the endpoint but mark it as deprecated in a comment — it may be useful for debugging.
- `GET /api/sessions` endpoint: unchanged — returns raw tmux sessions without Kitty enrichment (lightweight alternative to `/api/discover`)
- WebSocket protocol: no changes

### `public/js/dashboard.js`

- Rewrite `render()`: accepts `{ sessions, unmatchedKitty }` instead of `(sessions, kitty)`. Single list of unified session cards.
- Remove `renderKittyCard()` — replaced by enriched fields on `renderSessionCard()`
- New `renderSessionCard(session)`: renders tmux data + optional Kitty badge/metadata if `session.kittyWindows` exists and is non-empty
- New `renderUnmatchedKitty(windows)`: dimmed section at bottom for non-tmux Kitty windows
- Remove `connectKittyToTmux()` entirely
- Event delegation: remove `connect-kitty` action, keep `connect` and `kill`

### `public/js/terminal.js`

- No changes

### `public/js/app.js`

- No changes

### `public/css/styles.css`

- Minimal changes: reuse existing `.kitty-badge`, `.kitty-icon`, `.source-icon` styles for the Kitty indicator on unified cards
- Add dimmed styling for unmatched Kitty section

### User setup files

- Create `~/.local/bin/tmux-kitty-shell` wrapper script
- Update `~/.config/kitty/kitty.conf`: set `shell ~/.local/bin/tmux-kitty-shell`
- Keep `allow_remote_control yes` and `listen_on unix:/tmp/kitty-socket` (already enabled)

## What Is NOT Changing

- WebSocket protocol (attach/input/resize messages)
- xterm.js setup and rendering
- tmux session attach via node-pty
- Graceful shutdown logic
- Hash-based SPA routing
- Security model

## Post-Implementation: Update DESIGN.md

After implementation, update the project's `DESIGN.md` to reflect:
- The unified tmux-first architecture (replace separate Kitty/tmux sections)
- The new `/api/discover` response shape
- The revised connection flow (no more "Connect via tmux" Kitty bridge)
- The PID matching join logic
- The wrapper script setup

## Verification

1. Open a new Kitty window — it should launch inside tmux (zsh prompt, tmux session visible in `tmux list-sessions`)
2. `npm start` — dashboard should show the Kitty window's tmux session as a unified card with Kitty badge
3. Click "Connect" — browser mirrors the Kitty terminal exactly. Type in either, both update.
4. Create a new session from browser — a Kitty window should open on the host, both mirroring
5. Kill a session from browser — Kitty window closes automatically
6. Open a Kitty window without tmux (e.g., `kitty --override shell=zsh`) — should appear in dimmed "unlinked" section
7. Multiple Kitty viewers: `tmux attach -t <session>` from a second Kitty window — card should show "2 Kitty viewers"
