/**
 * terminal-controls.js — Terminal scroll mode, text selection,
 * session operations (kill, rename, AI title), and quick-keys.
 */

/* global App */

const TerminalControls = (() => {
  let _term = null;
  let _getWs = null;
  let _getSession = null;
  let _ensureConnected = null;
  let inScrollMode = false;
  let scrollInterval = null;
  let scrollStartTimer = null;
  let scrollSafetyTimer = null;
  let swipeTouchY = null;
  let swipeAccum = 0;
  let swipeTmuxOffset = 0;
  let swipeReady = false;
  let swipeQueuedLines = 0;

  function init({ term, getWs, getSession, ensureConnected }) {
    _term = term;
    _getWs = getWs;
    _getSession = getSession;
    _ensureConnected = ensureConnected;

    // Kill button
    document.getElementById('terminal-kill-btn').addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const name = _getSession();
      if (!name) return;
      const confirmed = await App.showModal(`Kill session "${name}"? This will terminate all processes in it.`, 'Kill');
      if (!confirmed) return;
      try {
        await fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' });
        App.navigate('dashboard');
      } catch { /* handled by disconnect */ }
    });

    // AI title button
    const aiTitleBtn = document.getElementById('ai-title-btn');
    aiTitleBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const session = _getSession();
      if (!session || aiTitleBtn.classList.contains('loading')) return;
      aiTitleBtn.classList.add('loading');
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/generate-title`, { method: 'POST' });
        const data = await res.json();
        if (data.title) document.getElementById('terminal-session-name').textContent = data.title;
      } catch { /* ignore */ }
      aiTitleBtn.classList.remove('loading');
    });

    // Editable session name
    const nameLabel = document.getElementById('terminal-session-name');
    const nameInput = document.getElementById('terminal-session-name-edit');

    nameLabel.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!_getSession()) return;
      nameInput.value = nameLabel.textContent;
      nameLabel.classList.add('hidden');
      nameInput.classList.remove('hidden');
      nameInput.focus(); nameInput.select();
    });

    async function commitRename() {
      nameInput.classList.add('hidden');
      nameLabel.classList.remove('hidden');
      const newName = nameInput.value.trim();
      if (!newName || newName === nameLabel.textContent) return;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(_getSession())}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName }),
        });
        if (res.ok) nameLabel.textContent = newName;
      } catch { /* ignore */ }
    }

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      if (e.key === 'Escape') { e.preventDefault(); nameInput.classList.add('hidden'); nameLabel.classList.remove('hidden'); }
    });
    nameInput.addEventListener('blur', commitRename);

    // Quick-keys bar
    const QK_MAP = {
      'esc': '\x1b', 'tab': '\t', 'shift-tab': '\x1b[Z', 'enter': '\r',
      'ctrl-c': '\x03', 'ctrl-d': '\x04', 'ctrl-z': '\x1a',
      'up': '\x1b[A', 'down': '\x1b[B', 'left': '\x1b[D', 'right': '\x1b[C',
    };

    document.getElementById('terminal-quickbar').addEventListener('touchstart', async (e) => {
      const btn = e.target.closest('.qk');
      if (!btn) return;
      e.preventDefault();
      const seq = QK_MAP[btn.dataset.qk];
      if (!seq || !_term) return;
      try {
        if (_ensureConnected) await _ensureConnected();
        _term.input(seq, true);
      } catch { /* silently ignore for ephemeral keys */ }
    }, { passive: false });

    // Text select overlay
    document.getElementById('qk-select').addEventListener('touchstart', (e) => { e.preventDefault(); openTextSelect(); }, { passive: false });
    document.getElementById('qk-select').addEventListener('click', (e) => { e.preventDefault(); openTextSelect(); });
    document.getElementById('text-select-close').addEventListener('click', closeTextSelect);
    document.getElementById('text-select-copy').addEventListener('click', () => {
      const content = document.getElementById('text-select-content').textContent;
      navigator.clipboard.writeText(content).then(() => {
        const btn = document.getElementById('text-select-copy');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy All'; }, 1500);
      });
    });

    // Scroll controls
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

    // Reset scroll UI when any quickbar key is tapped during scroll mode
    // (the actual tmux copy-mode exit is handled by the key itself — Esc/Ctrl-C)
    document.getElementById('terminal-quickbar').addEventListener('touchstart', () => {
      if (inScrollMode) {
        stopScrolling();
        exitScrollMode();
      }
    });

    // Swipe-to-scroll on terminal container
    const container = document.getElementById('terminal-container');

    container.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      swipeTouchY = e.touches[0].clientY;
      swipeAccum = 0;
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (swipeTouchY === null || e.touches.length !== 1 || !_term) return;
      const currentY = e.touches[0].clientY;
      const pixelDelta = currentY - swipeTouchY; // positive = finger moved down (scroll up)
      if (Math.abs(pixelDelta) > 2) e.preventDefault();
      swipeTouchY = currentY;

      swipeAccum += pixelDelta;
      const lineH = Math.round(container.clientHeight / _term.rows) || 16;
      const lines = Math.trunc(swipeAccum / lineH);
      if (lines === 0) return;
      swipeAccum -= lines * lineH;
      handleSwipeLines(lines);
    }, { passive: false });

    container.addEventListener('touchend', () => { swipeTouchY = null; });
    container.addEventListener('touchcancel', () => { swipeTouchY = null; });
  }

  // ---------- Scroll Mode ----------

  function enterScrollMode() {
    if (inScrollMode) return;
    inScrollMode = true;
    const ws = _getWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send('\x02');
      setTimeout(() => { const w = _getWs(); if (w && w.readyState === WebSocket.OPEN) w.send('['); }, 30);
    }
    document.getElementById('scroll-controls').classList.add('active');
  }

  function exitScrollMode() {
    if (!inScrollMode) return;
    inScrollMode = false;
    swipeTmuxOffset = 0;
    swipeReady = false;
    swipeQueuedLines = 0;
    document.getElementById('scroll-controls').classList.remove('active');
  }

  function handleSwipeLines(lines) {
    // lines > 0 = swiping up (earlier content), lines < 0 = swiping down (recent content)
    if (!inScrollMode) {
      enterScrollMode();
      swipeTmuxOffset = 0;
      swipeReady = false;
      swipeQueuedLines = lines;
      // Wait for Ctrl+B (0ms) + [ (30ms) + tmux processing before sending arrows
      setTimeout(() => {
        swipeReady = true;
        if (swipeQueuedLines > 0) {
          swipeTmuxOffset = swipeQueuedLines;
          sendTmuxArrows(swipeQueuedLines);
        }
        swipeQueuedLines = 0;
      }, 120);
      return;
    }
    if (!swipeReady) {
      // Still waiting for copy-mode — accumulate
      swipeQueuedLines += lines;
      return;
    }
    if (lines < 0) {
      swipeTmuxOffset -= Math.abs(lines);
      if (swipeTmuxOffset <= 0) {
        const ws = _getWs();
        if (ws && ws.readyState === WebSocket.OPEN) ws.send('q');
        exitScrollMode();
        return;
      }
    } else {
      swipeTmuxOffset += lines;
    }
    sendTmuxArrows(lines);
  }

  function sendTmuxArrows(lines) {
    const ws = _getWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const seq = lines > 0 ? '\x1b[A' : '\x1b[B';
    const count = Math.abs(lines);
    let payload = '';
    for (let i = 0; i < count; i++) payload += seq;
    ws.send(payload);
  }

  function startScrolling(direction) {
    stopScrolling();
    const ws = _getWs();
    if (!_term || !ws || ws.readyState !== WebSocket.OPEN) return;
    const needsEnter = !inScrollMode;
    if (needsEnter) enterScrollMode();

    scrollStartTimer = setTimeout(() => {
      scrollStartTimer = null;
      const seq = direction === 'up' ? '\x1b[A' : '\x1b[B';
      const w = _getWs();
      if (w && w.readyState === WebSocket.OPEN) w.send(seq + seq);
      scrollInterval = setInterval(() => {
        const w2 = _getWs();
        if (w2 && w2.readyState === WebSocket.OPEN) w2.send(seq + seq);
        else stopScrolling();
      }, 120);
    }, needsEnter ? 100 : 0);

    scrollSafetyTimer = setTimeout(stopScrolling, 1000);
  }

  function stopScrolling() {
    if (scrollStartTimer) { clearTimeout(scrollStartTimer); scrollStartTimer = null; }
    if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; }
    if (scrollSafetyTimer) { clearTimeout(scrollSafetyTimer); scrollSafetyTimer = null; }
  }

  // ---------- Text Select ----------

  function openTextSelect() {
    if (!_term) return;
    TerminalTextInput.close();
    const buf = _term.buffer.active;
    let lines = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    document.getElementById('text-select-content').textContent = lines.join('\n');
    document.getElementById('text-select-overlay').classList.remove('hidden');
  }

  function closeTextSelect() {
    document.getElementById('text-select-overlay').classList.add('hidden');
    if (_term) _term.focus();
  }

  return { init, stopScrolling, exitScrollMode, closeTextSelect };
})();
