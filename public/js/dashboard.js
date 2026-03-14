/**
 * dashboard.js — Session list UI with auto-refresh.
 * Shows tmux sessions and Kitty windows (via kitty remote control discovery).
 */

/* global App */

const Dashboard = (() => {
  let refreshInterval = null;
  const REFRESH_MS = 3000;
  let sortMode = 'recent'; // 'recent' | 'oldest' | 'active' | 'idle'
  let lastSessions = null;
  let lastUnmatchedKitty = null;
  const selectedSessions = new Set();

  const SHELL_NAMES = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'nu', 'pwsh', 'login']);

  // Inline SVG icons (22x22, fill the 38px btn-icon buttons properly)
  const ICON = {
    connect: '<svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><path d="M7 3.5v15l11-7.5z"/></svg>',
    kill: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l10 10M16 6l-10 10"/></svg>',
    monitor: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="18" height="12" rx="2"/><path d="M8 19h6M11 16v3"/></svg>',
    info: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8.5"/><path d="M11 10v5.5M11 7v.01" stroke-linecap="round"/></svg>',
  };

  let infoInterval = null;

  function init() {
    document.getElementById('create-session-form').addEventListener('submit', handleCreate);

    // Event delegation for session card buttons
    document.getElementById('session-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'connect') {
        connectTo(btn.dataset.session);
      } else if (action === 'open-terminal') {
        openOnPC(btn.dataset.session, btn);
      } else if (action === 'info') {
        openInfo(btn.dataset.session);
      } else if (action === 'kill') {
        kill(btn.dataset.session);
      } else if (action === 'toggle-select') {
        toggleSelect(btn.dataset.session);
      }
    });

    // Double-tap on session card to connect
    let lastTap = 0;
    let lastTapSession = null;
    document.getElementById('session-list').addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return; // ignore button clicks
      const card = e.target.closest('.session-card[data-session]');
      if (!card) return;
      const session = card.dataset.session;
      const now = Date.now();
      if (session === lastTapSession && now - lastTap < 400) {
        connectTo(session);
        lastTap = 0;
        lastTapSession = null;
      } else {
        lastTap = now;
        lastTapSession = session;
      }
    });

    document.getElementById('info-close').addEventListener('click', closeInfo);
    document.getElementById('bulk-kill-btn').addEventListener('click', handleBulkKill);

    document.getElementById('sort-select').addEventListener('change', (e) => {
      sortMode = e.target.value;
      refresh();
    });

    // Render cached data instantly (no flash of empty state)
    renderFromCache();

    // Refresh immediately on phone wake / tab focus
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });

    initShortcuts();
    startAutoRefresh();
  }

  // ---------- Shortcuts ----------

  let shortcutsData = [];
  let backdrop = null;

  async function initShortcuts() {
    const btn = document.getElementById('shortcuts-btn');
    const menu = document.getElementById('shortcuts-menu');

    try {
      const res = await fetch('/shortcuts.json');
      if (res.ok) shortcutsData = await res.json();
    } catch { /* no shortcuts file */ }

    let menuHtml = shortcutsData.map((s, i) => `
      <div class="shortcut-item" data-shortcut-idx="${i}">
        <span class="shortcut-label">${esc(s.label)}</span>
        <span class="shortcut-cmd">${esc(s.command)}</span>
      </div>`).join('');

    // Always add the custom command option
    menuHtml += `<div class="shortcut-item shortcut-custom" data-action="custom">
      <span class="shortcut-label">+ Custom command</span>
      <span class="shortcut-cmd">Launch a session with any command</span>
    </div>`;

    menu.innerHTML = menuHtml;

    // Create backdrop element (reused)
    backdrop = document.createElement('div');
    backdrop.className = 'shortcuts-backdrop hidden';
    document.body.appendChild(backdrop);

    // Move menu to body so it's not clipped by overflow parents
    document.body.appendChild(menu);

    btn.addEventListener('click', () => {
      const isOpen = !menu.classList.contains('hidden');
      if (isOpen) { closeShortcuts(); return; }
      openShortcuts(btn, menu);
    });

    backdrop.addEventListener('click', closeShortcuts);

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.shortcut-item');
      if (!item) return;
      closeShortcuts();
      if (item.dataset.action === 'custom') {
        showCustomCommandPopup();
        return;
      }
      const idx = parseInt(item.dataset.shortcutIdx, 10);
      if (shortcutsData[idx]) launchShortcut(shortcutsData[idx]);
    });
  }

  function openShortcuts(btn, menu) {
    const isMobile = window.innerWidth <= 768;

    if (!isMobile) {
      // Desktop: position below the button
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.left = '';
      menu.style.bottom = '';
    }
    // Mobile: CSS handles positioning (bottom sheet)

    backdrop.classList.remove('hidden');
    menu.classList.remove('hidden');
  }

  function rebuildShortcutsMenu() {
    const menu = document.getElementById('shortcuts-menu');
    let menuHtml = shortcutsData.map((s, i) => `
      <div class="shortcut-item" data-shortcut-idx="${i}">
        <span class="shortcut-label">${esc(s.label)}</span>
        <span class="shortcut-cmd">${esc(s.command)}</span>
      </div>`).join('');
    menuHtml += `<div class="shortcut-item shortcut-custom" data-action="custom">
      <span class="shortcut-label">+ Custom command</span>
      <span class="shortcut-cmd">Launch a session with any command</span>
    </div>`;
    menu.innerHTML = menuHtml;
  }

  function closeShortcuts() {
    const menu = document.getElementById('shortcuts-menu');
    if (menu) menu.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
  }

  function showCustomCommandPopup() {
    const overlay = document.getElementById('modal-overlay');
    const modal = overlay.querySelector('.modal');
    const msg = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    msg.innerHTML = `
      <div style="margin-bottom:12px;font-family:var(--mono);font-size:13px;font-weight:600;color:var(--accent)">Custom Command</div>
      <input id="custom-label" type="text" placeholder="Title (e.g. My Server)" autocomplete="off" style="width:100%;padding:8px 10px;margin-bottom:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--mono);font-size:12px;outline:none;">
      <input id="custom-cmd" type="text" placeholder="Command (e.g. cd ~/app && npm start)" autocomplete="off" style="width:100%;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--mono);font-size:12px;outline:none;">`;

    overlay.classList.remove('hidden');
    setTimeout(() => document.getElementById('custom-label').focus(), 50);

    function cleanup() {
      overlay.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    }

    async function onConfirm() {
      const label = document.getElementById('custom-label').value.trim();
      const cmd = document.getElementById('custom-cmd').value.trim();
      cleanup();
      if (!label || !cmd) return;
      // Save to shortcuts.json, rebuild menu, then launch
      try {
        const res = await fetch('/api/shortcuts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, command: cmd }),
        });
        if (res.ok) {
          const data = await res.json();
          shortcutsData = data.shortcuts;
          rebuildShortcutsMenu();
        }
      } catch { /* save failed, still launch */ }
      launchShortcut({ label, command: cmd });
    }

    function onCancel() { cleanup(); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  }

  async function launchShortcut(shortcut) {
    // Auto-generate session name from label
    const base = shortcut.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const name = base + '-' + Date.now().toString(36).slice(-4);

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, command: shortcut.command }),
      });
      if (!res.ok) {
        const err = await res.json();
        await App.showModal(err.error || 'Failed to launch shortcut', 'OK');
        return;
      }
      // Connect to the new session immediately
      connectTo(name);
    } catch (err) {
      await App.showModal('Failed to launch shortcut: ' + err.message, 'OK');
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/discover');
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      lastSessions = data.sessions || [];
      lastUnmatchedKitty = data.unmatchedKitty || [];
      // Cache for instant render on next load
      try { localStorage.setItem('tui_sessions_cache', JSON.stringify({ sessions: lastSessions, unmatchedKitty: lastUnmatchedKitty })); } catch { /* quota */ }
      render(lastSessions, lastUnmatchedKitty);

      // Piggyback: check local path on every successful dashboard poll (no extra cost if already local)
      if (!App.getLocalOrigin()) App.onNetworkChange();
    } catch {
      // On error, keep existing content — don't wipe the list
      // Only show error if we have nothing at all
      if (!lastSessions) renderError('Connecting\u2026');
    }
  }

  function renderFromCache() {
    try {
      const cached = JSON.parse(localStorage.getItem('tui_sessions_cache'));
      if (cached && cached.sessions) {
        lastSessions = cached.sessions;
        lastUnmatchedKitty = cached.unmatchedKitty || [];
        render(lastSessions, lastUnmatchedKitty);
      }
    } catch { /* no cache */ }
  }

  function render(sessions, unmatchedKitty) {
    const list = document.getElementById('session-list');

    if (sessions.length === 0 && unmatchedKitty.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <h3>No sessions found</h3>
          <p>Create a new tmux session to get started.</p>
        </div>`;
      return;
    }

    // Sort sessions
    const sorted = [...sessions].sort((a, b) => {
      switch (sortMode) {
        case 'recent': return b.created - a.created;
        case 'oldest': return a.created - b.created;
        case 'active': return (b.lastActivity || 0) - (a.lastActivity || 0);
        case 'idle': return (a.lastActivity || 0) - (b.lastActivity || 0);
        default: return 0;
      }
    });

    let html = '';
    html += sorted.map(renderSessionCard).join('');

    if (unmatchedKitty.length > 0) {
      html += renderUnmatchedKitty(unmatchedKitty);
    }

    list.innerHTML = html;

    // Prune stale selections
    const currentNames = new Set(sessions.map(s => s.name));
    for (const name of selectedSessions) {
      if (!currentNames.has(name)) selectedSessions.delete(name);
    }
    updateBulkKillButton();
  }

  function renderSessionCard(s) {
    const pane = s.panes && s.panes[0];
    const cmd = pane ? pane.command : 'unknown';
    const size = pane ? `${pane.width}x${pane.height}` : '';
    const created = new Date(s.created).toLocaleString();
    const hasKitty = s.kittyWindows && s.kittyWindows.length > 0;

    // Status logic: accounts for Kitty windows always counting as attached clients
    let statusClass = 'detached';
    let statusLabel = 'Detached';
    if (s.webClients > 0) {
      statusClass = 'web-connected';
      statusLabel = `${s.webClients} web client${s.webClients > 1 ? 's' : ''}`;
    } else if (hasKitty && s.attached === s.kittyWindows.length) {
      statusClass = 'attached';
      statusLabel = 'Kitty attached';
    } else if (s.attached > 0) {
      statusClass = 'attached';
      statusLabel = hasKitty ? 'Host + Kitty attached' : 'Host attached';
    }

    // Kitty badge
    let kittyBadge = '';
    if (hasKitty) {
      const kittyInfo = s.kittyWindows.length === 1
        ? `tab: ${esc(s.kittyWindows[0].tabTitle)}`
        : `${s.kittyWindows.length} Kitty viewers`;
      kittyBadge = `
        <div class="session-meta">
          <span><span class="source-icon kitty-icon">K</span> ${kittyInfo}</span>
          ${s.kittyWindows.some(w => w.isFocused) ? '<span>focused</span>' : ''}
        </div>`;
    }

    const label = s.displayTitle || s.name;

    const isSelected = selectedSessions.has(s.name);

    return `
      <div class="session-card${hasKitty ? ' kitty-card' : ''}${isSelected ? ' session-selected' : ''}" data-session="${esc(s.name)}">
        <div class="select-circle${isSelected ? ' selected' : ''}" data-action="toggle-select" data-session="${esc(s.name)}"></div>
        <div class="session-card-header">
          <span class="session-name">${esc(label)}</span>
          <span class="session-status">
            ${hasKitty ? '<span class="source-badge kitty-badge">Kitty</span>' : ''}
            <span class="status-dot ${statusClass}"></span>
            ${statusLabel}
          </span>
        </div>
        ${kittyBadge}
        <div class="session-meta">
          <span>cmd: ${esc(cmd)}</span>
          <span>${s.windows} window${s.windows !== 1 ? 's' : ''}</span>
          ${size ? `<span>${size}</span>` : ''}
          <span>${created}</span>
        </div>
        <div class="session-actions">
          <button class="btn btn-primary btn-icon" data-action="connect" data-session="${esc(s.name)}" title="Connect">${ICON.connect}</button>
          <button class="btn btn-secondary btn-icon" data-action="open-terminal" data-session="${esc(s.name)}" title="Open on PC">${ICON.monitor}</button>
          <button class="btn btn-secondary btn-icon" data-action="info" data-session="${esc(s.name)}" title="Session info">${ICON.info}</button>
          <button class="btn btn-danger btn-icon" data-action="kill" data-session="${esc(s.name)}" title="Kill">${ICON.kill}</button>
        </div>
      </div>`;
  }

  function renderUnmatchedKitty(windows) {
    let html = `<div class="source-section unmatched-kitty-section">
      <div class="source-header">
        <span class="source-badge kitty-badge">Kitty</span>
        <span class="source-label">Not available for mirroring — not running inside tmux</span>
      </div>
    </div>`;
    for (const win of windows) {
      const size = win.columns && win.lines ? `${win.columns}x${win.lines}` : '';
      html += `
        <div class="session-card kitty-card unmatched-card" data-kitty-id="${win.id}">
          <div class="session-card-header">
            <span class="session-name">
              <span class="source-icon kitty-icon">K</span>
              ${esc(win.title)}
            </span>
          </div>
          <div class="session-meta">
            ${win.cmdline ? `<span>cmd: ${esc(win.cmdline)}</span>` : ''}
            ${size ? `<span>${size}</span>` : ''}
            ${win.cwd ? `<span>cwd: ${esc(win.cwd)}</span>` : ''}
            <span>tab: ${esc(win.tabTitle)}</span>
          </div>
        </div>`;
    }
    return html;
  }

  function renderError(msg) {
    // Only show error if we have no content at all
    const list = document.getElementById('session-list');
    if (list.children.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <h3>Cannot reach server</h3>
          <p>${esc(msg)}</p>
        </div>`;
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const nameInput = document.getElementById('new-session-name');
    const cmdInput = document.getElementById('new-session-cmd');
    const name = nameInput.value.trim();
    const command = cmdInput.value.trim() || 'bash';

    if (!name) { nameInput.focus(); return; }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, command }),
      });
      if (!res.ok) {
        const err = await res.json();
        await App.showModal(err.error || 'Failed to create session', 'OK');
        return;
      }
      nameInput.value = '';
      cmdInput.value = '';
      await refresh();
    } catch (err) {
      await App.showModal('Failed to create session: ' + err.message, 'OK');
    }
  }

  function connectTo(sessionName) {
    App.navigate('terminal', { session: sessionName });
  }

  async function openOnPC(sessionName, btn) {
    try {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      await fetch(`/api/sessions/${encodeURIComponent(sessionName)}/open-terminal`, { method: 'POST' });
      setTimeout(() => { btn.disabled = false; btn.style.opacity = ''; }, 2000);
    } catch {
      setTimeout(() => { btn.disabled = false; btn.style.opacity = ''; }, 2000);
    }
  }

  async function kill(sessionName) {
    const confirmed = await App.showModal(
      `Kill session "${sessionName}"? This will terminate all processes in it.`,
      'Kill'
    );
    if (!confirmed) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      await App.showModal('Failed to kill session: ' + err.message, 'OK');
    }
  }

  // ---------- Selection & Bulk Kill ----------

  function toggleSelect(name) {
    if (selectedSessions.has(name)) {
      selectedSessions.delete(name);
    } else {
      selectedSessions.add(name);
    }
    const card = document.querySelector(`.session-card[data-session="${CSS.escape(name)}"]`);
    if (card) {
      const circle = card.querySelector('.select-circle');
      if (circle) circle.classList.toggle('selected', selectedSessions.has(name));
      card.classList.toggle('session-selected', selectedSessions.has(name));
    }
    updateBulkKillButton();
  }

  function updateBulkKillButton() {
    const btn = document.getElementById('bulk-kill-btn');
    if (!btn) return;
    const count = selectedSessions.size;
    const badge = btn.querySelector('.bulk-kill-badge');
    if (count > 0) {
      btn.classList.add('has-selection');
      if (badge) badge.textContent = count;
    } else {
      btn.classList.remove('has-selection');
      if (badge) badge.textContent = '';
    }
  }

  async function handleBulkKill() {
    if (selectedSessions.size > 0) {
      const names = [...selectedSessions];
      const confirmed = await App.showModal(
        `Kill ${names.length} selected session${names.length > 1 ? 's' : ''}? This will terminate all processes in them.`,
        'Kill'
      );
      if (!confirmed) return;
      await executeBulkKill(names);
    } else {
      await showBulkKillModal();
    }
  }

  function isShellOnly(session) {
    if (!session.panes || session.panes.length === 0) return true;
    return session.panes.every(p => SHELL_NAMES.has(p.command));
  }

  function countInactive(sessions, minutes) {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return sessions.filter(s => s.lastActivity < cutoff).length;
  }

  function countForFilter(sessions, filter, minutes) {
    switch (filter) {
      case 'detached': return sessions.filter(s => s.attached === 0 && (s.webClients || 0) === 0).length;
      case 'no-commands': return sessions.filter(s => isShellOnly(s)).length;
      case 'inactive': return countInactive(sessions, minutes);
      case 'all': return sessions.length;
      default: return 0;
    }
  }

  function getNamesForFilter(sessions, filter, minutes) {
    switch (filter) {
      case 'detached': return sessions.filter(s => s.attached === 0 && (s.webClients || 0) === 0).map(s => s.name);
      case 'no-commands': return sessions.filter(s => isShellOnly(s)).map(s => s.name);
      case 'inactive': {
        const cutoff = Date.now() - minutes * 60 * 1000;
        return sessions.filter(s => s.lastActivity < cutoff).map(s => s.name);
      }
      case 'all': return sessions.map(s => s.name);
      default: return [];
    }
  }

  async function showBulkKillModal() {
    const sessions = lastSessions || [];
    if (sessions.length === 0) {
      await App.showModal('No sessions to kill.', 'OK');
      return;
    }

    const overlay = document.getElementById('modal-overlay');
    const modal = overlay.querySelector('.modal');
    const msg = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    const detachedCount = countForFilter(sessions, 'detached');
    const noCommandCount = countForFilter(sessions, 'no-commands');
    const totalCount = sessions.length;

    msg.innerHTML = `
      <div style="margin-bottom:12px;font-family:var(--mono);font-size:13px;font-weight:600;color:var(--danger)">Bulk Kill Sessions</div>
      <div class="bulk-kill-radios">
        <label class="bulk-radio">
          <input type="radio" name="bulk-filter" value="detached" checked>
          <span>Kill all detached sessions <span class="bulk-count">(${detachedCount})</span></span>
        </label>
        <label class="bulk-radio">
          <input type="radio" name="bulk-filter" value="no-commands">
          <span>Kill sessions with no running commands <span class="bulk-count">(${noCommandCount})</span></span>
        </label>
        <label class="bulk-radio">
          <input type="radio" name="bulk-filter" value="inactive">
          <span>Kill sessions inactive since past
            <input id="inactive-minutes" type="number" value="10" min="1" max="9999"
                   style="width:50px;padding:2px 4px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--mono);font-size:12px;text-align:center;"
                   onclick="event.stopPropagation()"> min
            <span class="bulk-count" id="inactive-count">(${countInactive(sessions, 10)})</span>
          </span>
        </label>
        <label class="bulk-radio">
          <input type="radio" name="bulk-filter" value="all">
          <span>Kill all sessions <span class="bulk-count">(${totalCount})</span></span>
        </label>
      </div>
      <div class="bulk-kill-note">You have selected to kill <strong id="bulk-kill-target-count">${detachedCount}</strong> session${detachedCount !== 1 ? 's' : ''}</div>`;

    modal.style.maxWidth = '440px';
    overlay.classList.remove('hidden');

    const radios = msg.querySelectorAll('input[name="bulk-filter"]');
    const minutesInput = msg.querySelector('#inactive-minutes');

    function updateNote() {
      const filter = msg.querySelector('input[name="bulk-filter"]:checked').value;
      const minutes = parseInt(minutesInput.value, 10) || 10;
      const count = countForFilter(sessions, filter, minutes);
      const inactiveCountEl = msg.querySelector('#inactive-count');
      if (inactiveCountEl) inactiveCountEl.textContent = `(${countInactive(sessions, minutes)})`;
      const targetEl = msg.querySelector('#bulk-kill-target-count');
      if (targetEl) targetEl.textContent = count;
    }

    radios.forEach(r => r.addEventListener('change', updateNote));
    minutesInput.addEventListener('input', updateNote);

    return new Promise(resolve => {
      function cleanup() {
        overlay.classList.add('hidden');
        modal.style.maxWidth = '';
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        resolve();
      }

      async function onConfirm() {
        const filter = msg.querySelector('input[name="bulk-filter"]:checked').value;
        const minutes = parseInt(minutesInput.value, 10) || 10;
        const names = getNamesForFilter(sessions, filter, minutes);
        cleanup();
        if (names.length === 0) {
          await App.showModal('No sessions match the selected filter.', 'OK');
          return;
        }
        await executeBulkKill(names, filter, filter === 'inactive' ? minutes : undefined);
      }

      function onCancel() { cleanup(); }

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  async function executeBulkKill(names, filter, inactiveMinutes) {
    try {
      const body = { names };
      if (filter) body.filter = filter;
      if (inactiveMinutes !== undefined) body.inactiveMinutes = inactiveMinutes;

      const res = await fetch('/api/sessions/bulk-kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        await App.showModal(err.error || 'Bulk kill failed', 'OK');
        return;
      }
      const result = await res.json();
      for (const name of result.killed) selectedSessions.delete(name);
      if (result.failed.length > 0) {
        await App.showModal(`Killed ${result.killed.length}. Failed: ${result.failed.map(f => f.name).join(', ')}`, 'OK');
      }
      await refresh();
    } catch (err) {
      await App.showModal('Bulk kill failed: ' + err.message, 'OK');
    }
  }

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      // Only refresh if dashboard is visible
      if (!document.getElementById('dashboard-view').classList.contains('hidden')) {
        refresh();
      }
    }, REFRESH_MS);
  }

  // ---------- Session Info Panel ----------

  function openInfo(sessionName) {
    document.getElementById('info-session-name').textContent = sessionName;
    document.getElementById('session-info-overlay').classList.remove('hidden');
    document.getElementById('info-body').innerHTML = '<div style="padding:20px;color:var(--text-muted);font-family:var(--mono);font-size:12px;">Loading\u2026</div>';
    fetchInfo(sessionName);
    infoInterval = setInterval(() => fetchInfo(sessionName), 2000);
  }

  function closeInfo() {
    document.getElementById('session-info-overlay').classList.add('hidden');
    if (infoInterval) { clearInterval(infoInterval); infoInterval = null; }
  }

  async function fetchInfo(sessionName) {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionName)}/info`);
      if (!res.ok) throw new Error('Session not found');
      const data = await res.json();
      renderInfo(data);
    } catch (err) {
      document.getElementById('info-body').innerHTML =
        `<div style="padding:20px;color:var(--danger);font-family:var(--mono);font-size:12px;">${esc(err.message)}</div>`;
      closeInfo();
    }
  }

  function renderInfo(d) {
    const now = Math.floor(Date.now() / 1000);
    const uptime = formatDuration(now - d.created);
    const idle = formatDuration(now - d.lastActivity);
    const createdStr = new Date(d.created * 1000).toLocaleString();
    const mem = formatMem(d.totalMemory);

    let html = `<div class="info-stats">
      <div class="info-stat"><div class="info-stat-label">Uptime</div><div class="info-stat-value accent">${uptime}</div></div>
      <div class="info-stat"><div class="info-stat-label">Last Active</div><div class="info-stat-value">${idle} ago</div></div>
      <div class="info-stat"><div class="info-stat-label">Memory</div><div class="info-stat-value blue">${mem}</div></div>
      <div class="info-stat"><div class="info-stat-label">CPU</div><div class="info-stat-value orange">${d.totalCpu.toFixed(1)}%</div></div>
      <div class="info-stat"><div class="info-stat-label">Processes</div><div class="info-stat-value">${d.processCount}</div></div>
      <div class="info-stat"><div class="info-stat-label">Windows</div><div class="info-stat-value">${d.windows}</div></div>
      <div class="info-stat"><div class="info-stat-label">Clients</div><div class="info-stat-value">${d.attached}</div></div>
      <div class="info-stat"><div class="info-stat-label">Created</div><div class="info-stat-value" style="font-size:11px">${createdStr}</div></div>
    </div>`;

    // Process table
    html += '<div class="info-section-title">Processes</div>';
    html += '<table class="info-procs"><thead><tr><th>PID</th><th>Command</th><th>Mem</th><th>CPU</th><th>CWD</th></tr></thead><tbody>';
    for (const pane of d.panes) {
      for (const proc of pane.processes) {
        const cwdShort = pane.cwd.replace(/^\/home\/[^/]+/, '~');
        html += `<tr>
          <td>${proc.pid}</td>
          <td class="proc-cmd">${esc(proc.command)}</td>
          <td class="proc-mem">${formatMem(proc.rss)}</td>
          <td>${proc.cpu.toFixed(1)}%</td>
          <td>${esc(cwdShort)}</td>
        </tr>`;
      }
    }
    html += '</tbody></table>';

    // Pane details
    if (d.panes.length > 0) {
      html += '<div class="info-section-title">Panes</div>';
      html += '<div class="info-stats">';
      for (const pane of d.panes) {
        html += `<div class="info-stat">
          <div class="info-stat-label">Win ${pane.window} / Pane ${pane.index}</div>
          <div class="info-stat-value" style="font-size:12px">${pane.width}x${pane.height}</div>
        </div>`;
      }
      html += '</div>';
    }

    // Recent output
    if (d.recentOutput.length > 0) {
      html += '<div class="info-section-title" style="margin-top:16px">Recent Output</div>';
      html += `<div class="info-output">${esc(d.recentOutput.join('\n').trimEnd())}</div>`;
    }

    document.getElementById('info-body').innerHTML = html;
  }

  function formatDuration(seconds) {
    if (seconds < 0) seconds = 0;
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function formatMem(kb) {
    if (kb >= 1048576) return (kb / 1048576).toFixed(1) + ' GB';
    if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
    return kb + ' kB';
  }

  // HTML escape (including single quotes for attribute safety)
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML.replace(/'/g, '&#39;');
  }

  return { init, refresh };
})();
