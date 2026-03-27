<p align="center">
  <img src="public/icons/icon-512-flat.png" alt="TUI Browser" width="128">
</p>

<h1 align="center">TUI Browser</h1>

<p align="center">
  <strong>VNC for terminals</strong> — not another SSH web client.<br>
  Mirrors your actual desktop terminal to any browser in real-time.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#why-not-just-ssh">Why Not SSH?</a> &middot;
  <a href="#api">API</a>
</p>

---

Access and control your terminal sessions from any browser — phone, tablet, or another computer. The browser and host terminal stay perfectly in sync, both viewing and controlling the same tmux session. Unlike SSH tools that spawn isolated shells, this mirrors your actual desktop terminal in real-time.

Built for TUI-heavy workflows (Claude Code, OpenCode, Codex, htop, etc.) where you want to start something on your desktop and check on it from your phone. Supports multiple machines from a single dashboard.

<p align="center">
  <img src="public/readme_assets/session_listing.png" alt="Session dashboard" width="720">
  <br><sub>Session dashboard — AI-generated titles, status indicators, quick actions</sub>
</p>

## Features

### Core

- **VNC-style mirroring** — browser and Kitty terminal show the exact same content. Type in either, both update.
- **Session management** — create, connect, kill, rename sessions from the browser. New sessions also open a Kitty window on the host.
- **Multi-client** — multiple browsers can connect to the same session simultaneously.
- **AI session titles** — on-demand AI title generation via the title button in terminal view (uses Claude CLI haiku model).
- **Claude Code detection** — auto-detects Claude Code sessions and shows a Claude icon button when remote-control is active. Click to copy the URL, double-click to open it.
- **Text input panel** — compose text and send it to the terminal in one shot (like paste), avoids mobile keystroke drops. Pen icon in the quick-keys bar.
- **File browser** — per-server file manager accessible from each server group and terminal view. Browse, view, edit, upload, and download files. Opens to the terminal session's working directory.
- **Multi-machine federation** — connect multiple computers to one dashboard. Each machine runs its own tui-browser server; the client connects directly to each. Sessions are grouped by server with collapsible sections.
- **tui.json session overrides** — drop a `tui.json` in a project directory to customize sessions launched from there: custom titles, action buttons (URL links, file openers), and file browser CWD overrides. Auto-discovered, no API calls needed. See [tui.json format](#tuijson-overrides).
- **Mobile-optimized** — quick-keys bar (toggleable on all screen sizes), scroll controls, text selection overlay, keyboard-aware viewport.

### Dashboard & Session Tools

- **Unified dashboard** — tmux sessions grouped by server, enriched with Kitty metadata (tab title, focus state, viewer count). Collapsible server sections with state persisted in browser.
- **Server settings panel** — add/remove servers via the wrench icon. Enter Tailscale IPs or MagicDNS hostnames.
- **Quick Launch** — preset and custom commands saved to `shortcuts.json`, launch sessions in one tap.
- **Bulk session kill** — select multiple sessions to kill at once, or use filter presets: detached, idle, no running commands, or all.
- **Session info panel** — live-updating stats: memory, CPU, process tree, uptime, recent terminal output.
- **Session locking** — lock sessions to prevent accidental kills. Locked sessions disable the kill button.
- **Session sorting** — sort by newest, oldest, recently active, or least active.
- **Font size controls** — zoom in/out on the terminal view with +/- buttons.
- **Open on PC** — relaunch dangling sessions into a Kitty window from the dashboard.

### File Browser

- **Session-aware** — opens to the working directory of the current terminal session, or home directory from the dashboard.
- **Browse & navigate** — Google Files-style UI with breadcrumb path, folder-first sorting, vscode-icons for 1,480+ file types.
- **View & edit files** — CodeMirror 6 editor with syntax highlighting for 13 languages, read-only by default, tap Edit to modify and save.
- **Upload files** — drag-and-drop (or file picker on mobile) via FilePond, with progress bars and multi-file support.
- **Download files & folders** — single files download directly, folders download as zip archives.
- **File management** — create folders, rename, delete, copy, move. Long-press for context menu, single-tap to select for bulk actions.
- **Configurable access** — allowed directories set in `data/file-browser-config.json` (defaults to home directory). Path traversal prevention on all endpoints.

### Under the Hood

- **Tailscale network isolation** — binds exclusively to the Tailscale interface. Unreachable from public internet or local LAN.
- **Auto-update** — remote servers auto-pull from git and restart when the primary server's version bumps. Pre-commit hook auto-bumps patch version on every commit.
- **Auto-discovery** — PID matching links Kitty windows to their tmux sessions automatically.
- **60fps TUI rendering** — tmux + xterm.js WebGL handles high-frequency output (Claude Code, Ratatui apps, etc.)
- **PWA with auto-update** — installable app, polls server version, auto-reloads on code changes.
- **Cache-first rendering** — sessions load instantly from cache, no flash on page load or phone wake.
- **Online/offline detection** — toast notifications for connectivity changes.
- **Auto-restart** — systemd service with file watcher restarts the server on code changes.
- **Zero build frontend** — vanilla JS, xterm.js/FilePond from CDN, CodeMirror 6 + vscode-icons pre-bundled in `public/vendor/`.

<table>
  <tr>
    <td align="center">
      <img src="public/readme_assets/temrinal_view.png" alt="Terminal view" width="400">
      <br><sub>Terminal view — xterm.js with WebGL, quick-keys, scroll controls</sub>
    </td>
    <td align="center">
      <img src="public/readme_assets/session_info.png" alt="Session info panel" width="400">
      <br><sub>Session info — live memory, CPU, process tree, recent output</sub>
    </td>
  </tr>
</table>

## Quick Start

```bash
# Primary machine (serves the dashboard)
./install.sh --server-name desktop --primary

# Additional machines
./install.sh --server-name laptop
```

The install script handles:
- npm dependencies
- `~/.local/bin/tmux-kitty-shell` wrapper (launches Kitty windows inside tmux)
- `~/.tmux.conf` (terminal capabilities, UTF-8, passthrough for TUI apps)
- systemd user service (auto-start on boot, even before login)
- systemd file watcher (auto-restart on code changes)
- Server identity (`data/identity.json`) — names the server for the dashboard
- Pre-commit hook for auto version bumping

After install, the dashboard is at `http://<tailscale-ip>:7483`. Add additional servers via the wrench icon in the dashboard header.

### Manual Start (without systemd)

```bash
npm install
PORT=7483 npm start
```

### Prerequisites

- **Node.js** >= 18
- **tmux** >= 3.2 (for `allow-passthrough`)
- **Tailscale** — required for network access ([install](https://tailscale.com/download))
- **Kitty** (optional — for host terminal integration)
- **Claude CLI** (optional — for AI session title generation)

### Kitty Setup (optional)

Add to `~/.config/kitty/kitty.conf`:

```
allow_remote_control yes
listen_on unix:/tmp/kitty-socket
shell /path/to/your/.local/bin/tmux-kitty-shell
```

Restart Kitty. Every new window will launch inside tmux, and the dashboard will show them with Kitty badges.

### tui.json Overrides

Drop a `tui.json` file in any project directory to customize sessions launched from there. TUI Browser auto-discovers the file by checking each session's working directory during polling — no API calls or registration needed.

```json
{
  "my-project-id": {
    "title": "Custom Title",
    "fileCwd": "/path/to/project/working/dir",
    "sessions": ["session-name-abc1", "session-name-xyz9"],
    "actions": [
      { "id": "docs", "label": "Docs", "icon": "drupal", "type": "url", "url": "https://example.com" },
      { "id": "notes", "label": "Notes", "icon": "comment", "type": "file-open", "path": "/path/to/notes.md" }
    ]
  }
}
```

**Fields per entry:**
- `title` — overrides the session's display title (manual UI rename still takes precedence)
- `fileCwd` — overrides the file browser's default directory for this session
- `sessions` — array of tmux session names this entry applies to (the key can be any stable identifier)
- `actions` — buttons shown in the terminal toolbar:
  - `type: "url"` — opens the URL in a new browser tab
  - `type: "file-open"` — opens the file directly in the CodeMirror editor
  - `icon` — optional, renders an SVG icon instead of text label. Built-in: `drupal`, `comment`

**How it works:** Scripts that launch sessions (e.g., via Quick Launch) write/update `tui.json` before starting. The server records each session's origin CWD at creation time and checks for `tui.json` there during every discovery cycle (cached by mtime). Later, other tools (like Claude Code skills) can update the same file to add actions — changes appear within 3 seconds.

## Network Access (Tailscale)

TUI Browser requires [Tailscale](https://tailscale.com/) for network access. Tailscale creates an encrypted mesh VPN — the server binds exclusively to its Tailscale IP and is invisible to the public internet and local LAN.

**Setup:**

1. Install Tailscale on all machines: https://tailscale.com/download
2. Run `tailscale up` and authenticate
3. Run `./install.sh` — it auto-detects the Tailscale IP and binds to it

**Access from any device:**
- Install the Tailscale app (Android, iOS, macOS, Windows, Linux)
- Join the same Tailscale network
- Open `http://<tailscale-ip>:7483` in your browser

**MagicDNS:** Tailscale assigns each machine a hostname like `machine-name.tailnet-name.ts.net`. Use these instead of raw IPs.

**Custom domain (optional):** Point a DNS A record to the Tailscale IP (e.g., `tui.yourdomain.com` → `100.x.x.x`). Set the record to **DNS only** (not proxied) in your DNS provider. The domain resolves globally but only Tailscale devices can connect.

### Additional Machine Setup

After running `./install.sh` on a new machine, a few extra steps may be needed:

**File browser icons:** The vscode-icons SVGs are gitignored and generated locally. If the file browser shows no icons, regenerate with `bash scripts/bundle-vscode-icons.sh` (requires npm in PATH).

**Node.js via nvm:** If using nvm instead of Volta or system Node, ensure the systemd unit can find Node. Check that `ExecStart` in `~/.config/systemd/user/tui-browser.service` points to the correct Node binary and `PATH` includes your nvm bin directory.

## Security

**This tool gives full shell access and filesystem access from a browser.**

TUI Browser binds exclusively to the Tailscale network interface. It is unreachable from the public internet or local LAN — only devices on your Tailscale network can connect.

**Defense layers:**
- **Network isolation** — server binds to Tailscale IP only (`BIND` env var)
- **WireGuard encryption** — all traffic encrypted end-to-end by Tailscale
- **Device authentication** — only devices you approve on your Tailscale account can reach the server
- **No exposed ports** — nothing listens on public or LAN interfaces

**Recommended firewall rules** (defense in depth):
```bash
# Block tui-browser ports on all non-Tailscale interfaces
sudo ufw deny 7483
sudo ufw deny 7484
```

## Service Management

```bash
# TUI Browser server
systemctl --user start tui-browser
systemctl --user stop tui-browser
systemctl --user restart tui-browser
systemctl --user status tui-browser
journalctl --user -u tui-browser -f    # tail logs
```

## API

### REST

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/discover` | Unified discovery (tmux sessions + Kitty windows) |
| `GET` | `/api/version` | Server version + build ID + claude availability |
| `GET` | `/api/identity` | Server name + package version (for federation) |
| `GET` | `/api/health` | Server + tmux + Kitty status |
| `GET` | `/api/servers` | Multi-server configuration list |
| `PUT` | `/api/servers` | Update server list `{ servers: [{ name, url }] }` |
| `GET` | `/api/update/status` | Check if self-update is in progress |
| `POST` | `/api/update` | Trigger git pull + npm install + restart |
| `GET` | `/api/sessions` | List tmux sessions |
| `GET` | `/api/sessions/:name` | Session details + preview |
| `GET` | `/api/sessions/:name/info` | Live session stats (memory, CPU, processes, output) |
| `GET` | `/api/sessions/:name/claude-status` | Detect Claude Code session + remote-control URL |
| `GET` | `/api/kitty/windows` | Kitty window discovery (debug, prefer `/api/discover`) |
| `POST` | `/api/sessions` | Create session `{ name, command, cwd }` |
| `POST` | `/api/sessions/bulk-kill` | Bulk kill `{ names[], filter?, inactiveMinutes? }` |
| `POST` | `/api/sessions/:name/rename` | Rename `{ newName }` |
| `POST` | `/api/sessions/:name/open-terminal` | Open Kitty window for session |
| `POST` | `/api/sessions/:name/generate-title` | AI-generate session title via Claude CLI |
| `POST` | `/api/shortcuts` | Add custom shortcut `{ label, command }` |
| `DELETE` | `/api/sessions/:name` | Kill session |
| **File Browser** | | |
| `POST` | `/api/files/list` | List directory contents `{ path, showHidden? }` |
| `POST` | `/api/files/read` | Read text file `{ path }` — returns content or binary/size flag |
| `POST` | `/api/files/write` | Save file `{ path, content }` |
| `POST` | `/api/files/upload` | Upload files (multipart, field: `filepond`, query: `targetDir`) |
| `GET` | `/api/files/download` | Download file or zip folder `?path=...` |
| `POST` | `/api/files/mkdir` | Create directory `{ path }` (recursive, idempotent) |
| `POST` | `/api/files/rename` | Rename `{ oldPath, newPath }` — 409 if target exists |
| `POST` | `/api/files/delete` | Delete file/folder `{ path }` (recursive for dirs) |
| `POST` | `/api/files/move` | Move `{ src, dest, overwrite? }` — 409 if exists |
| `POST` | `/api/files/copy` | Copy `{ src, dest, overwrite? }` — 409 if exists |
| `GET` | `/api/files/cwd` | Get tmux session CWD `?session=name` |

### WebSocket

Connect to `/ws/terminal/:sessionName`:

```js
// Client → Server
{ "type": "attach", "cols": 80, "rows": 24 }
{ "type": "input", "data": "ls\r" }
{ "type": "resize", "cols": 120, "rows": 40 }

// Server → Client
// Raw terminal output (ANSI preserved) or:
{ "type": "session-ended", "sessionName": "..." }
```

## Project Structure

```
tui-browser/
├── server/
│   ├── index.js              # HTTP/HTTPS + WebSocket server orchestrator
│   ├── routes.js             # All REST API route handlers
│   ├── state.js              # Persistent state (display titles, locks)
│   ├── ai-titles.js          # AI title generation via Claude CLI
│   ├── session-manager.js    # PTY lifecycle, multi-client, Kitty launch
│   ├── discovery.js          # tmux + unified discovery with PID matching
│   ├── kitty-discovery.js    # Kitty remote control discovery
│   ├── claude-detect.js      # Claude Code session + remote-control detection
│   ├── file-routes.js        # File browser REST API (browse, edit, upload, download)
│   ├── identity.js           # Server identity (name + version for federation)
│   ├── servers.js            # Multi-server config CRUD (data/servers.json)
│   ├── update.js             # Self-update endpoint (git pull + restart)
│   └── exec-util.js          # Shared subprocess utility
├── public/
│   ├── index.html            # SPA shell
│   ├── js/
│   │   ├── app.js            # Hash router, modal, toast, version polling
│   │   ├── server-manager.js # Multi-server connection manager + discovery aggregator
│   │   ├── settings-panel.js # Server settings overlay (add/edit/remove servers)
│   │   ├── dashboard.js      # Session cards, server groups, rendering, CRUD
│   │   ├── dashboard-shortcuts.js  # Quick Launch dropdown
│   │   ├── dashboard-bulk-kill.js  # Selection + bulk kill modal
│   │   ├── dashboard-info.js       # Session info overlay
│   │   ├── terminal.js       # xterm.js setup + WebSocket connection
│   │   ├── terminal-text-input.js  # Compose-and-send text panel + quickbar toggle
│   │   ├── terminal-controls.js    # Scroll, text select, session ops
│   │   ├── file-browser.js         # File browser overlay (navigation, context menu, selection)
│   │   ├── file-editor.js          # CodeMirror 6 file editor (view/edit text files)
│   │   └── file-upload.js          # FilePond upload overlay
│   └── css/
│       ├── base.css           # Theme variables, header, buttons, modal
│       ├── dashboard.css      # Session cards, toolbar, shortcuts
│       ├── terminal.css       # Terminal view, quick-keys, scroll controls
│       ├── info-panel.css     # Session info overlay + stats
│       └── file-browser.css  # File browser, editor, upload, context menu styles
│   ├── vendor/
│   │   ├── codemirror.bundle.js  # Pre-built CodeMirror 6 (13 languages)
│   │   └── vscode-icons.js       # Pre-built vscode-icons browser bundle
│   └── icons/                    # vscode-icons SVGs (1,480 file type icons, gitignored)
├── scripts/
│   ├── tmux-kitty-shell          # Wrapper: launches Kitty windows inside tmux
│   ├── bump-version.sh           # Pre-commit hook: auto-bump patch version
│   ├── bundle-codemirror.sh      # One-time CodeMirror 6 build script
│   └── bundle-vscode-icons.sh    # One-time vscode-icons build script
├── install.sh                # One-command setup
└── package.json
```

## Mobile Controls

The terminal view includes touch-optimized controls:

- **Quick-keys bar** — Esc, Tab, Ctrl+C/D/Z, arrow keys, Sel (text select), and a pen icon to open the text input panel. Always visible on mobile, toggled via the pill button on desktop/tablet.
- **Text input panel** — compose text freely, then send to terminal in one shot. Enter sends, Shift+Enter for newlines, auto-expands up to 5 lines. Fullscreen mode for longer text.
- **Scroll controls** — floating up/down buttons (top-right) to scroll tmux history via copy-mode
- **Text selection** — tap Sel to open terminal output in a native-selectable overlay with Copy All
- **Keyboard awareness** — UI shifts above the soft keyboard automatically
- **Double-tap** a session card on the dashboard to connect directly

## Kitty + tmux Gotchas

Running Kitty windows inside tmux breaks a few things (tab CWD, titles, Shift+Enter). See [docs/kitty-tmux-integration.md](docs/kitty-tmux-integration.md) for fixes.

## tmux Tips

- **Scroll up**: mouse wheel scrolls the buffer when `mouse on` is set in `~/.tmux.conf` (the install script enables this).
- **Select text**: hold `Shift` while clicking/dragging to use your terminal's native selection — this bypasses tmux's copy mode, which otherwise jumps to the bottom after selecting.
- **Copy-mode (keyboard)**: `Ctrl+b` then `[` enters copy mode. Use arrow keys / `Page Up` / `Page Down` to scroll. Press `q` to exit.

## AI Session Titles

If the [Claude CLI](https://claude.com/claude-code) is installed, sessions can be auto-titled based on their terminal content:

- **Automatic**: new sessions get a title once they cross 15 lines of output (one-time, uses haiku model)
- **Manual**: click the sparkle icon next to the session name in terminal view to regenerate
- **Smart context**: extracts first 150 + last 150 lines of the last command's output (skips the middle for long outputs)
- **Human-safe**: manually renamed sessions are never auto-overwritten

## How It Works

```
Phone/Tablet/Laptop Browser              Machine A (primary)          Machine B (remote)
┌──────────────────────────┐            ┌──────────────────────┐    ┌──────────────────────┐
│  Dashboard               │            │  Node.js Server      │    │  Node.js Server      │
│  ┌─ HOST ──────────────┐ │   HTTPS    │  ├── REST API        │    │  ├── REST API        │
│  │ Sessions from A     │ │◄══════════►│  ├── WebSocket       │    │  ├── WebSocket       │
│  └─────────────────────┘ │ Tailscale  │  ├── tmux discovery  │    │  ├── tmux discovery  │
│  ┌─ LAPTOP ────────────┐ │ WireGuard  │  ├── serves frontend │    │  ├── /api/identity   │
│  │ Sessions from B     │ │ encrypted  │  ├── /api/servers    │    │  └── /api/update     │
│  └─────────────────────┘ │◄══════╦═══►│  └── session-manager │    └──────────────────────┘
│  Terminal View           │       ║    └──────────────────────┘               │
│  ┌─────────────────────┐ │       ║               │                          ▼
│  │ xterm.js — direct   │ │       ╚══════════════════════════►    ┌────────────────────┐
│  │ WireGuard to B      │ │                       ▼               │ tmux sessions      │
│  └─────────────────────┘ │            ┌────────────────────┐    └────────────────────┘
└──────────────────────────┘            │ tmux sessions      │
                                        └────────────────────┘
```

1. **Every Kitty window runs inside tmux** via a wrapper script (`tmux-kitty-shell`)
2. **PID matching** links Kitty windows to tmux sessions (`kitty_window.pid == tmux_client.client_pid`)
3. **Browser connects** to the same tmux session via node-pty + WebSocket
4. **Both viewers** (Kitty + browser) see identical output — tmux handles multi-client sync natively
5. **Creating a session** from the browser also opens a Kitty window on the host
6. **Killing a session** from the browser closes the Kitty window automatically

### Multi-Machine Federation

Each machine runs its own independent tui-browser server. The primary server hosts the frontend SPA. The client (browser) connects directly to each server via Tailscale — no proxy or relay.

- **HOST** group always shows the primary server's sessions
- Additional servers are added via the settings panel (wrench icon)
- The client connects directly via Tailscale using the configured IP or MagicDNS hostname
- Terminal WebSocket connects directly to the session's origin server
- Version sync: when the primary's `package.json` version bumps, remote servers auto-pull and restart

#### Setting Up a New Machine

1. **Install tui-browser** on the new machine:
   ```bash
   git clone git@github.com:AJV009/tui-browser.git
   cd tui-browser
   ./install.sh --server-name <name>   # use --primary on the main machine
   ```

2. **Install Tailscale** and join the same network:
   ```bash
   # Install: https://tailscale.com/download
   tailscale up
   ```

3. **Add the server** in the primary's dashboard via the wrench icon, using the machine's Tailscale IP or MagicDNS hostname.

---

## Why Not Just SSH?

SSH-based web terminals (WeTTY, shellinabox) and terminal sharing tools solve a different problem. They give you a *new* shell session in your browser. TUI Browser gives you your *existing* session — the one already running on your desktop.

**The core difference is mirroring vs. remoting:**

| | SSH web clients | TUI Browser |
|---|---|---|
| **What you see** | A new, separate shell | Your actual desktop terminal |
| **Session relationship** | Independent — browser and desktop are different sessions | Shared — browser and desktop are the same session |
| **Start a build on desktop, check from phone** | Can't — phone has its own shell | Yes — phone sees exactly what your desktop shows |
| **Multiple viewers** | Each gets their own session | All see the same output, type into the same session |
| **Session persistence** | Dies when browser tab closes | tmux session persists forever — reconnect anytime |
| **TUI rendering (60fps)** | Varies — often broken through SSH layers | Native — raw PTY via node-pty + WebGL xterm.js |

**Why WebSocket instead of SSH for transport?** SSH multiplexes its own channels and requires key/password auth on every connection — overhead that adds nothing when the server and terminal are on the same machine. WebSocket gives us raw bidirectional binary streaming over HTTPS with custom input batching (30ms buffer), JSON control messages for resize/attach/detach, and reconnection logic that SSH can't express. The browser connects to a local node-pty process that attaches to tmux — there's no remote host to SSH into.

### Similar tools and how they compare

| Tool | What it does | Key difference from TUI Browser |
|------|-------------|------|
| **ttyd** | Exposes a single terminal process to the browser | One-shot PTY — no session persistence, no mirroring, no dashboard |
| **GoTTY** | Same concept as ttyd, in Go | Same limitations — single terminal, no multi-client sync |
| **WeTTY** | SSH client in the browser (Node.js) | Spawns new SSH sessions — doesn't mirror your existing terminal |
| **sshx** | Collaborative terminal sharing with multiplayer cursors | Separate sessions per user with shared view — no host terminal integration |
| **tmate** | tmux fork for instant session sharing | Fork of tmux (not the real thing) — designed for pair programming, not mobile access to your own sessions |
| **Upterm** | Terminal sharing via link | Focused on sharing with others, not on accessing your own sessions from your phone |
| **Wave Terminal** | AI-powered desktop terminal app | Desktop app, not a web remote — different category entirely |

TUI Browser sits in a unique spot: it's a **personal terminal dashboard** that mirrors your real desktop sessions to your phone/tablet, with session discovery, lifecycle management, and a mobile-optimized UI. The closest analogy is VNC — but for your terminal, not your whole screen.

---

## License

[AGPL-3.0](LICENSE) — free to use, modify, and distribute. If you modify it and offer it as a network service, you must open-source your modifications under the same license.
