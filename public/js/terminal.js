/**
 * terminal.js — xterm.js terminal connection to tmux sessions via WebSocket.
 */

/* global Terminal, FitAddon, WebglAddon, App */

const TerminalView = (() => {
  let term = null;
  let fitAddon = null;
  let ws = null;
  let currentSession = null;

  function init() {
    // Terminal is created once and reused
    term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#e94560',
        selectionBackground: '#e9456044',
      },
      allowProposedApi: true,
      scrollback: 5000,
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    term.open(document.getElementById('terminal-container'));

    // Try WebGL, fall back silently
    try {
      const webgl = new WebglAddon.WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // software renderer is fine
    }

    // Forward keystrokes to WebSocket
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Resize handling
    window.addEventListener('resize', handleResize);

    // Click terminal container to focus
    document.getElementById('terminal-container').addEventListener('click', () => {
      if (term) term.focus();
    });
  }

  function handleResize() {
    if (!fitAddon) return;
    // Only resize if terminal view is visible
    if (document.getElementById('terminal-view').classList.contains('hidden')) return;

    fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  function connect(sessionName) {
    // Disconnect from any existing session first
    disconnect();

    currentSession = sessionName;
    setStatus('connecting', 'Connecting\u2026');
    term.clear();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(sessionName)}`;

    try {
      ws = new WebSocket(url);
    } catch (e) {
      setStatus('error', 'Failed to connect');
      return;
    }

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setStatus('connected', 'Connected');

      // Fit terminal now that the view is visible
      setTimeout(() => {
        fitAddon.fit();
        // Send attach message with current dimensions
        ws.send(JSON.stringify({
          type: 'attach',
          cols: term.cols,
          rows: term.rows,
        }));
      }, 50);

      term.focus();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        // Check for control messages
        try {
          const json = JSON.parse(ev.data);
          if (json.type === 'session-ended') {
            setStatus('error', 'Session ended');
            term.writeln('\r\n\x1b[1;31m[Session ended]\x1b[0m');
            setTimeout(() => App.navigate('dashboard'), 1500);
            return;
          }
        } catch {
          // Not JSON — terminal output
        }
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data));
      }
    };

    ws.onclose = () => {
      setStatus('error', 'Disconnected');
    };

    ws.onerror = () => {
      setStatus('error', 'Connection error');
    };
  }

  function disconnect() {
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    currentSession = null;
    setStatus('', 'Disconnected');
  }

  function setStatus(state, text) {
    const dot = document.getElementById('terminal-status-dot');
    const label = document.getElementById('terminal-status-text');
    if (dot) dot.className = 'status-dot ' + (state === 'connected' ? 'attached' : state === 'connecting' ? 'detached' : '');
    if (label) label.textContent = text;
  }

  return { init, connect, disconnect };
})();
