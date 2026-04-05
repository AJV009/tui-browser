<p align="center">
  <img src="public/icons/icon-512-flat.png" alt="TUI Browser" width="128">
</p>

<h1 align="center">TUI Browser</h1>

<p align="center">
  <strong>VNC for terminals</strong> — not another SSH web client.<br>
  Mirrors your actual desktop terminal to any browser in real-time.
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#security">Security</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#gotchas--tips">Gotchas & Tips</a>
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

## Security

**This tool gives full shell access and filesystem access from a browser.** Do not expose it to the public internet or untrusted networks without understanding the risks. Use a VPN like Tailscale to restrict access to trusted devices only.

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

<details>
<summary><h3>Network Access using Tailscale (recommended)</h3></summary>

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

#### Additional Machine Setup

After running `./install.sh` on a new machine, a few extra steps may be needed:

**File browser icons:** The vscode-icons SVGs are gitignored and generated locally. If the file browser shows no icons, regenerate with `bash scripts/bundle-vscode-icons.sh` (requires npm in PATH).

**Node.js via nvm:** If using nvm instead of Volta or system Node, ensure the systemd unit can find Node. Check that `ExecStart` in `~/.config/systemd/user/tui-browser.service` points to the correct Node binary and `PATH` includes your nvm bin directory.

</details>

## How It Works

```
Phone/Tablet/Laptop Browser              Machine A (primary)          Machine B (remote)
┌──────────────────────────┐            ┌──────────────────────┐    ┌──────────────────────┐
│  Dashboard               │            │  Node.js Server      │    │  Node.js Server      │
│  ┌─ HOST ──────────────┐ │   HTTP     │  ├── REST API        │    │  ├── REST API        │
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

<details>
<summary><h2>Why Not Just SSH?</h2></summary>

Every tool in this space either **creates new sessions** or **requires you to go through it**. TUI Browser does neither — it discovers your running tmux sessions and gives you a web view into them. The terminal sessions are the source of truth; the web layer is a lens, not a replacement.

**The core difference is mirroring vs. remoting:**

| | SSH web clients | TUI Browser |
|---|---|---|
| **What you see** | A new, separate shell | Your actual desktop terminal |
| **Session relationship** | Independent — browser and desktop are different sessions | Shared — browser and desktop are the same session |
| **Start a build on desktop, check from phone** | Can't — phone has its own shell | Yes — phone sees exactly what your desktop shows |
| **Multiple viewers** | Each gets their own session | All see the same output, type into the same session |
| **Session persistence** | Dies when browser tab closes | tmux session persists forever — reconnect anytime |
| **TUI rendering (60fps)** | Varies — often broken through SSH layers | Native — raw PTY via node-pty + WebGL xterm.js |

**Why WebSocket instead of SSH for transport?** SSH multiplexes its own channels and requires key/password auth on every connection — overhead that adds nothing when the server and terminal are on the same machine. WebSocket gives us raw bidirectional binary streaming over HTTP with custom input batching (30ms buffer), JSON control messages for resize/attach/detach, and reconnection logic that SSH can't express. The browser connects to a local node-pty process that attaches to tmux — there's no remote host to SSH into.

<details>
<summary><strong>Alternatives comparison</strong> — how every major tool in this space differs</summary>

### Web-Based Terminal Servers

Tools that expose a terminal command over HTTP. The closest category to TUI Browser architecturally, but none discover or attach to existing sessions.

| Tool | Stack | What it does | Attach existing tmux? | Multi-client? |
|------|-------|-------------|----------------------|---------------|
| **[ttyd](https://github.com/tsl0922/ttyd)** | C, libwebsockets, xterm.js | Exposes one command per port via WebSocket. ~11k stars, actively maintained. | Only via `ttyd tmux new -A -s name` — no discovery, no dashboard, one session per instance. | Via tmux sharing only. |
| **[GoTTY](https://github.com/sorenisanerd/gotty)** | Go | Same concept as ttyd. Original repo unmaintained; maintained fork by sorenisanerd. | Same indirect approach as ttyd. | Via tmux sharing only. |
| **[Zellij](https://github.com/zellij-org/zellij)** | Rust | Terminal multiplexer with a built-in web client (v0.44+). Sessions map to URLs, multi-client support, session resurrection. | Attaches to Zellij sessions, not tmux — requires replacing your multiplexer entirely. | Yes, native. |

**ttyd** is the closest lightweight alternative — but it's a "run one command" tool. You'd need to spawn/kill ttyd instances dynamically and build a discovery layer on top, which is essentially what TUI Browser already does with node-pty. Swapping node-pty for ttyd adds a process boundary without gaining anything.

**Zellij** is the most architecturally similar — web access, session URLs, multi-client — but it replaces tmux rather than wrapping it, and adds significant in-terminal UI chrome and latency.

### Browser-Based SSH Proxies

These put an SSH client in the browser by proxying through a server: `Browser → WebSocket → server-side SSH client → sshd → shell`. Each browser tab gets its own SSH session — no sharing.

| Tool | Stack | Notes |
|------|-------|-------|
| **[WeTTy](https://github.com/butlerx/wetty)** | Node.js/TypeScript | ~5k stars. Web wrapper around SSH. Can technically `tmux attach` inside the SSH session, but each tab is independent. |
| **[WebSSH2](https://github.com/billchurch/webssh2)** | Node.js/TypeScript | ~2.7k stars. SSH via Socket.io + ssh2 library. Host key verification (TOFU). |
| **[Sshwifty](https://github.com/nirui/sshwifty)** | Go | ~3k stars. SSH + Telnet client. Single binary. Connection presets. |

All of these add an SSH hop compared to TUI Browser's direct `WebSocket → node-pty → tmux attach` path. They're designed for accessing remote machines from a browser, not for mirroring your own desktop terminal.

### Terminal Sharing / Collaboration

Tools designed for sharing your terminal with others. They create or wrap sessions for collaborative access — different goal than personal mobile access.

| Tool | Stack | What it does | Attach existing tmux? |
|------|-------|-------------|----------------------|
| **[tmate](https://github.com/tmate-io/tmate)** | C (tmux fork) | ~6k stars. Forks tmux itself, tunnels via SSH to a relay server. Read-only and read-write URLs. Self-hostable server. | **No** — creates its own tmux sessions. Cannot attach to existing ones. |
| **[sshx](https://github.com/ekzhang/sshx)** | Rust | ~7k stars. Infinite canvas with multiple terminal panes, real-time collaboration cursors, E2E encrypted. | **No** — creates its own sessions. |
| **[Upterm](https://github.com/owenthereal/upterm)** | Go | ~1.2k stars. Reverse SSH tunnel, collaborators connect via standard `ssh` command. Self-hostable relay. | Shares the current command/shell, not tmux-aware. |
| **[TermPair](https://github.com/cs01/termpair)** | Python | ~1.7k stars. AES-GCM E2E encrypted, server is a blind router. Multiple browser viewers. | Shares the terminal it runs in — not tmux-specific. |
| **[WebTTY](https://github.com/maxmcd/webtty)** | Go | ~2.8k stars. **WebRTC peer-to-peer** — no relay server for data. Signaling via copy-paste. | **No** — single host, single viewer. |
| **[tty-share](https://github.com/elisescu/tty-share)** | Go | Shareable URL for your terminal. Browser or CLI viewer. | No tmux integration. |

### Native Resilient Connections (No Browser)

These solve connection resilience (surviving network changes, sleep/wake) but have no browser story. Great for terminal-to-terminal access alongside TUI Browser.

| Tool | Transport | Key advantage | Limitation |
|------|-----------|--------------|------------|
| **[Mosh](https://mosh.org/)** | UDP (State Sync Protocol) | Survives IP changes, sleep/wake, high latency. Predictive local echo makes typing feel instant. | No scrollback (need tmux), no port forwarding, requires UDP 60000-61000 open. No browser client (Chrome NaCl extension is dead). |
| **[Eternal Terminal](https://github.com/MisterTea/EternalTerminal)** | TCP | Like Mosh but with scrollback, port forwarding, uses TCP (easier firewalls). Auto-reconnects seamlessly. | No browser client. C++, ~3.6k stars. |

Both can attach to existing tmux sessions (`mosh host -- tmux attach`, `et host -c "tmux attach"`). They complement TUI Browser — use them from a real terminal, use TUI Browser from a browser.

### Enterprise / Heavyweight

| Tool | Stack | Notes |
|------|-------|-------|
| **[Apache Guacamole](https://guacamole.apache.org/)** | Java + C daemon (guacd) | Clientless remote desktop gateway — SSH, RDP, VNC, Telnet, Kubernetes. Server-side terminal rendering (not xterm.js). Multi-user viewing, session recording, SFTP. Heavy infrastructure (Java webapp + guacd + database). |
| **[JumpServer](https://github.com/jumpserver/jumpserver)** | Python/Django | ~30k stars. Full PAM platform — RBAC, audit trails, session recording, AD/LDAP/SAML. SSH, RDP, VNC, K8s, databases. Enterprise access management. |

Both are designed for multi-user access governance, not personal terminal mirroring.

### Protocol Comparison

| Approach | Transport | Path to terminal | Trade-off |
|----------|-----------|-----------------|-----------|
| **TUI Browser** | WebSocket (TCP) | `Browser → WS → node-pty → tmux attach` | Direct, minimal hops. No auth overhead (Tailscale handles it). |
| **SSH proxies** | WebSocket → SSH (TCP) | `Browser → WS → ssh2 → sshd → shell` | Extra hop + SSH auth on every connection. |
| **Mosh** | UDP | `Client → SSP → mosh-server → shell` | State sync (not stream), survives network changes. No browser. |
| **Guacamole** | WebSocket → Guacamole protocol (TCP) | `Browser → WS → Java → guacd → SSH/VNC` | Server-side rendering. Heavy but protocol-agnostic. |
| **WebRTC** | UDP (P2P) | `Browser → DataChannel → peer` | True P2P after signaling. Not widely adopted for terminals. |
| **tmate** | SSH (TCP) | `tmate client → msgpack → relay → SSH → viewer` | tmux state sync over SSH tunnel. Can't attach to real tmux. |

</details>

TUI Browser sits in a unique spot: it's a **stateless web bridge to your existing terminal sessions** — it discovers running tmux sessions, exposes them over WebSocket, and lets multiple clients attach without configuration. The terminal sessions are the source of truth; the web layer is a view into them, not a replacement. No other tool does this.

</details>

---

## Gotchas & Tips

### Kitty + tmux

Running Kitty windows inside tmux breaks a few things (tab CWD, titles, Shift+Enter). See [docs/kitty-tmux-integration.md](docs/kitty-tmux-integration.md) for fixes.

### tmux Tips

- **Scroll up**: mouse wheel scrolls the buffer when `mouse on` is set in `~/.tmux.conf` (the install script enables this).
- **Select text**: hold `Shift` while clicking/dragging to use your terminal's native selection — this bypasses tmux's copy mode, which otherwise jumps to the bottom after selecting.
- **Copy-mode (keyboard)**: `Ctrl+b` then `[` enters copy mode. Use arrow keys / `Page Up` / `Page Down` to scroll. Press `q` to exit.

### AI Session Titles

If the [Claude CLI](https://claude.com/claude-code) is installed, sessions can be auto-titled based on their terminal content:

- **Automatic**: new sessions get a title once they cross 15 lines of output (one-time, uses haiku model)
- **Manual**: click the sparkle icon next to the session name in terminal view to regenerate
- **Smart context**: extracts first 150 + last 150 lines of the last command's output (skips the middle for long outputs)
- **Human-safe**: manually renamed sessions are never auto-overwritten

### File Browser Symlinks

The file browser resolves symlinks to their **real path** before checking access. If a symlink inside `$HOME` points to `/opt/something`, the resolved path must fall within one of your configured `allowedRoots` in `data/file-browser-config.json` — otherwise access is denied.

This is intentional: symlinks should not be an escape hatch out of the allowed directory sandbox. To fix it, add the symlink's target directory to your `allowedRoots`:

```json
{
  "allowedRoots": ["$HOME", "/opt/something"]
}
```

Then restart the server.

### Mobile Controls

The terminal view includes touch-optimized controls:

- **Quick-keys bar** — Esc, Tab, Ctrl+C/D/Z, arrow keys, Sel (text select), and a pen icon to open the text input panel. Always visible on mobile, toggled via the pill button on desktop/tablet.
- **Text input panel** — compose text freely, then send to terminal in one shot. Enter sends, Shift+Enter for newlines, auto-expands up to 5 lines. Fullscreen mode for longer text.
- **Scroll controls** — floating up/down buttons (top-right) to scroll tmux history via copy-mode
- **Text selection** — tap Sel to open terminal output in a native-selectable overlay with Copy All
- **Keyboard awareness** — UI shifts above the soft keyboard automatically
- **Double-tap** a session card on the dashboard to connect directly

---

<details>
<summary><h3>API Reference</h3></summary>

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

</details>

<details>
<summary><h3>Project Structure</h3></summary>

```
tui-browser/
├── server/
│   ├── index.js              # HTTP + WebSocket server orchestrator
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
│   ├── tui-overrides.js      # tui.json discovery and caching
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
│   │   ├── terminal-notes.js       # Sent history + persistent notes scratchpad
│   │   ├── file-browser.js         # File browser overlay (navigation, context menu, selection)
│   │   ├── file-editor.js          # CodeMirror 6 file editor (view/edit text files)
│   │   └── file-upload.js          # FilePond upload overlay
│   ├── css/
│   │   ├── base.css           # Theme variables, header, buttons, modal
│   │   ├── dashboard.css      # Session cards, toolbar, shortcuts
│   │   ├── terminal.css       # Terminal view, quick-keys, scroll controls
│   │   ├── info-panel.css     # Session info overlay + stats
│   │   └── file-browser.css   # File browser, editor, upload, context menu styles
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

</details>

<details>
<summary><h3>Service Management</h3></summary>

```bash
# TUI Browser server
systemctl --user start tui-browser
systemctl --user stop tui-browser
systemctl --user restart tui-browser
systemctl --user status tui-browser
journalctl --user -u tui-browser -f    # tail logs
```

</details>

---

## License

[AGPL-3.0](LICENSE) — free to use, modify, and distribute. If you modify it and offer it as a network service, you must open-source your modifications under the same license.
