# TUI Browser

VNC for terminals. Access and control your terminal sessions from any browser — phone, tablet, or another computer. The browser and host terminal stay perfectly in sync, both viewing and controlling the same tmux session.

Built for TUI-heavy workflows (Claude Code, OpenCode, Codex, htop, etc.) where you want to start something on your desktop and check on it from your phone.

```
Phone/Tablet/Laptop Browser              Host Machine (Kitty + tmux)
┌──────────────────────────┐            ┌────────────────────────────────────┐
│  Dashboard               │            │  Node.js Server (port 7483)       │
│  ┌─────────────────────┐ │   HTTPS    │  ├── REST API (session CRUD)      │
│  │ Unified session     │ │◄══════════►│  ├── WebSocket (terminal I/O)     │
│  │ cards with Kitty    │ │  Cloudflare│  ├── tmux discovery               │
│  │ badges              │ │   Tunnel   │  ├── Kitty discovery + PID match  │
│  └─────────────────────┘ │            │  └── session-manager (node-pty)   │
│  Terminal View           │            │       └── tmux attach             │
│  ┌─────────────────────┐ │            └────────────────────────────────────┘
│  │ xterm.js (WebGL)    │ │                       │
│  │ Full bidirectional  │ │                       ▼
│  │ terminal I/O        │ │            ┌────────────────────┐
│  └─────────────────────┘ │            │ tmux session       │
└──────────────────────────┘            │ (shared by Kitty   │
                                        │  + browser)        │
                                        └────────────────────┘
```

## Features

- **VNC-style mirroring** — browser and Kitty terminal show the exact same content. Type in either, both update.
- **Unified dashboard** — tmux sessions enriched with Kitty metadata (tab title, focus state, viewer count)
- **Auto-discovery** — PID matching links Kitty windows to their tmux sessions automatically
- **Session management** — create, connect, kill, rename sessions from the browser. New sessions also open a Kitty window on the host.
- **Session info panel** — live-updating stats: memory, CPU, process tree, uptime, recent terminal output
- **AI session titles** — uses Claude CLI (haiku) to auto-generate contextual session names from terminal output
- **Quick Launch** — preset and custom commands saved to `shortcuts.json`, launch sessions in one tap
- **Session sorting** — sort by newest, oldest, recently active, or least active
- **Open on PC** — relaunch dangling sessions into a Kitty window from the dashboard
- **Multi-client** — multiple browsers can connect to the same session
- **60fps TUI support** — tmux + xterm.js WebGL handles high-frequency rendering (Claude Code, Ratatui apps, etc.)
- **Mobile-optimized** — quick-keys bar, scroll controls, text selection overlay, keyboard-aware viewport
- **PWA with auto-update** — installable app, polls server version, auto-reloads on code changes
- **Online/offline detection** — toast notifications for connectivity changes
- **Cache-first rendering** — sessions load instantly from cache, no flash on page load or phone wake
- **Auto-restart** — systemd service with file watcher restarts the server on code changes
- **Cloudflare Tunnel** — secure remote access via HTTPS with zero port forwarding
- **Zero build frontend** — vanilla JS, xterm.js from CDN, no bundler

## Quick Start

```bash
# One-command setup: installs deps, configures tmux, sets up systemd service
./install.sh
```

The install script handles:
- npm dependencies
- `~/.local/bin/tmux-kitty-shell` wrapper (launches Kitty windows inside tmux)
- `~/.tmux.conf` (terminal capabilities, UTF-8, passthrough for TUI apps)
- systemd user service (auto-start on boot, even before login)
- systemd file watcher (auto-restart on code changes)

After install, the dashboard is at `http://localhost:7483`.

### Manual Start (without systemd)

```bash
npm install
PORT=7483 npm start
```

### Prerequisites

- **Node.js** >= 18
- **tmux** >= 3.2 (for `allow-passthrough`)
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

## Remote Access (Cloudflare Tunnel)

For secure access from anywhere (phone, other computers), use a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
# Create tunnel
cloudflared tunnel create tui-browser

# Route your domain
cloudflared tunnel route dns tui-browser tui.yourdomain.com

# Create config (~/.cloudflared/tui-browser.yml)
tunnel: <TUNNEL_ID>
credentials-file: /path/to/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: tui.yourdomain.com
    service: http://localhost:7483
  - service: http_status:404
```

Then create a systemd user service to keep the tunnel running:

```ini
# ~/.config/systemd/user/tui-browser-tunnel.service
[Unit]
Description=Cloudflare Tunnel for TUI Browser
After=network-online.target tui-browser.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --config /path/to/.cloudflared/tui-browser.yml run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now tui-browser-tunnel.service
```

## Security

**This tool gives full shell access from a browser. Do not expose without authentication.**

### Recommended: Cloudflare Access (Zero Trust)

If using Cloudflare Tunnel, add [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/) for authentication:

1. Go to **Cloudflare One** → **Access** → **Applications**
2. Add a **Self-hosted** application with your tunnel domain
3. Create an **Allow** policy with your email
4. Cloudflare shows a login page and sends a one-time code to verify identity

This is the recommended approach — authentication is handled by Cloudflare's infrastructure before traffic ever reaches your server. No passwords to manage, no custom auth code to maintain.

### Alternatives

- **Reverse proxy with auth** — nginx/Caddy with TLS + basic auth or OAuth
- **Localhost only** — bind to 127.0.0.1 and use SSH tunneling (`ssh -L 7483:localhost:7483 user@host`)
- **Firewall** — block port 7483 from external access

## Service Management

```bash
# TUI Browser server
systemctl --user start tui-browser
systemctl --user stop tui-browser
systemctl --user restart tui-browser
systemctl --user status tui-browser
journalctl --user -u tui-browser -f    # tail logs

# Cloudflare tunnel (if configured)
systemctl --user start tui-browser-tunnel
systemctl --user stop tui-browser-tunnel
```

## API

### REST

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/discover` | Unified discovery (tmux sessions + Kitty windows) |
| `GET` | `/api/version` | Server version + build ID + claude availability |
| `GET` | `/api/sessions` | List tmux sessions |
| `GET` | `/api/sessions/:name` | Session details + preview |
| `GET` | `/api/sessions/:name/info` | Live session stats (memory, CPU, processes, output) |
| `POST` | `/api/sessions` | Create session `{ name, command, cwd }` |
| `DELETE` | `/api/sessions/:name` | Kill session |
| `POST` | `/api/sessions/:name/rename` | Rename `{ newName }` |
| `POST` | `/api/sessions/:name/open-terminal` | Open Kitty window for session |
| `POST` | `/api/sessions/:name/generate-title` | AI-generate session title via Claude CLI |
| `POST` | `/api/shortcuts` | Add custom shortcut `{ label, command }` |
| `GET` | `/api/health` | Server + tmux + Kitty status |

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
│   ├── index.js              # HTTP + WebSocket server
│   ├── session-manager.js    # PTY lifecycle, multi-client, Kitty launch
│   ├── discovery.js          # tmux + unified discovery with PID matching
│   ├── kitty-discovery.js    # Kitty remote control discovery
│   └── exec-util.js          # Shared subprocess utility
├── public/
│   ├── index.html            # SPA shell
│   ├── js/
│   │   ├── app.js            # Hash router
│   │   ├── dashboard.js      # Unified session cards
│   │   └── terminal.js       # xterm.js + WebSocket
│   └── css/
│       └── styles.css        # Dark theme
├── scripts/
│   └── tmux-kitty-shell      # Wrapper: launches Kitty windows inside tmux
├── install.sh                # One-command setup
└── package.json
```

## Mobile Controls

The terminal view includes touch-optimized controls:

- **Quick-keys bar** — Esc, Tab, Ctrl+C/D/Z, arrow keys, and a Sel (text select) button
- **Scroll controls** — floating up/down buttons (top-right) to scroll tmux history via copy-mode
- **Text selection** — tap Sel to open terminal output in a native-selectable overlay with Copy All
- **Keyboard awareness** — UI shifts above the soft keyboard automatically
- **Double-tap** a session card on the dashboard to connect directly

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

1. **Every Kitty window runs inside tmux** via a wrapper script (`tmux-kitty-shell`)
2. **PID matching** links Kitty windows to tmux sessions (`kitty_window.pid == tmux_client.client_pid`)
3. **Browser connects** to the same tmux session via node-pty + WebSocket
4. **Both viewers** (Kitty + browser) see identical output — tmux handles multi-client sync natively
5. **Creating a session** from the browser also opens a Kitty window on the host
6. **Killing a session** from the browser closes the Kitty window automatically

## License

MIT
