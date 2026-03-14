# TUI Browser — Feature Brainstorm & Competitive Analysis

_Date: 2026-03-14_

---

## Competitive Landscape

### What Exists

| Tool | Language | Model | Standout Feature |
|------|----------|-------|-----------------|
| **ttyd** | C | Single terminal → browser | Dead simple, fast, zero config |
| **GoTTY** | Go | Single terminal → browser | Single binary, xterm.js + hterm |
| **WeTTY** | Node.js | SSH → browser | Node ecosystem, SSH support |
| **sshx** | Rust | Collaborative sharing | Multiplayer infinite canvas, real-time cursors, E2E encrypted |
| **Wave Terminal** | Go/TS | Desktop terminal app | AI chat, file preview, inline widgets, drag & drop blocks |
| **Upterm** | Go | Terminal sharing | Instant sharing via link, file transfer (scp/sftp) |
| **tmate** | C | tmux fork for sharing | Instant pairing, read-only links |
| **asciinema** | Rust | Session recording | Record & replay as shareable HTML/embeds |

### Where TUI Browser Already Wins

- **tmux-native** — not a fork, not a wrapper; connects to real tmux sessions
- **Kitty integration** — PID matching links Kitty windows to tmux sessions
- **Mobile-first** — quick-keys, scroll controls, text selection, keyboard-aware viewport
- **AI session titles** — auto-generated contextual names via Claude CLI
- **Session lifecycle** — create, kill, rename, open-on-PC from dashboard
- **Local network fast-path** — auto-switches between LAN and Cloudflare tunnel
- **PWA** — installable, auto-updating, cache-first rendering
- **Multi-client sync** — multiple browsers on the same tmux session

### Gaps — Features Competitors Have That We Don't

1. **Search in terminal buffer** — xterm.js has a search addon (`@xterm/addon-search`); Ctrl+F through scrollback
2. **Session recording & replay** — record a session, replay it later or share as a link
3. **Collaborative cursors / presence** — sshx shows who's typing where in real-time
4. **File transfer** — drag & drop files to/from the server
5. **Built-in AI chat panel** — Wave has a side panel for asking AI about terminal output
6. **Link detection** — clickable URLs in terminal output (`@xterm/addon-web-links`)
7. **Split-pane / multi-terminal view** — view multiple sessions side by side in the browser
8. **E2E encryption** — sshx encrypts everything client-side

---

## Feature Ideas

### Tier 1 — High Impact, Natural Fit

#### 1. Search in Terminal Buffer
- Use xterm.js `@xterm/addon-search` (available via CDN)
- Ctrl+F / search icon opens a floating search bar over the terminal
- Highlight matches, navigate with up/down arrows
- Works on existing scrollback buffer — no server changes needed
- **Why**: Essential for anyone reviewing long output (build logs, test results)

#### 2. Clickable Links in Terminal Output
- Use xterm.js `@xterm/addon-web-links`
- URLs in terminal output become clickable, open in new tab
- Especially useful on mobile where you can't Cmd+click
- **Why**: Low effort, high quality-of-life improvement

#### 3. Notifications — "Your Command Finished"
- Detect when a long-running command completes (shell prompt returns after N seconds of activity)
- Send browser Push Notification or vibrate on mobile
- Could also detect specific patterns (e.g., "BUILD SUCCESS", "error:", test summary lines)
- Toggle per-session or global
- **Why**: The #1 reason people use TUI Browser is to check on long-running tasks from their phone — this closes the loop

#### 4. Session Tagging / Grouping
- Tag sessions with labels like "frontend", "backend", "devops", "personal"
- Filter/group the dashboard by tags
- Color-coded tags on session cards
- Persist tags alongside display titles in `data/` JSON
- **Why**: Once you have 10+ sessions, a flat list becomes hard to scan

#### 5. Terminal Themes / Color Schemes
- User-selectable terminal color schemes (dracula, solarized, nord, monokai, gruvbox, etc.)
- Persist choice in localStorage
- Theme picker in terminal toolbar or settings
- **Why**: Personalization, accessibility (some themes have better contrast)

---

### Tier 2 — Cool, Needs More Thought

#### 6. Split-Pane / Multi-Terminal View
- View 2-4 sessions side by side in the browser
- Drag to resize panes
- Could mirror tmux's own pane layout or be independent browser-side layout
- Tricky on mobile — maybe tablet/desktop only
- **Why**: Power users monitoring multiple processes

#### 7. AI Chat Panel (Ask About Terminal Output)
- Side panel or overlay where you can ask Claude about what's on screen
- "What does this error mean?" / "How do I fix this?" / "Summarize what happened"
- Sends terminal buffer context to Claude API
- **Why**: Wave Terminal's killer feature — we already have Claude CLI integration

#### 8. Session Recording & Replay
- Record terminal I/O with timestamps (asciinema format or custom)
- Replay in browser with play/pause/speed controls
- Share recordings as links
- Storage consideration: recordings can be large
- **Why**: Debugging, demos, auditing, sharing "how I did X"

#### 9. Command Palette
- Ctrl+K or swipe gesture opens a search-driven command palette
- Quick access to: switch session, create session, run shortcut, toggle theme, search buffer
- Fuzzy matching on session names, shortcuts, commands
- **Why**: Power-user efficiency, keyboard-driven workflow

#### 10. Shareable Session Links
- Generate a time-limited or password-protected link to a session
- Read-only mode for observers, read-write for collaborators
- Shows viewer count badge (we already track `webClients`)
- Authentication layer needed — could piggyback on Cloudflare Access tokens
- **Why**: Pair programming, showing someone your terminal remotely

---

### Tier 3 — Nice to Have / Future

#### 11. tmux Pane Awareness
- Show individual panes within a tmux session, not just the composite view
- Navigate between panes from the dashboard
- Pane-level info (which process is running in each pane)
- Complex — requires tmux `display-message` / `list-panes` parsing
- **Why**: Heavy tmux users have complex pane layouts

#### 12. File Browser / Transfer
- Browse server filesystem from dashboard
- Upload files via drag & drop
- Download files from the terminal
- Security risk — needs careful scoping (restrict to home dir? project dirs?)
- **Why**: Upterm offers this; useful for quick config edits

#### 13. Session Snapshots
- Save current terminal buffer state as a named snapshot
- Restore/view snapshots later
- Diff between snapshots
- **Why**: "What did it look like before I ran that command?"

#### 14. Audio/Vibration Alerts
- Phone vibrates or plays a sound when a watched condition triggers
- Configurable patterns: process exit, specific output pattern, idle timeout
- Uses Web Vibration API + Audio API
- **Why**: Passive monitoring without constantly checking the screen

#### 15. Presence / Multi-User Awareness
- Show who else is connected to a session (avatar/initials)
- Cursor position sharing (sshx-style)
- Chat overlay between connected users
- **Why**: Collaboration, pair programming

#### 16. Session Favorites / Pinning
- Pin frequently-used sessions to the top of the dashboard
- Persist in localStorage or server-side
- Quick-access from PWA home screen
- **Why**: When you have many sessions but always care about 2-3

#### 17. Auto-Discovery of Claude Code Remote Sessions
- Claude Code supports `--remote-control` / `--rc` flag that exposes sessions accessible via claude.ai/code and mobile apps
- Also supports headless mode (`-p` / `--print`) with session IDs, `--continue`, `--resume`
- **Idea**: Auto-discover running Claude Code sessions on the host and surface them on the dashboard
  - Scan for running `claude` processes (similar to how we discover tmux/Kitty)
  - Detect `--remote-control` sessions and show their session URL / QR code directly in our dashboard
  - Detect headless (`-p`) sessions and show their session ID + status
  - Could parse `claude --resume <id>` to list known session IDs
- **Dashboard integration**: Special "Claude Code" badge on sessions running Claude, similar to Kitty badges
- **Deep link**: Tap a Claude Code session card → open it in our terminal view (it's already in tmux) OR link out to claude.ai/code
- **Remote Control bridge**: Show the QR code / session URL from `--rc` right in our UI so you don't need to look at the host terminal
- **Status indicators**: Show if a Claude session is active (thinking/coding), idle, or waiting for input
- **Why**: TUI Browser is already built for monitoring Claude Code sessions from your phone. This makes it first-class — you see which sessions have Claude running, their status, and can jump to the remote control URL without needing to be at the host terminal
- **References**:
  - [Remote Control docs](https://code.claude.com/docs/en/remote-control)
  - [Headless mode docs](https://code.claude.com/docs/en/headless)
  - [Simon Willison's writeup](https://simonwillison.net/2026/Feb/25/claude-code-remote-control/)

---

## xterm.js Addons — Full Inventory

All official addons from [xtermjs/xterm.js/addons](https://github.com/xtermjs/xterm.js/tree/master/addons). We currently use xterm 5.5.0 with **fit** and **webgl**. All others are available via jsDelivr CDN — no bundler needed.

### Currently Loaded

| Addon | Version | Purpose |
|-------|---------|---------|
| `@xterm/addon-fit` | 0.10.0 | Auto-resize terminal to container |
| `@xterm/addon-webgl` | 0.18.0 | GPU-accelerated rendering (60fps TUIs) |

### To Add — High Value

| Addon | Latest Stable | Purpose | Notes |
|-------|--------------|---------|-------|
| `@xterm/addon-search` | 0.16.0 | Ctrl+F search through scrollback buffer | Top feature request. Floating search bar UI needed. Highlight matches, navigate with arrows. |
| `@xterm/addon-web-links` | 0.12.0 | Clickable URLs in terminal output | Low effort, high value. Opens links in new tab. Especially useful on mobile where you can't Cmd+click. |
| `@xterm/addon-clipboard` | 0.2.0 | Better clipboard read/write via OSC 52 | Improves copy/paste reliability, especially on mobile and through tmux. |
| `@xterm/addon-unicode-graphemes` | 0.4.0 | Proper Unicode segmentation (emoji, ZWJ sequences) | Modern terminal output uses emoji heavily. Prevents rendering glitches. |
| `@xterm/addon-unicode11` | 0.9.0 | Unicode 11 character width tables | Complements unicode-graphemes. Fixes alignment issues with CJK and wide characters. |
| `@xterm/addon-web-fonts` | 0.1.0 | Proper web font loading before render | We use JetBrains Mono from system fonts, but this prevents FOUT if loading web fonts. |

### To Add — Nice to Have

| Addon | Latest Stable | Purpose | Notes |
|-------|--------------|---------|-------|
| `@xterm/addon-image` | 0.9.0 | Inline image display (Sixel, iTerm2 protocol) | Cool for image-capable workflows. Requires tmux `allow-passthrough` (already enabled). |
| `@xterm/addon-ligatures` | 0.10.0 | Font ligatures (=> becomes ⇒, etc.) | Nice for coding fonts like Fira Code, JetBrains Mono. May have performance cost. |
| `@xterm/addon-serialize` | 0.14.0 | Serialize terminal buffer state to string | Enables session snapshots feature. Could serialize buffer before disconnect for instant restore. |
| `@xterm/addon-progress` | 0.2.0 | Progress bar from terminal escape sequences (ConEmu OSC) | Shows progress in terminal title/tab. Niche but free to load. |

### Skip

| Addon | Why Skip |
|-------|----------|
| `@xterm/addon-attach` | We handle WebSocket I/O ourselves with custom batching (30ms buffer), JSON control messages, and reconnection logic. This addon would bypass all of that. |

---

## Open Questions

- **What's the primary use case we're optimizing for?** Solo developer checking on tasks from phone? Team collaboration? Server management?
- **Should we stay zero-build?** Some features (AI chat, file browser) might benefit from a lightweight bundler
- **Authentication**: Currently relies on Cloudflare Access. Do we need our own auth for features like session sharing?
- **Storage**: Session recordings and snapshots need disk space. How do we handle cleanup?
- **Mobile vs Desktop priority**: Some features (split-pane, command palette) are desktop-oriented. Do we lean into mobile or go balanced?
