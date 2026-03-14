/**
 * dashboard.js — Session list UI with auto-refresh.
 * Shows tmux sessions and Kitty windows (via kitty remote control discovery).
 */

/* global App */

const Dashboard = (() => {
  let refreshInterval = null;
  const REFRESH_MS = 3000;

  function init() {
    document.getElementById('create-session-form').addEventListener('submit', handleCreate);

    // Event delegation for session card buttons
    document.getElementById('session-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'connect') {
        connectTo(btn.dataset.session);
      } else if (action === 'kill') {
        kill(btn.dataset.session);
      }
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
      if (!res.ok) throw new Error('No shortcuts');
      shortcutsData = await res.json();
      if (!shortcutsData.length) { btn.style.display = 'none'; return; }

      menu.innerHTML = shortcutsData.map((s, i) => `
        <div class="shortcut-item" data-shortcut-idx="${i}">
          <span class="shortcut-label">${esc(s.label)}</span>
          <span class="shortcut-cmd">${esc(s.command)}</span>
        </div>`).join('');
    } catch {
      btn.style.display = 'none';
      return;
    }

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
      const idx = parseInt(item.dataset.shortcutIdx, 10);
      if (shortcutsData[idx]) launchShortcut(shortcutsData[idx]);
      closeShortcuts();
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

  function closeShortcuts() {
    const menu = document.getElementById('shortcuts-menu');
    if (menu) menu.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
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
        await showModal(err.error || 'Failed to launch shortcut', 'OK');
        return;
      }
      // Connect to the new session immediately
      connectTo(name);
    } catch (err) {
      await showModal('Failed to launch shortcut: ' + err.message, 'OK');
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/discover');
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      render(data.sessions || [], data.unmatchedKitty || []);
    } catch (err) {
      renderError(err.message);
    }
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

    let html = '';
    html += sessions.map(renderSessionCard).join('');

    if (unmatchedKitty.length > 0) {
      html += renderUnmatchedKitty(unmatchedKitty);
    }

    list.innerHTML = html;
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

    return `
      <div class="session-card${hasKitty ? ' kitty-card' : ''}" data-session="${esc(s.name)}">
        <div class="session-card-header">
          <span class="session-name">${esc(s.name)}</span>
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
          <button class="btn btn-primary" data-action="connect" data-session="${esc(s.name)}">Connect</button>
          <button class="btn btn-danger" data-action="kill" data-session="${esc(s.name)}">Kill</button>
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
    const list = document.getElementById('session-list');
    list.innerHTML = `
      <div class="empty-state">
        <h3>Cannot reach server</h3>
        <p>${esc(msg)}</p>
      </div>`;
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
        await showModal(err.error || 'Failed to create session', 'OK');
        return;
      }
      nameInput.value = '';
      cmdInput.value = '';
      await refresh();
    } catch (err) {
      await showModal('Failed to create session: ' + err.message, 'OK');
    }
  }

  function connectTo(sessionName) {
    App.navigate('terminal', { session: sessionName });
  }

  function showModal(message, confirmLabel = 'Confirm') {
    return new Promise((resolve) => {
      const overlay = document.getElementById('modal-overlay');
      const msg = document.getElementById('modal-message');
      const confirmBtn = document.getElementById('modal-confirm');
      const cancelBtn = document.getElementById('modal-cancel');
      msg.textContent = message;
      confirmBtn.textContent = confirmLabel;
      overlay.classList.remove('hidden');

      function cleanup(result) {
        overlay.classList.add('hidden');
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      }
      function onConfirm() { cleanup(true); }
      function onCancel() { cleanup(false); }

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  async function kill(sessionName) {
    const confirmed = await showModal(
      `Kill session "${sessionName}"? This will terminate all processes in it.`,
      'Kill'
    );
    if (!confirmed) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      await showModal('Failed to kill session: ' + err.message, 'OK');
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

  // HTML escape (including single quotes for attribute safety)
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML.replace(/'/g, '&#39;');
  }

  return { init, refresh };
})();
