/**
 * terminal.js — xterm.js terminal connection to tmux sessions via WebSocket.
 */

/* global Terminal, FitAddon, WebglAddon, App */

const TerminalView = (() => {
  let term = null;
  let fitAddon = null;
  let webglAddon = null;
  let ws = null;
  let currentSession = null;
  let heartbeatInterval = null;

  function optimalFontSize() {
    const w = window.innerWidth;
    if (w <= 400) return 4;
    if (w <= 500) return 5;
    if (w <= 768) return 8;
    return 14;
  }

  function updateZoomLabel() {
    const el = document.getElementById('zoom-level');
    if (el && term) el.textContent = term.options.fontSize;
  }

  function reloadWebGL() {
    if (webglAddon) {
      try { webglAddon.dispose(); } catch { /* ignore */ }
      webglAddon = null;
    }
    try {
      webglAddon = new WebglAddon.WebglAddon();
      webglAddon.onContextLoss(() => { webglAddon.dispose(); webglAddon = null; });
      term.loadAddon(webglAddon);
    } catch { /* software renderer fallback */ }
  }

  function setFontSize(size) {
    if (!term) return;
    size = Math.max(2, Math.min(32, size));
    term.options.fontSize = size;
    updateZoomLabel();
    // WebGL addon caches font textures — must reload to pick up new size
    reloadWebGL();
    if (fitAddon) {
      setTimeout(() => {
        fitAddon.fit();
        sendResize();
      }, 50);
    }
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN && term) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  function init() {
    term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: optimalFontSize(),
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      theme: {
        background: '#000000',
        foreground: '#d4d4d4',
        cursor: '#00e5a0',
        cursorAccent: '#000000',
        selectionBackground: '#00e5a033',
        selectionForeground: '#ffffff',
      },
      allowProposedApi: true,
      scrollback: 5000,
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    term.open(document.getElementById('terminal-container'));

    // Try WebGL, fall back silently
    try {
      webglAddon = new WebglAddon.WebglAddon();
      webglAddon.onContextLoss(() => { webglAddon.dispose(); webglAddon = null; });
      term.loadAddon(webglAddon);
    } catch {
      // software renderer is fine
    }

    // Forward keystrokes to WebSocket — raw, no JSON wrapping
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Resize handling
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      // Delay to let the browser settle the new dimensions
      setTimeout(handleResize, 200);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    // Zoom buttons (prevent event leaking into xterm)
    document.getElementById('zoom-in-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFontSize(term.options.fontSize + 1);
    });
    document.getElementById('zoom-out-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFontSize(term.options.fontSize - 1);
    });

    // Reconnect button
    document.getElementById('reconnect-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (currentSession) connect(currentSession);
    });

    // Click terminal container to focus
    document.getElementById('terminal-container').addEventListener('click', () => {
      if (term) term.focus();
    });

    // Quick-keys bar — feed input through xterm so onData fires normally
    const QK_MAP = {
      'esc': '\x1b', 'tab': '\t',
      'ctrl-c': '\x03', 'ctrl-d': '\x04', 'ctrl-z': '\x1a',
      'up': '\x1b[A', 'down': '\x1b[B', 'left': '\x1b[D', 'right': '\x1b[C',
    };

    document.getElementById('terminal-quickbar').addEventListener('touchstart', (e) => {
      const btn = e.target.closest('.qk');
      if (!btn) return;
      e.preventDefault();
      const seq = QK_MAP[btn.dataset.qk];
      if (seq && term) term.input(seq, true);
    }, { passive: false });

    updateZoomLabel();
  }

  function handleResize() {
    if (!fitAddon || !term) return;
    if (document.getElementById('terminal-view').classList.contains('hidden')) return;

    fitAddon.fit();
    sendResize();
    updateZoomLabel();
  }

  function connect(sessionName) {
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

      // Heartbeat to prevent Cloudflare/proxy idle timeout
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);

      setTimeout(() => {
        const newSize = optimalFontSize();
        if (term.options.fontSize !== newSize) {
          term.options.fontSize = newSize;
        }
        fitAddon.fit();
        updateZoomLabel();
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
        // Only attempt JSON parse if it looks like a control message
        if (ev.data.charCodeAt(0) === 123 /* '{' */) {
          try {
            const json = JSON.parse(ev.data);
            if (json.type === 'session-ended') {
              setStatus('error', 'Session ended');
              term.writeln('\r\n\x1b[1;31m[Session ended]\x1b[0m');
              return;
            }
          } catch { /* not JSON after all */ }
        }
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data));
      }
    };

    ws.onclose = () => {
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      setStatus('error', 'Disconnected');
    };

    ws.onerror = () => {
      setStatus('error', 'Connection error');
    };
  }

  function disconnect() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
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
    const reconnectBtn = document.getElementById('reconnect-btn');
    if (dot) dot.className = 'status-dot ' + (state === 'connected' ? 'attached' : state === 'connecting' ? 'detached' : '');
    if (label) label.textContent = text;
    if (reconnectBtn) reconnectBtn.style.display = (state === 'error' && currentSession) ? 'flex' : 'none';
  }

  return { init, connect, disconnect };
})();
