# TUI Browser

A browser-based remote terminal control system. Discover, view, and control your tmux sessions from any device — your phone, tablet, or another computer. The web view stays perfectly in sync with your host terminal.

## Architecture

```
Phone/Tablet Browser                    Host Machine
┌─────────────────────┐                ┌──────────────────────────────────┐
│  Dashboard View     │   HTTP/WS      │  server/index.js                 │
│  - Session list     │◄──────────────►│  ├── HTTP: serves public/*       │
│  - Create/Kill      │                │  ├── REST: /api/sessions CRUD    │
│  Terminal View      │                │  ├── WS: terminal I/O streaming  │
│  - xterm.js         │                │  ├── discovery.js (tmux query)   │
│  - Full I/O sync    │                │  └── session-manager.js          │
└─────────────────────┘                │       ├── tmux attach (node-pty) │
                                       │       ├── tmux new-session       │
        Host Terminal                  │       └── tmux kill-session      │
        ┌──────────┐                   └──────────────────────────────────┘
        │ tmux     │ ◄── same tmux session, both see identical output
        │ session  │
        └──────────┘
```

Both the host terminal and the web browser attach to the same tmux session — tmux natively handles multi-client view sync.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (default port 3000)
npm start

# Or specify a custom port
PORT=8080 npm start

# Open in browser
open http://localhost:3000
```

**Prerequisites**: Node.js >= 18, tmux installed (`sudo apt install tmux` or `brew install tmux`)

## Features

- **Session Discovery**: Automatically lists all tmux sessions with metadata (command, size, status)
- **Remote Control**: Full terminal I/O from any browser — type commands, see output in real-time
- **View Sync**: Host terminal and web browser see identical output simultaneously
- **Multi-client**: Multiple web browsers can connect to the same session
- **Session Management**: Create, kill, and rename sessions from the dashboard
- **Mobile-friendly**: Responsive UI with touch-friendly controls
- **WebGL Rendering**: GPU-accelerated terminal via xterm.js
- **Zero Build Frontend**: Vanilla JS, no bundler — xterm.js loaded from CDN

## API

### REST

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all tmux sessions |
| `GET` | `/api/sessions/:name` | Get session details + preview |
| `POST` | `/api/sessions` | Create session `{ name, command }` |
| `DELETE` | `/api/sessions/:name` | Kill session |
| `POST` | `/api/sessions/:name/rename` | Rename `{ newName }` |
| `GET` | `/api/health` | Server + tmux status |

### WebSocket

Connect to `/ws/terminal/:sessionName` for terminal I/O:

```js
// Client → Server
{ "type": "attach", "cols": 80, "rows": 24 }  // start session
{ "type": "input", "data": "ls\r" }            // terminal input
{ "type": "resize", "cols": 120, "rows": 40 }  // resize

// Server → Client
// Raw terminal output as text frames (ANSI codes preserved)
// Or JSON: { "type": "session-ended", "sessionName": "..." }
```

## Security

This tool gives browser access to terminal sessions. **Do not expose to the public internet without authentication.** Options:

- Put behind a reverse proxy with TLS + auth (nginx, Caddy)
- Bind to localhost only
- Use SSH tunneling for remote access

## Requirements

- **Browser**: Chrome, Firefox, Safari, Edge (any modern browser)
- **Server**: Node.js >= 18
- **tmux**: Must be installed on the host machine
