/**
 * dashboard.js — Session list UI with auto-refresh.
 * Sub-modules: dashboard-shortcuts.js, dashboard-bulk-kill.js, dashboard-info.js
 */

/* global App, DashboardShortcuts, DashboardBulkKill, DashboardInfo, ServerManager, FileBrowser */

const Dashboard = (() => {
  let refreshInterval = null;
  const REFRESH_MS = 3000;
  let sortMode = 'active';
  let lastSessions = null;
  let lastUnmatchedKitty = null;
  const selectedSessions = new Set();

  const ICON = {
    connect: '<svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><path d="M7 3.5v15l11-7.5z"/></svg>',
    kill: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h14M8 6V4.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5V6M6 6v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6M9.5 10v6M12.5 10v6"/></svg>',
    monitor: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="18" height="12" rx="2"/><path d="M8 19h6M11 16v3"/></svg>',
    info: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8.5"/><path d="M11 10v5.5M11 7v.01" stroke-linecap="round"/></svg>',
    lock: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="8" height="6" rx="1"/><path d="M5 6V4a2 2 0 0 1 4 0v2"/></svg>',
    unlock: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="8" height="6" rx="1"/><path d="M5 6V4a2 2 0 0 1 4 0"/></svg>',
  };

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML.replace(/'/g, '&#39;');
  }

  function init() {
    document.getElementById('create-session-form').addEventListener('submit', handleCreate);

    document.getElementById('session-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'connect') connectTo(btn.dataset.session, btn.dataset.server);
      else if (action === 'open-terminal') openOnPC(btn.dataset.session, btn);
      else if (action === 'info') DashboardInfo.open(btn.dataset.session);
      else if (action === 'kill') kill(btn.dataset.session, btn.dataset.server);
      else if (action === 'toggle-select') DashboardBulkKill.toggleSelect(btn.dataset.session);
      else if (action === 'toggle-lock') toggleLock(btn.dataset.session);
      else if (action === 'reconnect-server') ServerManager.reconnectServer(btn.dataset.server);
      else if (action === 'server-files') { e.stopPropagation(); FileBrowser.open(null, ServerManager.getOrigin(btn.dataset.server)); }
      else if (action === 'toggle-collapse') { const n = btn.dataset.server; setCollapsed(n, !getCollapsed()[n]); renderMultiServer(); }
    });

    let lastTap = 0, lastTapSession = null;
    document.getElementById('session-list').addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      const card = e.target.closest('.session-card[data-session]');
      if (!card) return;
      const session = card.dataset.session;
      const now = Date.now();
      if (session === lastTapSession && now - lastTap < 400) { connectTo(session); lastTap = 0; lastTapSession = null; }
      else { lastTap = now; lastTapSession = session; }
    });

    document.getElementById('sort-select').addEventListener('change', (e) => { sortMode = e.target.value; refresh(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

    const deps = { esc, connectTo, selectedSessions, getLastSessions: () => lastSessions || [], refresh };
    DashboardShortcuts.init(deps);
    DashboardBulkKill.init(deps);
    DashboardInfo.init(deps);

    startAutoRefresh();
  }

  // ---------- Data ----------

  async function refresh() {
    await ServerManager.discoverAll();
    renderMultiServer();
  }

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      if (!document.getElementById('dashboard-view').classList.contains('hidden')) refresh();
    }, REFRESH_MS);
  }

  // ---------- Rendering ----------

  function renderSessionCard(s) {
    const pane = s.panes && s.panes[0];
    const cmd = pane ? pane.command : 'unknown';
    const paneTitle = pane && pane.title ? pane.title : '';
    const created = new Date(s.created).toLocaleString();
    const hasKitty = s.kittyWindows && s.kittyWindows.length > 0;
    let statusClass = 'detached', statusLabel = 'Detached';
    if (s.webClients > 0) { statusClass = 'web-connected'; statusLabel = `${s.webClients} web client${s.webClients > 1 ? 's' : ''}`; }
    else if (hasKitty && s.attached === s.kittyWindows.length) { statusClass = 'attached'; statusLabel = 'Kitty attached'; }
    else if (s.attached > 0) { statusClass = 'attached'; statusLabel = hasKitty ? 'Host + Kitty attached' : 'Host attached'; }

    let kittyBadge = '';
    if (hasKitty) {
      const kittyInfo = s.kittyWindows.length === 1 ? `tab: ${esc(s.kittyWindows[0].tabTitle)}` : `${s.kittyWindows.length} Kitty viewers`;
      kittyBadge = `<div class="session-meta"><span><span class="source-icon kitty-icon">K</span> ${kittyInfo}</span>${s.kittyWindows.some(w => w.isFocused) ? '<span>focused</span>' : ''}</div>`;
    }

    const label = s.displayTitle || s.name;
    const isSel = selectedSessions.has(s.name), isLocked = s.locked;

    let expiryHtml = '';
    if (s.expiresAt) {
      const d = new Date(s.expiresAt);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      expiryHtml = `<div class="session-expiry">Exp: ${dd}-${mm}-${yy},${hh}:${mi}</div>`;
    }

    return `<div class="session-card${hasKitty ? ' kitty-card' : ''}${isSel ? ' session-selected' : ''}${isLocked ? ' session-locked' : ''}" data-session="${esc(s.name)}">
        <div class="select-circle${isSel ? ' selected' : ''}" data-action="toggle-select" data-session="${esc(s.name)}"></div>
        <div class="lock-toggle${isLocked ? ' locked' : ''}" data-action="toggle-lock" data-session="${esc(s.name)}" title="${isLocked ? 'Unlock' : 'Lock'}">${isLocked ? ICON.lock : ICON.unlock}</div>
        <div class="session-card-header"><span class="session-name">${esc(label)}</span><span class="session-status">${hasKitty ? '<span class="source-badge kitty-badge">Kitty</span>' : ''}<span class="status-dot ${statusClass}"></span>${statusLabel}</span></div>
        ${kittyBadge}
        <div class="session-meta"><span>${esc(cmd)}</span><span>${created}</span>${paneTitle ? `<span>${esc(paneTitle)}</span>` : ''}</div>
        <div class="session-actions">
          <button class="btn btn-primary btn-icon" data-action="connect" data-session="${esc(s.name)}"${s._server ? ` data-server="${esc(s._server)}"` : ''} title="Connect">${ICON.connect}</button>
          <button class="btn btn-secondary btn-icon" data-action="open-terminal" data-session="${esc(s.name)}" title="Open on PC">${ICON.monitor}</button>
          <button class="btn btn-secondary btn-icon" data-action="info" data-session="${esc(s.name)}" title="Session info">${ICON.info}</button>
          <button class="btn btn-danger btn-icon${isLocked ? ' btn-locked' : ''}" data-action="kill" data-session="${esc(s.name)}"${s._server ? ` data-server="${esc(s._server)}"` : ''} title="${isLocked ? 'Locked' : 'Kill'}"${isLocked ? ' disabled' : ''}>${ICON.kill}</button>
        </div>
        ${expiryHtml}</div>`;
  }

  function renderUnmatchedKitty(windows) {
    let html = `<div class="source-section unmatched-kitty-section"><div class="source-header"><span class="source-badge kitty-badge">Kitty</span><span class="source-label">Not available for mirroring — not running inside tmux</span></div></div>`;
    for (const win of windows) {
      const size = win.columns && win.lines ? `${win.columns}x${win.lines}` : '';
      html += `<div class="session-card kitty-card unmatched-card" data-kitty-id="${win.id}"><div class="session-card-header"><span class="session-name"><span class="source-icon kitty-icon">K</span>${esc(win.title)}</span></div><div class="session-meta">${win.cmdline ? `<span>cmd: ${esc(win.cmdline)}</span>` : ''}${size ? `<span>${size}</span>` : ''}${win.cwd ? `<span>cwd: ${esc(win.cwd)}</span>` : ''}<span>tab: ${esc(win.tabTitle)}</span></div></div>`;
    }
    return html;
  }

  function renderError(msg) {
    const list = document.getElementById('session-list');
    if (list.children.length === 0) list.innerHTML = `<div class="empty-state"><h3>Cannot reach server</h3><p>${esc(msg)}</p></div>`;
  }

  const RECONNECT_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.3-4"/><path d="M13.5 8a5.5 5.5 0 0 1-9.3 4"/><path d="M11.5 1.5v3h3"/><path d="M4.5 14.5v-3h-3"/></svg>';
  const FILES_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
  const LOCAL_SVG = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#00e5a0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5L8 2l6 5.5"/><path d="M3.5 6.5V14H7v-4h2v4h3.5V6.5"/></svg>';
  const TUNNEL_SVG = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c-2 2-3 4-3 6.5s1 4.5 3 6.5M8 1.5c2 2 3 4 3 6.5s-1 4.5-3 6.5"/></svg>';

  // Collapsed state per server group (persisted in localStorage)
  function getCollapsed() {
    try { return JSON.parse(localStorage.getItem('tui_collapsed_groups') || '{}'); } catch { return {}; }
  }
  function setCollapsed(name, collapsed) {
    const state = getCollapsed();
    if (collapsed) state[name] = true; else delete state[name];
    localStorage.setItem('tui_collapsed_groups', JSON.stringify(state));
  }

  function renderMultiServer() {
    const list = document.getElementById('session-list');
    const connMode = document.getElementById('connection-mode');
    if (connMode) connMode.style.display = 'none';
    const states = ServerManager.getServerStates();
    // Ensure HOST is always first
    const serverNames = ['HOST', ...Object.keys(states).filter(n => n !== 'HOST')];
    const collapsed = getCollapsed();

    let html = '';
    let totalSessions = 0;

    for (const name of serverNames) {
      const state = states[name];
      if (!state) continue;
      const isOnline = state.online;
      const isUpdating = state.updating;
      const sessions = state.sessions || [];
      const isCollapsed = !!collapsed[name];
      totalSessions += sessions.length;

      html += `<div class="server-group${isOnline ? '' : ' offline'}${isCollapsed ? ' collapsed' : ''}">`;
      html += `<div class="server-group-header" data-action="toggle-collapse" data-server="${esc(name)}">`;
      html += `<div class="server-group-header-left">`;
      html += `<span class="server-group-chevron">${isCollapsed ? '\u25B6' : '\u25BC'}</span>`;
      html += `<span class="server-group-name">${esc(name)}</span>`;
      if (isOnline && state.mode) {
        html += `<span class="server-group-mode-icon" title="${state.mode === 'local' ? 'Local network (LAN)' : 'Internet'}">${state.mode === 'local' ? LOCAL_SVG : TUNNEL_SVG}</span>`;
      }

      if (isUpdating) {
        html += `<span class="server-updating-label">updating\u2026</span>`;
      } else if (isOnline) {
        html += `<span class="server-group-count">${sessions.length} session${sessions.length !== 1 ? 's' : ''}</span>`;
      } else {
        html += `<span class="server-offline-label">offline</span>`;
      }

      html += `</div>`;
      html += `<div class="server-group-right">`;

      if (isOnline) {
        html += `<button class="server-reconnect-btn" data-action="server-files" data-server="${esc(name)}" title="File Browser">${FILES_SVG}</button>`;
      }
      if (!isOnline) {
        html += `<button class="server-reconnect-btn" data-action="reconnect-server" data-server="${esc(name)}" title="Reconnect">${RECONNECT_SVG}</button>`;
      }

      html += `</div></div>`;

      if (!isCollapsed && isOnline && sessions.length > 0) {
        const sorted = [...sessions].sort((a, b) => {
          switch (sortMode) {
            case 'recent': return b.created - a.created;
            case 'oldest': return a.created - b.created;
            case 'active': return (b.lastActivity || 0) - (a.lastActivity || 0);
            case 'idle': return (a.lastActivity || 0) - (b.lastActivity || 0);
            default: return 0;
          }
        });
        html += `<div class="server-group-sessions">`;
        html += sorted.map(s => renderSessionCard(s)).join('');
        html += `</div>`;
      }

      html += `</div>`;
    }

    if (totalSessions === 0 && serverNames.every(n => states[n] && states[n].online)) {
      html += '<div class="empty-state"><h3>No sessions found</h3><p>Create a new tmux session on any server to get started.</p></div>';
    }

    list.innerHTML = html;
    DashboardBulkKill.updateButton();
  }

  // ---------- Session CRUD ----------

  async function handleCreate(e) {
    e.preventDefault();
    const nameInput = document.getElementById('new-session-name');
    const cmdInput = document.getElementById('new-session-cmd');
    const name = nameInput.value.trim(), command = cmdInput.value.trim() || 'bash';
    if (!name) { nameInput.focus(); return; }
    try {
      const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, command }) });
      if (!res.ok) { const err = await res.json(); await App.showModal(err.error || 'Failed to create session', 'OK'); return; }
      nameInput.value = ''; cmdInput.value = '';
      await refresh();
    } catch (err) { await App.showModal('Failed to create session: ' + err.message, 'OK'); }
  }

  function connectTo(sessionName, serverName) {
    if (serverName) {
      App.navigate('terminal', { session: sessionName, server: serverName });
    } else {
      App.navigate('terminal', { session: sessionName });
    }
  }

  async function openOnPC(sessionName, btn) {
    try {
      btn.disabled = true; btn.style.opacity = '0.5';
      await fetch(`/api/sessions/${encodeURIComponent(sessionName)}/open-terminal`, { method: 'POST' });
      setTimeout(() => { btn.disabled = false; btn.style.opacity = ''; }, 2000);
    } catch { setTimeout(() => { btn.disabled = false; btn.style.opacity = ''; }, 2000); }
  }

  async function kill(sessionName, serverName) {
    const sessions = ServerManager.isMultiServer()
      ? Object.values(ServerManager.getServerStates()).flatMap(s => s.sessions)
      : (lastSessions || []);
    const s = sessions.find(x => x.name === sessionName && (!serverName || x._server === serverName));
    if (s && s.locked) return;
    const label = serverName ? `${serverName}:${sessionName}` : sessionName;
    const confirmed = await App.showModal(`Kill session "${label}"? This will terminate all processes in it.`, 'Kill');
    if (!confirmed) return;
    try {
      const origin = serverName ? ServerManager.getOrigin(serverName) : '';
      await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionName)}`, { method: 'DELETE' });
      await refresh();
    } catch (err) { await App.showModal('Failed to kill session: ' + err.message, 'OK'); }
  }

  async function toggleLock(name) {
    try { const res = await fetch(`/api/sessions/${encodeURIComponent(name)}/lock`, { method: 'POST' }); if (res.ok) await refresh(); } catch {}
  }

  return { init, refresh };
})();
