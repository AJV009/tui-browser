# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TUI Browser is a browser-based terminal control system — "VNC for terminals." It provides web access to tmux sessions from any device via HTTPS/WebSocket. The host terminal (Kitty) and web browser stay synchronized through tmux's native multi-client support.

## Commands

```bash
# Install dependencies
npm install

# Run the server (default port 3000)
npm start

# Run on specific port (HTTP on PORT, HTTPS on PORT+1)
PORT=7483 npm start

# Full setup (deps + tmux config + systemd service + certs)
./install.sh

# Service management
systemctl --user start|stop|restart|status tui-browser
journalctl --user -u tui-browser -f

# Generate HTTPS certs for local fast-path
./scripts/generate-certs.sh
```

There is no test suite, linter, or build step. Test API changes against the running server (e.g., `curl localhost:7483/api/discover`).

## Architecture

**Three-layer stack**: Browser (vanilla JS SPA) → Node.js server (Express + WebSocket) → tmux sessions (via node-pty)

### Server (`server/`)

- **index.js** — HTTP/HTTPS server + WebSocket upgrade handler. Entry point.
- **routes.js** — All REST API endpoints (discovery, session CRUD, bulk-kill, AI titles, shortcuts, locks).
- **session-manager.js** — PTY lifecycle. Spawns `tmux attach-session` via node-pty, broadcasts output to all connected WebSocket clients. Multiple browsers share one PTY process per session.
- **discovery.js** — Queries tmux via `tmux list-sessions -F` with `|||`-separated format strings (avoids JSON parsing issues). Also runs unified discovery (tmux + Kitty in parallel).
- **kitty-discovery.js** — Discovers Kitty windows via `kitten @ ls` JSON protocol over Unix socket. Used for discovery/metadata only — actual terminal I/O always goes through tmux.
- **state.js** — Persistent state (display titles, locked sessions) saved to `data/` directory.
- **ai-titles.js** — Auto-generates session titles via Claude CLI every 60s.
- **exec-util.js** — Subprocess wrapper with 5s timeout used by all `execFile` calls.

### Frontend (`public/`)

Zero-build vanilla JS SPA. xterm.js loaded from CDN. Each JS file is a self-contained **IIFE module** exposing a global (e.g., `const Dashboard = (() => { ... })()`). Modules communicate via globals (`App.navigate()`, `Dashboard.init()`).

- **index.html** — SPA shell with two views: `#dashboard-view` and `#terminal-view`
- **app.js** — Hash-based router (`#dashboard` or `#terminal/<sessionName>`), modal/toast system, version polling
- **app-network.js** — Auto-switches between Cloudflare tunnel and direct local HTTPS (races local IPs against tunnel)
- **dashboard.js** — Session card rendering, connect/kill/rename actions, 3s polling via `/api/discover`
- **dashboard-shortcuts.js** — Quick Launch dropdown (loads/saves `shortcuts.json`)
- **dashboard-bulk-kill.js** — Multi-select + bulk kill with filter presets
- **dashboard-info.js** — Session info overlay (memory, CPU, process tree)
- **terminal.js** — xterm.js setup + WebSocket connection (binary terminal data)
- **terminal-controls.js** — Scroll controls, text selection overlay, quick-keys bar, session rename/kill

### Key Data Flow

1. **Dashboard polling**: Every 3s, fetches `/api/discover` → server runs `Promise.all([tmux, kitty])` → returns unified session list
2. **Terminal I/O**: WebSocket at `/ws/terminal/:sessionName` carries bidirectional binary PTY data. Client sends JSON `{ type: "attach"|"input"|"resize" }`, server sends raw ANSI output or JSON control messages
3. **Multi-client**: Multiple browsers share one node-pty process per session; output is broadcast to all. When last client disconnects, PTY is killed but tmux session persists.

### WebSocket Protocol

Binary vs JSON distinguished by first byte: `charCodeAt(0) !== 123` (not `{`) means binary terminal output.

## Key Conventions

- **3 npm dependencies** (express, node-pty, ws) — keep it minimal
- **No build step** — frontend served as static files, xterm.js from CDN
- **IIFE module pattern** — each frontend JS file is `const Module = (() => { ... })()`
- **Data attributes for actions** — HTML uses `data-action="connect"`, `data-session="name"` patterns
- **tmux format strings** use `|||` separator (not JSON) to parse session/pane metadata
- **All server modules kept under ~250 lines** (recent refactor split large files)
- **Persistent state** lives in `data/` directory as JSON files
- **CSS variables** defined in `base.css` for theming (dark theme with `#00e5a0` accent)
