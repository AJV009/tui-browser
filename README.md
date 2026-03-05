# TUI Browser

A zero-build static site that renders a remote terminal in a browser via WebSocket + xterm.js. Connect to the included node-pty server and get a full terminal experience with WebGL acceleration.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (index.html)                               │
│  ┌───────────────────────────────────────────────┐  │
│  │ xterm.js + WebGL + Fit addon                  │  │
│  │ ← renders terminal output                     │  │
│  │ → sends keystrokes                            │  │
│  └──────────────┬────────────────────────────────┘  │
│                 │ WebSocket (raw text + JSON resize) │
└─────────────────┼───────────────────────────────────┘
                  │
┌─────────────────┼───────────────────────────────────┐
│  server.js      │  (node-pty + ws)                   │
│  ┌──────────────▼────────────────────────────────┐  │
│  │ WebSocket server                              │  │
│  │ ← receives keystrokes as raw text             │  │
│  │ ← receives resize as JSON {type,cols,rows}    │  │
│  │ → streams PTY output as raw text              │  │
│  └──────────────┬────────────────────────────────┘  │
│  ┌──────────────▼────────────────────────────────┐  │
│  │ PTY: shell / TUI application                  │  │
│  │ Full terminal with 256-color, mouse support   │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install node-pty ws

# Start server (default port 3000, default command: bash)
node server.js

# Or specify port and command
node server.js 8080 htop
node server.js 3000 vim

# Open index.html in browser, connect to ws://localhost:3000
```

## Protocol

The WebSocket protocol is simple raw text:

- **Server → Client**: raw terminal output (string frames)
- **Client → Server**: raw keystrokes (string frames)
- **Client → Server resize**: `{"type":"resize","cols":N,"rows":N}` (JSON string frame)

The server distinguishes resize messages from input by attempting `JSON.parse` — if it parses and has `type: "resize"`, it resizes the PTY; otherwise it writes the raw string to the PTY.

## Deployment

### GitHub Pages

Push this folder to a GitHub repo and enable Pages. The site is fully static — all dependencies load from CDN. (The server.js runs separately on any machine with Node.js.)

### Local

Open `index.html` directly (`file://`) or serve with:

```bash
python3 -m http.server 8000
```

## Features

- **WebGL rendering**: GPU-accelerated terminal via xterm.js WebGL addon
- **Auto-reconnect**: exponential backoff on disconnect (1s → 16s max)
- **Shareable URLs**: connection settings persisted in URL hash
- **Responsive**: auto-fits terminal to viewport, sends resize to server
- **Zero build**: no npm, no bundler — single HTML file with CDN imports

## Security

This tool gives browser access to a terminal session. **Do not expose the WebSocket server to the public internet without authentication.** Options:

- Put behind a reverse proxy with TLS + auth (nginx, Caddy)
- Bind to localhost only (default behavior of server.js)
- Add your own auth middleware to the WebSocket server

## Requirements

- **Browser**: Chrome, Firefox, Safari, Edge (any modern browser with WebSocket + WebGL)
- **Server**: Node.js >= 18 with `node-pty` and `ws`
