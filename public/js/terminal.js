/**
 * terminal.js — xterm.js terminal with WebSocket connection to tmux sessions.
 * Controls (scroll, text select, quickbar, session ops) are in terminal-controls.js.
 */

/* global Terminal, FitAddon, WebglAddon, App, TerminalControls */

const TerminalView = (() => {
  let term = null;
  let fitAddon = null;
  let webglAddon = null;
  let ws = null;
  let currentSession = null;
  let heartbeatInterval = null;

  function optimalFontSize() { return 14; }

  function updateZoomLabel() {
    const el = document.getElementById('zoom-value');
    if (el && term) el.textContent = term.options.fontSize;
  }

  function reloadWebGL() {
    if (webglAddon) { try { webglAddon.dispose(); } catch {} webglAddon = null; }
    try {
      webglAddon = new WebglAddon.WebglAddon();
      webglAddon.onContextLoss(() => { webglAddon.dispose(); webglAddon = null; });
      term.loadAddon(webglAddon);
    } catch { /* software fallback */ }
  }

  function setFontSize(size) {
    if (!term) return;
    size = Math.max(2, Math.min(32, size));
    term.options.fontSize = size;
    updateZoomLabel();
    reloadWebGL();
    if (fitAddon) setTimeout(() => { fitAddon.fit(); sendResize(); }, 50);
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN && term) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  function handleResize() {
    if (!fitAddon || !term) return;
    if (document.getElementById('terminal-view').classList.contains('hidden')) return;
    fitAddon.fit();
    sendResize();
    updateZoomLabel();
  }

  function adjustForKeyboard() {
    if (window.innerWidth > 768) { document.body.style.height = ''; return; }
    document.body.style.height = `${window.visualViewport.height}px`;
  }

  function init() {
    term = new Terminal({
      cursorBlink: true, cursorStyle: 'block',
      fontSize: optimalFontSize(),
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      theme: {
        background: '#000000', foreground: '#d4d4d4', cursor: '#00e5a0',
        cursorAccent: '#000000', selectionBackground: '#00e5a033', selectionForeground: '#ffffff',
      },
      allowProposedApi: true, scrollback: 5000,
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));

    // Fix mobile keyboard input
    const xtermTextarea = document.querySelector('#terminal-container .xterm-helper-textarea');
    if (xtermTextarea) {
      xtermTextarea.setAttribute('autocorrect', 'off');
      xtermTextarea.setAttribute('autocapitalize', 'off');
      xtermTextarea.setAttribute('autocomplete', 'off');
      xtermTextarea.setAttribute('spellcheck', 'false');
    }

    // WebGL addon
    try {
      webglAddon = new WebglAddon.WebglAddon();
      webglAddon.onContextLoss(() => { webglAddon.dispose(); webglAddon = null; });
      term.loadAddon(webglAddon);
    } catch { /* software fallback */ }

    // Batched keyboard input
    let inputBuffer = '';
    let inputFlushTimer = null;
    const INPUT_BATCH_MS = 30;

    term.onData((data) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      inputBuffer += data;
      if (!inputFlushTimer) {
        inputFlushTimer = setTimeout(() => {
          if (inputBuffer && ws && ws.readyState === WebSocket.OPEN) ws.send(inputBuffer);
          inputBuffer = '';
          inputFlushTimer = null;
        }, INPUT_BATCH_MS);
      }
    });

    // Resize handling
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('resize', adjustForKeyboard);
    }

    // Zoom buttons
    document.getElementById('zoom-in-btn').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); setFontSize(term.options.fontSize + 1);
    });
    document.getElementById('zoom-out-btn').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); setFontSize(term.options.fontSize - 1);
    });

    // Reconnect button
    document.getElementById('reconnect-btn').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (currentSession) connect(currentSession);
    });

    // Click terminal to focus
    document.getElementById('terminal-container').addEventListener('click', () => { if (term) term.focus(); });

    // Initialize controls (scroll, text select, quickbar, session ops)
    TerminalControls.init({
      term,
      getWs: () => ws,
      getSession: () => currentSession,
    });

    updateZoomLabel();
  }

  // ---------- WebSocket Connection ----------

  function connect(sessionName) {
    disconnect();
    currentSession = sessionName;
    setStatus('connecting', 'Connecting\u2026');
    term.clear();

    try { ws = new WebSocket(App.getWsUrl(sessionName)); }
    catch { setStatus('error', 'Failed to connect'); return; }

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setStatus('connected', 'Connected');
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 30000);

      setTimeout(() => {
        const newSize = optimalFontSize();
        if (term.options.fontSize !== newSize) term.options.fontSize = newSize;
        fitAddon.fit();
        updateZoomLabel();
        ws.send(JSON.stringify({ type: 'attach', cols: term.cols, rows: term.rows }));
      }, 50);

      term.focus();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        if (ev.data.charCodeAt(0) === 123) {
          try {
            const json = JSON.parse(ev.data);
            if (json.type === 'session-ended') {
              setStatus('error', 'Session ended');
              term.writeln('\r\n\x1b[1;31m[Session ended]\x1b[0m');
              return;
            }
          } catch { /* not JSON */ }
        }
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data));
      }
    };

    ws.onclose = () => {
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      setStatus('error', 'Disconnected');
      if (typeof App.onNetworkChange === 'function') App.onNetworkChange();
    };

    ws.onerror = () => setStatus('error', 'Connection error');
  }

  function disconnect() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    TerminalControls.stopScrolling();
    TerminalControls.exitScrollMode();
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
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
