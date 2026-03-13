# TUI Browser — Design Document & Development Reference

> Everything needed to understand, rebuild, or extend this project from scratch.

---

## Table of Contents

1. [Project Vision](#project-vision)
2. [Problems We Solved](#problems-we-solved)
3. [Architecture Decisions](#architecture-decisions)
4. [Kitty Remote Control — Exploration & Integration](#kitty-remote-control--exploration--integration)
5. [Technical Architecture](#technical-architecture)
6. [File-by-File Reference](#file-by-file-reference)
7. [API Specification](#api-specification)
8. [Frontend Architecture](#frontend-architecture)
9. [Data Flow](#data-flow)
10. [Security Considerations](#security-considerations)
11. [Future Ideas & Open Questions](#future-ideas--open-questions)
12. [Prerequisites & Setup](#prerequisites--setup)

---

## Project Vision

**TUI Browser** is a browser-based remote terminal control system. The core idea: **access your terminal from any device** — phone, tablet, another computer — via a web browser. The web view stays perfectly synchronized with the host terminal.

### Key Goals

- Discover running terminal sessions automatically
- View and control terminals from any browser in real-time
- Host terminal and web browser see identical output simultaneously
- Multiple web clients can connect to the same session
- Mobile-friendly, responsive, touch-ready
- Zero-build frontend (vanilla JS, CDN dependencies)

---

## Problems We Solved

### Problem 1: How to share a terminal over the network?

**Explored approaches:**
- Direct PTY forwarding over WebSocket — works but sessions die when the server restarts
- **tmux as backbone** — chosen approach. tmux sessions persist independently of any viewer. Both host terminal and web browser attach to the same tmux session. tmux handles multi-client sync natively.

### Problem 2: How to discover what's running?

**Two discovery sources were implemented:**

1. **tmux discovery** — queries `tmux list-sessions` and `tmux list-panes` for metadata (session name, windows, attached status, creation time, pane commands, dimensions). Uses `tmux capture-pane -p` for text previews.

2. **Kitty remote control discovery** — uses `kitten @ ls` to discover all Kitty OS windows, tabs, and inner windows. Provides title, pid, cwd, cmdline, dimensions, focus state, and text preview via `kitten @ get-text`.

### Problem 3: Kitty remote control vs tmux — which to use for connections?

**We explored using Kitty's remote control as the primary connection mechanism.** Here's the analysis:

| Capability | tmux | Kitty Remote Control |
|---|---|---|
| Session persistence (survives close) | Yes | No |
| Works with any terminal | Yes | Kitty only |
| Real-time output streaming | Yes (PTY attach) | No (must poll `get-text`) |
| Full escape code / ANSI fidelity | Yes (raw PTY) | Partial (text only) |
| 60fps TUI rendering | Yes | No (poll-based) |
| Input injection | Yes (PTY write) | Yes (`kitten @ send-text`) |
| Window/tab discovery | Limited (sessions only) | Rich (OS windows, tabs, inner windows) |

**Decision: tmux is the backbone for actual terminal I/O. Kitty remote control is used as a discovery source** — it shows what's running in Kitty windows on the dashboard. When you click "Connect via tmux" on a Kitty window, we create a tmux session in the same working directory.

### Problem 4: Multi-client sync

tmux natively handles this. When multiple clients (host terminal + N web browsers) attach to the same tmux session, they all see the same output. No custom sync logic needed.

### Problem 5: PTY lifecycle management

Each web connection spawns a `tmux attach-session -t <name>` via node-pty. Multiple web clients share the same PTY process — output is broadcast to all. When all web clients disconnect, the PTY attachment is killed but the tmux session keeps running. You can reconnect later.

---

## Architecture Decisions

### Why tmux (not raw PTY, not screen, not Kitty-only)?

- **Persistence**: tmux sessions survive server restarts, browser disconnects, SSH drops
- **Multi-client**: Native multi-attach with synced views
- **Ubiquity**: Available on every Linux/macOS system
- **Ecosystem**: Works with any terminal emulator on the host side

### Why node-pty for the bridge?

- Spawns a real PTY (not just exec), preserving terminal features (colors, cursor positioning, full-screen TUI apps)
- `tmux attach-session -t <name>` via node-pty gives us a live PTY stream that maps 1:1 to WebSocket

### Why xterm.js on the frontend?

- Full terminal emulator in the browser (ANSI, 256-color, mouse support, scrollback)
- WebGL renderer for GPU-accelerated performance
- Well-maintained, widely used
- Addons: fit (auto-resize), webgl (performance)

### Why vanilla JS (no React/Vue/build step)?

- Zero build tooling = zero build bugs
- xterm.js loaded from CDN, no bundler needed
- IIFE module pattern for simple namespacing
- Hash-based routing (no framework needed for 2 views)
- Fast iteration, easy to understand

### Why Express + ws (not Socket.IO)?

- Raw WebSockets are simpler and lower overhead for binary terminal data
- No need for Socket.IO's reconnection/rooms features — tmux handles persistence
- Express provides simple REST API for session CRUD

---

## Kitty Remote Control — Exploration & Integration

### What is Kitty Remote Control?

[Kitty](https://sw.kovidgoyal.net/kitty/) has a built-in [remote control protocol](https://sw.kovidgoyal.net/kitty/remote-control/) that lets you control the terminal from scripts or other processes. Communication happens over a Unix socket using JSON.

### Enabling Kitty Remote Control

Add to `~/.config/kitty/kitty.conf`:
```
allow_remote_control yes
listen_on unix:/tmp/kitty-socket
```

### Key Commands We Use

```bash
# List all OS windows, tabs, and inner windows (returns JSON)
kitten @ --to unix:/tmp/kitty-socket ls

# Get text content of a specific window
kitten @ --to unix:/tmp/kitty-socket get-text --match id:1

# Send text to a window (not used yet, but available)
kitten @ --to unix:/tmp/kitty-socket send-text --match id:1 "hello\r"
```

### Kitty `ls` JSON Structure

```json
[
  {
    "id": 1,                          // OS window ID
    "tabs": [
      {
        "id": 1,                      // Tab ID
        "title": "Tab title",
        "windows": [
          {
            "id": 1,                  // Inner window ID
            "title": "Window title",
            "pid": 12345,
            "cwd": "/home/user",
            "cmdline": ["/bin/bash"],
            "is_focused": true,
            "columns": 120,
            "lines": 40
          }
        ]
      }
    ]
  }
]
```

### How We Integrated Kitty Discovery

1. **Socket detection**: Try `KITTY_LISTEN_ON` env var, then `/tmp/kitty-socket`, then `/tmp/kitty-<user>`
2. **Window enumeration**: Parse `kitten @ ls` JSON, flatten OS windows → tabs → windows into a flat list
3. **Text preview**: Call `kitten @ get-text --match id:<id>` for each window, grab last 500 chars
4. **Dashboard display**: Kitty windows appear with purple accent, source badges, preview snippets
5. **Connection**: "Connect via tmux" creates a tmux session in the Kitty window's `cwd`, then navigates to the terminal view

### Kitty Remote Control Protocol Details (for future reference)

The [protocol specification](https://sw.kovidgoyal.net/kitty/rc_protocol/) uses JSON over a Unix socket:

```json
{
  "cmd": "command_name",
  "version": [0, 14, 2],
  "no_response": false,
  "payload": { ... }
}
```

When `remote_control_password` is set, communication is encrypted using ECDH with X25519. The public key is in the `KITTY_PUBLIC_KEY` environment variable.

### Other Kitty Capabilities (not yet used)

- **`send-text`**: Inject keystrokes into any Kitty window (could enable remote typing without tmux)
- **`launch`**: Open new windows/tabs programmatically
- **`set-window-title`**: Rename windows
- **`close-window`** / **`close-tab`**: Window management
- **`focus-window`** / **`focus-tab`**: Navigation
- **Kittens framework**: Custom terminal programs (SSH, clipboard, broadcast, diff, icat for images)
- **Graphics protocol**: Display images inline in the terminal

---

## Technical Architecture

```
Phone/Tablet/Laptop Browser              Host Machine
┌──────────────────────────┐            ┌────────────────────────────────────────┐
│  Dashboard View          │   HTTP     │  server/index.js (Express + WS)        │
│  ┌─────────────────────┐ │◄─────────►│  ├── REST: /api/sessions CRUD          │
│  │ tmux sessions       │ │           │  ├── REST: /api/discover (unified)      │
│  │ kitty windows       │ │           │  ├── REST: /api/kitty/windows           │
│  └─────────────────────┘ │           │  ├── WS: /ws/terminal/:sessionName     │
│  Terminal View           │   WS      │  │                                      │
│  ┌─────────────────────┐ │◄════════►│  ├── discovery.js (tmux queries)        │
│  │ xterm.js (WebGL)    │ │  bi-dir  │  ├── kitty-discovery.js (kitten @ ls)   │
│  │ Full I/O streaming  │ │  binary  │  └── session-manager.js (node-pty)      │
│  └─────────────────────┘ │           │       ├── tmux attach (node-pty PTY)    │
└──────────────────────────┘           │       ├── tmux new-session              │
                                       │       └── broadcast to N web clients    │
     Host Terminal                     └────────────────────────────────────────┘
     ┌────────────┐
     │ tmux       │◄── same tmux session, both see identical output
     │ session    │
     └────────────┘
     Kitty Terminal
     ┌────────────┐
     │ kitten @   │◄── discovery only (ls, get-text)
     │ remote     │    connection goes through tmux
     └────────────┘
```

---

## File-by-File Reference

### `package.json`

```json
{
  "name": "tui-browser",
  "version": "2.0.0",
  "main": "server/index.js",
  "scripts": { "start": "node server/index.js" },
  "dependencies": {
    "express": "^4.21.0",    // HTTP server + static files + REST API
    "node-pty": "^1.0.0",   // PTY spawning for tmux attach
    "ws": "^8.18.0"         // WebSocket server for terminal I/O
  }
}
```

### `server/index.js` — HTTP + WebSocket Server

- Express app serving `public/` as static files
- REST API endpoints for session CRUD, Kitty discovery, unified discovery, health check
- WebSocket upgrade handler for `/ws/terminal/:sessionName`
- Protocol: client sends JSON `{ type: "attach"|"input"|"resize", ... }`, server sends raw terminal output or JSON control messages
- Startup: checks tmux availability, creates default session if none exist

### `server/discovery.js` — tmux Discovery

- `isTmuxAvailable()` — checks if `tmux -V` works
- `isTmuxServerRunning()` — checks if `tmux list-sessions` works
- `listSessions()` — parses `tmux list-sessions -F` with custom format string (id, name, windows, attached, created), then `listPanes()` for each
- `listPanes(sessionName)` — parses `tmux list-panes -t <name> -F` (id, tty, pid, command, width, height, active)
- `capturePane(sessionName)` — `tmux capture-pane -t <name> -p` for text preview
- `getSessionDetail(sessionName)` — session + preview combined
- `discoverAll()` — runs tmux + kitty discovery in parallel via `Promise.all`

**Format string technique**: Uses `|||` separator with tmux format variables like `#{session_name}`, splits on `|||` to parse fields. Avoids JSON parsing issues.

### `server/kitty-discovery.js` — Kitty Remote Control Discovery

- `isKittyAvailable()` — checks if `kitten --version` works
- `isKittyRemoteAvailable()` — tries multiple socket paths to find a working Kitty remote connection
- `listKittyWindows(socket)` — calls `kitten @ ls`, returns parsed JSON
- `getWindowText(socket, windowId)` — calls `kitten @ get-text --match id:<id>`
- `discoverKittyWindows()` — flattens OS windows → tabs → windows, adds preview text, returns normalized list

### `server/session-manager.js` — PTY Lifecycle

- `activeSessions` Map: `sessionName → { proc: IPty, clients: Set<WebSocket> }`
- `attachClient(sessionName, ws, cols, rows)` — spawns `tmux attach-session -t <name>` via node-pty if first client, adds ws to broadcast set
- `writeInput(sessionName, data)` — writes to PTY
- `resize(sessionName, cols, rows)` — resizes PTY (last client wins)
- `detachClient(sessionName, ws)` — removes client, kills PTY when no clients remain (tmux session persists)
- `createSession(name, command)` — `tmux new-session -d -s <name>`
- `killSession(name)` — notifies all web clients, kills PTY, `tmux kill-session -t <name>`
- `renameSession(oldName, newName)` — `tmux rename-session -t <old> <new>`

### `public/index.html` — SPA Shell

- Two views: `#dashboard-view` and `#terminal-view`
- CDN deps: `@xterm/xterm@5.5.0`, `@xterm/addon-fit@0.10.0`, `@xterm/addon-webgl@0.18.0`
- Script load order: dashboard.js → terminal.js → app.js (app.js calls init on both)

### `public/js/app.js` — SPA Router

- Hash-based routing: `#dashboard` (default) or `#terminal/<sessionName>`
- IIFE module pattern, exposes `App.navigate()` and `App.getCurrentSession()`
- On route change: hides/shows views, connects/disconnects terminal, refreshes dashboard

### `public/js/dashboard.js` — Session Dashboard

- Fetches from `/api/discover` (unified tmux + kitty endpoint)
- Renders tmux session cards with: name, status (attached/detached/web-connected), command, windows, dimensions, creation time, connect/kill buttons
- Renders Kitty window cards with: title, cmdline, cwd, dimensions, tab name, preview, "Connect via tmux" button
- Source section headers with badges (green "tmux", purple "Kitty")
- Auto-refreshes every 3 seconds when dashboard is visible
- "Connect via tmux" for Kitty windows: creates a tmux session named `kitty-<id>` in the Kitty window's cwd

### `public/js/terminal.js` — xterm.js Terminal

- Creates xterm.js Terminal instance once, reuses across sessions
- Config: JetBrains Mono font, blinking block cursor, dark theme (#1a1a2e bg, #e94560 accent), 5000-line scrollback
- WebGL addon with fallback to software renderer
- WebSocket protocol: sends `attach` on connect, `input` on keystrokes, `resize` on window resize
- Receives raw terminal output (ANSI preserved) or JSON control messages (`session-ended`)
- Connection status indicator (green dot = connected, orange = connecting, no dot = disconnected)

### `public/css/styles.css` — Dark Theme

- Color scheme: dark blues (#1a1a2e, #16213e), pink accent (#e94560), purple for Kitty (#7c4dff, #b388ff)
- Flexbox layout, responsive grid for session cards
- Status dots: green (attached), orange (detached), blue (web-connected)
- Kitty cards: purple left border, "K" icon badge
- Source section headers with colored badges
- Monospace preview boxes for pane/window content
- Mobile breakpoint at 768px

---

## API Specification

### REST Endpoints

| Method | Endpoint | Request Body | Response | Description |
|--------|----------|-------------|----------|-------------|
| `GET` | `/api/health` | — | `{ tmux, server, kitty }` | Health check for tmux + kitty availability |
| `GET` | `/api/sessions` | — | `[{ id, name, windows, attached, created, panes, webClients }]` | List all tmux sessions |
| `GET` | `/api/sessions/:name` | — | `{ ...session, preview }` | Session detail with pane preview |
| `POST` | `/api/sessions` | `{ name, command }` | `{ name, command }` | Create new tmux session |
| `DELETE` | `/api/sessions/:name` | — | `{ ok: true }` | Kill tmux session |
| `POST` | `/api/sessions/:name/rename` | `{ newName }` | `{ ok: true }` | Rename tmux session |
| `GET` | `/api/discover` | — | `{ tmux: [...], kitty: { available, windows: [...] } }` | Unified discovery |
| `GET` | `/api/kitty/windows` | — | `{ available, socket, windows: [...] }` | Kitty-only discovery |

### WebSocket Protocol

Connect to: `ws://host:port/ws/terminal/:sessionName`

**Client → Server (JSON):**
```json
{ "type": "attach", "cols": 80, "rows": 24 }   // Attach to session
{ "type": "input", "data": "ls\r" }             // Terminal input
{ "type": "resize", "cols": 120, "rows": 40 }   // Resize terminal
```

**Server → Client:**
- Raw text frames with ANSI escape codes (terminal output)
- JSON: `{ "type": "session-ended", "sessionName": "..." }` (session terminated)

---

## Data Flow

### Terminal I/O (keystroke to output)

```
1. User types in browser
2. xterm.js onData callback fires
3. WebSocket sends: { "type": "input", "data": "<keystroke>" }
4. Server receives message, calls sessions.writeInput()
5. node-pty writes to PTY fd
6. PTY (tmux attach) processes input
7. tmux session produces output
8. node-pty onData fires with output bytes
9. Server broadcasts output to all connected WebSocket clients
10. xterm.js term.write() renders output in browser
```

### Discovery refresh cycle

```
1. Dashboard sets 3-second interval
2. fetch('/api/discover') hits server
3. Server runs Promise.all([tmux listSessions, kitty discoverKittyWindows])
4. tmux: execFile('tmux', ['list-sessions', '-F', ...]) → parse → add panes
5. kitty: execFile('kitten', ['@', 'ls']) → parse JSON → get-text for each window
6. Server returns unified { tmux: [...], kitty: { available, windows: [...] } }
7. Dashboard renders tmux cards + kitty cards with source badges
```

### Kitty → tmux connection flow

```
1. User clicks "Connect via tmux" on a Kitty window card
2. Dashboard fetches /api/kitty/windows to get window's cwd
3. Dashboard POSTs /api/sessions { name: "kitty-<id>", command: "cd <cwd> && bash" }
4. Server creates tmux session in that directory
5. Dashboard navigates to #terminal/kitty-<id>
6. Terminal view opens WebSocket to /ws/terminal/kitty-<id>
7. Server spawns node-pty: tmux attach-session -t kitty-<id>
8. Full bidirectional terminal I/O begins
```

---

## Security Considerations

**This tool gives browser access to terminal sessions. It has NO authentication.**

### Risks

- Anyone on the same network can discover and control your terminal sessions
- Full shell access = full system access
- Kitty remote control socket exposes terminal state

### Mitigations (recommended for production)

1. **Reverse proxy with TLS + auth**: Put behind nginx or Caddy with certificate + password/OAuth
2. **Bind to localhost**: Start with `PORT=3000 node server/index.js` and access only locally
3. **SSH tunnel**: `ssh -L 3000:localhost:3000 user@host` for secure remote access
4. **Firewall rules**: Block port 3000 from external access
5. **Kitty socket permissions**: Ensure `/tmp/kitty-socket` has restrictive permissions (mode 0600)

---

## Future Ideas & Open Questions

### Ideas Explored But Not Yet Implemented

1. **Kitty send-text for direct input**: Instead of creating a tmux session, use `kitten @ send-text` to inject keystrokes directly into a Kitty window. Would need polling `get-text` for output, which is suboptimal for 60fps TUI rendering.

2. **Auto-launch tmux in every Kitty window**: Add `shell tmux new-session -A -s main` to `kitty.conf`. This makes every Kitty window automatically a tmux session, giving us the best of both: Kitty's GPU rendering locally + tmux persistence + remote web access.

3. **Kitty broadcast kitten**: Kitty has a built-in broadcast mode that sends typed input to all windows simultaneously. Could be useful for multi-server administration through the web UI.

4. **Kitty graphics protocol**: Kitty can display inline images. Could extend the web terminal to render images inline using the Kitty graphics protocol over the WebSocket bridge.

5. **Authentication layer**: Add JWT or basic auth before accessing the API. Could also use Kitty's encrypted remote control protocol (ECDH X25519) as a model.

6. **Session recording/playback**: Record terminal output with timestamps for later playback (like asciinema but integrated).

7. **Mobile gesture controls**: Swipe for scrollback, pinch for font size, long-press for paste.

8. **SSH kitten integration**: Kitty's SSH kitten automatically copies terminfo to remote hosts. Could streamline connecting to remote servers.

### Open Questions

- Should Kitty windows auto-create tmux sessions in the background, or only on user click?
- Should we support other terminal emulators' remote control (WezTerm has a similar API)?
- Is polling `kitten @ get-text` fast enough for a "live view" mode without tmux?
- Should we expose Kitty's `send-text` as an alternative to tmux-based I/O for latency-sensitive use cases?

---

## Prerequisites & Setup

### System Requirements

- **Node.js** >= 18
- **tmux** — `sudo apt install tmux` (Debian/Ubuntu) or `brew install tmux` (macOS)
- **Kitty** (optional) — `sudo apt install kitty` or download from [sw.kovidgoyal.net/kitty](https://sw.kovidgoyal.net/kitty/)

### Kitty Remote Control Setup (optional)

Add to `~/.config/kitty/kitty.conf`:
```
allow_remote_control yes
listen_on unix:/tmp/kitty-socket
```

Restart Kitty after changing config.

### Running

```bash
npm install
npm start                     # http://localhost:3000
PORT=8080 npm start           # custom port
```

### Directory Structure

```
tui-browser/
├── server/
│   ├── index.js              # HTTP + WebSocket server, REST API
│   ├── session-manager.js    # PTY lifecycle, multi-client management
│   ├── discovery.js          # tmux queries, unified discovery
│   └── kitty-discovery.js    # Kitty remote control discovery
├── public/
│   ├── index.html            # SPA shell (2 views)
│   ├── js/
│   │   ├── app.js            # Hash router, state management
│   │   ├── dashboard.js      # Session list + Kitty windows UI
│   │   └── terminal.js       # xterm.js + WebSocket connection
│   └── css/
│       └── styles.css        # Dark theme, responsive layout
├── package.json              # Dependencies
├── DESIGN.md                 # This file
└── README.md                 # Quick-start documentation
```

### Dependencies (3 total, all runtime)

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.21.0 | HTTP server, static files, REST API |
| `node-pty` | ^1.0.0 | Spawn PTY processes (tmux attach) |
| `ws` | ^8.18.0 | WebSocket server for terminal I/O |

### Frontend Dependencies (CDN, no npm)

| Package | Version | Purpose |
|---------|---------|---------|
| `@xterm/xterm` | 5.5.0 | Terminal emulator in the browser |
| `@xterm/addon-fit` | 0.10.0 | Auto-resize terminal to container |
| `@xterm/addon-webgl` | 0.18.0 | GPU-accelerated rendering |
