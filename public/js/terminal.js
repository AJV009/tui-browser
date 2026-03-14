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
  let inScrollMode = false;
  let scrollInterval = null;
  let scrollStartTimer = null;
  let scrollSafetyTimer = null;

  function optimalFontSize() {
    return 14;
  }

  function updateZoomLabel() {
    const el = document.getElementById('zoom-value');
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

    // Fix mobile keyboard input — disable autocorrect/autocomplete on xterm's hidden textarea
    const xtermTextarea = document.querySelector('#terminal-container .xterm-helper-textarea');
    if (xtermTextarea) {
      xtermTextarea.setAttribute('autocorrect', 'off');
      xtermTextarea.setAttribute('autocapitalize', 'off');
      xtermTextarea.setAttribute('autocomplete', 'off');
      xtermTextarea.setAttribute('spellcheck', 'false');
    }

    // Try WebGL, fall back silently
    try {
      webglAddon = new WebglAddon.WebglAddon();
      webglAddon.onContextLoss(() => { webglAddon.dispose(); webglAddon = null; });
      term.loadAddon(webglAddon);
    } catch {
      // software renderer is fine
    }

    // Forward keystrokes to WebSocket — batched to prevent drops over high-latency connections
    // Instead of sending each character individually, buffer for a short window
    // and flush as a single message. Paste already comes as one chunk so no change there.
    let inputBuffer = '';
    let inputFlushTimer = null;
    const INPUT_BATCH_MS = 30; // ~33fps — imperceptible delay, big reliability gain on mobile

    term.onData((data) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      inputBuffer += data;
      if (!inputFlushTimer) {
        inputFlushTimer = setTimeout(() => {
          if (inputBuffer && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(inputBuffer);
          }
          inputBuffer = '';
          inputFlushTimer = null;
        }, INPUT_BATCH_MS);
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

    // Kill button in terminal toolbar — uses the shared modal from dashboard
    document.getElementById('terminal-kill-btn').addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentSession) return;
      const name = currentSession;
      const confirmed = await App.showModal(`Kill session "${name}"? This will terminate all processes in it.`, 'Kill');
      if (!confirmed) return;
      try {
        await fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' });
        App.navigate('dashboard');
      } catch { /* handled by disconnect */ }
    });

    // AI title generation — magic sparkle button
    const aiTitleBtn = document.getElementById('ai-title-btn');
    aiTitleBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentSession || aiTitleBtn.classList.contains('loading')) return;
      aiTitleBtn.classList.add('loading');
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(currentSession)}/generate-title`, { method: 'POST' });
        const data = await res.json();
        if (data.title) {
          document.getElementById('terminal-session-name').textContent = data.title;
        }
      } catch { /* ignore */ }
      aiTitleBtn.classList.remove('loading');
    });

    // Editable session name — click label to edit
    const nameLabel = document.getElementById('terminal-session-name');
    const nameInput = document.getElementById('terminal-session-name-edit');

    nameLabel.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentSession) return;
      nameInput.value = nameLabel.textContent;
      nameLabel.classList.add('hidden');
      nameInput.classList.remove('hidden');
      nameInput.focus();
      nameInput.select();
    });

    async function commitRename() {
      nameInput.classList.add('hidden');
      nameLabel.classList.remove('hidden');
      let newName = nameInput.value.trim();
      if (!newName || newName === nameLabel.textContent) return;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(currentSession)}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName }),
        });
        if (res.ok) {
          nameLabel.textContent = newName;
          // currentSession and URL hash stay unchanged — tmux name is the stable ID
        }
      } catch { /* ignore */ }
    }

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      if (e.key === 'Escape') { e.preventDefault(); nameInput.classList.add('hidden'); nameLabel.classList.remove('hidden'); }
    });
    nameInput.addEventListener('blur', commitRename);

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

    // Text select overlay — grab terminal text for native mobile selection
    document.getElementById('qk-select').addEventListener('touchstart', (e) => {
      e.preventDefault();
      openTextSelect();
    }, { passive: false });
    document.getElementById('qk-select').addEventListener('click', (e) => {
      e.preventDefault();
      openTextSelect();
    });

    document.getElementById('text-select-close').addEventListener('click', closeTextSelect);
    document.getElementById('text-select-copy').addEventListener('click', () => {
      const content = document.getElementById('text-select-content').textContent;
      navigator.clipboard.writeText(content).then(() => {
        const btn = document.getElementById('text-select-copy');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy All'; }, 1500);
      });
    });

    // Keyboard-aware viewport: shift UI above the soft keyboard on mobile
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', adjustForKeyboard);
    }

    // Scroll controls — enter tmux copy-mode and scroll with press-and-hold
    const scrollUp = document.getElementById('scroll-up');
    const scrollDown = document.getElementById('scroll-down');

    function bindScrollBtn(btn, direction) {
      const start = (e) => { e.preventDefault(); startScrolling(direction); };
      const stop = (e) => { e.preventDefault(); stopScrolling(); };
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', stop, { passive: false });
      btn.addEventListener('touchcancel', stop, { passive: false });
      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', stop);
      btn.addEventListener('mouseleave', stop);
    }

    bindScrollBtn(scrollUp, 'up');
    bindScrollBtn(scrollDown, 'down');

    // Reset scroll mode when quickbar keys are pressed (Esc, Ctrl+C exit tmux copy-mode)
    document.getElementById('terminal-quickbar').addEventListener('touchstart', () => {
      if (inScrollMode) {
        stopScrolling();
        // Send 'q' to exit tmux copy-mode, then reset state
        if (ws && ws.readyState === WebSocket.OPEN) ws.send('q');
        exitScrollMode();
      }
    });

    updateZoomLabel();
  }

  function enterScrollMode() {
    if (inScrollMode) return;
    inScrollMode = true;
    // Send Ctrl+B [ to enter tmux copy-mode
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send('\x02');
      setTimeout(() => { if (ws && ws.readyState === WebSocket.OPEN) ws.send('['); }, 30);
    }
    document.getElementById('scroll-controls').classList.add('active');
  }

  function exitScrollMode() {
    if (!inScrollMode) return;
    inScrollMode = false;
    document.getElementById('scroll-controls').classList.remove('active');
  }

  function startScrolling(direction) {
    stopScrolling(); // clear any leftover state first
    if (!term || !ws || ws.readyState !== WebSocket.OPEN) return;

    const needsEnter = !inScrollMode;
    if (needsEnter) enterScrollMode();

    // Wait for copy-mode to activate before sending scroll keys
    scrollStartTimer = setTimeout(() => {
      scrollStartTimer = null;
      const seq = direction === 'up' ? '\x1b[A' : '\x1b[B';
      // Send initial burst
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(seq + seq);

      // Continue scrolling while held — 2 lines every 120ms
      scrollInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(seq + seq);
        } else {
          stopScrolling();
        }
      }, 120);
    }, needsEnter ? 100 : 0);

    // Hard safety stop — max 1 second of scrolling after any press
    scrollSafetyTimer = setTimeout(stopScrolling, 1000);
  }

  function stopScrolling() {
    if (scrollStartTimer) { clearTimeout(scrollStartTimer); scrollStartTimer = null; }
    if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; }
    if (scrollSafetyTimer) { clearTimeout(scrollSafetyTimer); scrollSafetyTimer = null; }
  }

  function openTextSelect() {
    if (!term) return;
    const buf = term.buffer.active;
    let lines = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    // Trim trailing empty lines
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    document.getElementById('text-select-content').textContent = lines.join('\n');
    document.getElementById('text-select-overlay').classList.remove('hidden');
  }

  function closeTextSelect() {
    document.getElementById('text-select-overlay').classList.add('hidden');
    if (term) term.focus();
  }

  function adjustForKeyboard() {
    if (window.innerWidth > 768) {
      document.body.style.height = '';
      return;
    }
    const vv = window.visualViewport;
    document.body.style.height = `${vv.height}px`;
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

    const url = App.getWsUrl(sessionName);

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
    stopScrolling();
    exitScrollMode();
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
