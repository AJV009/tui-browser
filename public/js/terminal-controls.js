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

    // Files button in terminal pill controls
    const termFilesBtn = document.getElementById('terminal-files-btn');
    if (termFilesBtn) {
      termFilesBtn.addEventListener('click', () => {
        const serverOrigin = App.getCurrentServer() ? ServerManager.getOrigin(App.getCurrentServer()) : '';
        FileBrowser.open(null, serverOrigin || '');
      });
    }

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

    // Quickbar button taps — only handle anchored buttons (outside pages area)
    document.getElementById('terminal-quickbar').addEventListener('touchstart', async (e) => {
      const btn = e.target.closest('.qk');
      if (!btn) return;
      if (btn.closest('.qk-pages-area')) return; // pages area handles its own buttons
      e.preventDefault();
      const seq = QK_MAP[btn.dataset.qk];
      if (!seq || !_term) return;
      try {
        if (_ensureConnected) await _ensureConnected();
        _term.input(seq, true);
      } catch { /* silently ignore for ephemeral keys */ }
    }, { passive: false });

    // Quickbar paged swipe + dot navigation
    const qkPagesArea = document.getElementById('qk-pages-area');
    const qkPages = document.getElementById('qk-pages');
    const qkDots = document.getElementById('qk-dots');
    const totalPages = qkPages.children.length;
    let qkCurrentPage = 0;
    let qkSwipeStartX = null;
    let qkSwipeDeltaX = 0;
    let qkTouchedBtn = null;

    function setQkPage(page) {
      qkCurrentPage = Math.max(0, Math.min(totalPages - 1, page));
      qkPages.style.transform = `translateX(-${qkCurrentPage * 100}%)`;
      qkDots.querySelectorAll('.qk-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === qkCurrentPage);
      });
    }

    qkDots.addEventListener('click', (e) => {
      const dot = e.target.closest('.qk-dot');
      if (dot) setQkPage(Number(dot.dataset.dot));
    });

    // Desktop arrow buttons
    document.getElementById('qk-arrow-left').addEventListener('click', () => setQkPage(qkCurrentPage - 1));
    document.getElementById('qk-arrow-right').addEventListener('click', () => setQkPage(qkCurrentPage + 1));

    // Pages area: always track swipe, decide tap vs swipe on touchend
    qkPagesArea.addEventListener('touchstart', (e) => {
      qkSwipeStartX = e.touches[0].clientX;
      qkSwipeDeltaX = 0;
      qkTouchedBtn = e.target.closest('.qk');
      qkPages.style.transition = 'none';
    }, { passive: true });

    qkPagesArea.addEventListener('touchmove', (e) => {
      if (qkSwipeStartX === null) return;
      qkSwipeDeltaX = e.touches[0].clientX - qkSwipeStartX;
      const pct = -qkCurrentPage * 100 + (qkSwipeDeltaX / qkPagesArea.offsetWidth) * 100;
      qkPages.style.transform = `translateX(${pct}%)`;
    }, { passive: true });

    qkPagesArea.addEventListener('touchend', async () => {
      if (qkSwipeStartX === null) return;
      qkPages.style.transition = 'transform 0.25s ease';
      const threshold = qkPagesArea.offsetWidth * 0.2;
      if (qkSwipeDeltaX < -threshold) {
        setQkPage(qkCurrentPage + 1);
      } else if (qkSwipeDeltaX > threshold) {
        setQkPage(qkCurrentPage - 1);
      } else {
        setQkPage(qkCurrentPage); // snap back
        // Not a swipe — fire button tap if touched one and barely moved
        if (qkTouchedBtn && Math.abs(qkSwipeDeltaX) < 10) {
          const seq = QK_MAP[qkTouchedBtn.dataset.qk];
          if (seq && _term) {
            try {
              if (_ensureConnected) await _ensureConnected();
              _term.input(seq, true);
            } catch { /* ignore */ }
          }
        }
      }
      qkSwipeStartX = null;
      qkTouchedBtn = null;
    });

    qkPagesArea.addEventListener('touchcancel', () => {
      qkPages.style.transition = 'transform 0.25s ease';
      setQkPage(qkCurrentPage);
      qkSwipeStartX = null;
      qkTouchedBtn = null;
    });

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
    let current = '';
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      if (line.isWrapped) {
        // Soft-wrapped continuation — join to previous line (trim trailing spaces from padding)
        current = current.replace(/\s+$/, '') + line.translateToString(true);
      } else {
        if (i > 0) lines.push(current);
        current = line.translateToString(true);
      }
    }
    lines.push(current);
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    document.getElementById('text-select-content').textContent = lines.join('\n');
    document.getElementById('text-select-overlay').classList.remove('hidden');
    App.pushOverlay('text-select', closeTextSelect);
  }

  function closeTextSelect() {
    if (document.getElementById('text-select-overlay').classList.contains('hidden')) return;
    App.popOverlay('text-select');
    document.getElementById('text-select-overlay').classList.add('hidden');
    if (_term) _term.focus();
  }

  return { init, stopScrolling, exitScrollMode, closeTextSelect };
})();
