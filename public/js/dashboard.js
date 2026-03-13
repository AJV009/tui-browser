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
    startAutoRefresh();
  }

  async function refresh() {
    try {
      const res = await fetch('/api/discover');
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      render(data.tmux || [], data.kitty || { available: false, windows: [] });
    } catch (err) {
      renderError(err.message);
    }
  }

  function render(sessions, kitty) {
    const list = document.getElementById('session-list');

    const hasSessions = sessions.length > 0;
    const hasKittyWindows = kitty.available && kitty.windows && kitty.windows.length > 0;

    if (!hasSessions && !hasKittyWindows) {
      list.innerHTML = `
        <div class="empty-state">
          <h3>No sessions found</h3>
          <p>Create a new tmux session to get started.</p>
        </div>`;
      return;
    }

    let html = '';

    // Kitty windows section
    if (hasKittyWindows) {
      html += `<div class="source-section">
        <div class="source-header">
          <span class="source-badge kitty-badge">Kitty</span>
          <span class="source-label">${kitty.windows.length} window${kitty.windows.length !== 1 ? 's' : ''} discovered</span>
        </div>
      </div>`;
      html += kitty.windows.map(renderKittyCard).join('');
    }

    // tmux sessions section
    if (hasSessions) {
      if (hasKittyWindows) {
        html += `<div class="source-section">
          <div class="source-header">
            <span class="source-badge tmux-badge">tmux</span>
            <span class="source-label">${sessions.length} session${sessions.length !== 1 ? 's' : ''}</span>
          </div>
        </div>`;
      }
      html += sessions.map(renderTmuxCard).join('');
    }

    list.innerHTML = html;
  }

  function renderTmuxCard(s) {
    const pane = s.panes && s.panes[0];
    const cmd = pane ? pane.command : 'unknown';
    const size = pane ? `${pane.width}x${pane.height}` : '';
    const created = new Date(s.created).toLocaleString();

    let statusClass = 'detached';
    let statusLabel = 'Detached';
    if (s.webClients > 0) {
      statusClass = 'web-connected';
      statusLabel = `${s.webClients} web client${s.webClients > 1 ? 's' : ''}`;
    } else if (s.attached) {
      statusClass = 'attached';
      statusLabel = 'Host attached';
    }

    return `
      <div class="session-card" data-session="${esc(s.name)}">
        <div class="session-card-header">
          <span class="session-name">${esc(s.name)}</span>
          <span class="session-status">
            <span class="status-dot ${statusClass}"></span>
            ${statusLabel}
          </span>
        </div>
        <div class="session-meta">
          <span>cmd: ${esc(cmd)}</span>
          <span>${s.windows} window${s.windows !== 1 ? 's' : ''}</span>
          ${size ? `<span>${size}</span>` : ''}
          <span>${created}</span>
        </div>
        <div class="session-actions">
          <button class="btn btn-primary" onclick="Dashboard.connectTo('${esc(s.name)}')">Connect</button>
          <button class="btn btn-danger" onclick="Dashboard.kill('${esc(s.name)}')">Kill</button>
        </div>
      </div>`;
  }

  function renderKittyCard(win) {
    const size = win.columns && win.lines ? `${win.columns}x${win.lines}` : '';
    const focusClass = win.isFocused ? 'attached' : 'detached';
    const focusLabel = win.isFocused ? 'Focused' : 'Background';

    // Show a preview snippet if available
    const previewHtml = win.preview
      ? `<div class="session-preview">${esc(win.preview.trim().split('\n').slice(-4).join('\n'))}</div>`
      : '';

    return `
      <div class="session-card kitty-card" data-kitty-id="${win.id}">
        <div class="session-card-header">
          <span class="session-name">
            <span class="source-icon kitty-icon">K</span>
            ${esc(win.title)}
          </span>
          <span class="session-status">
            <span class="status-dot ${focusClass}"></span>
            ${focusLabel}
          </span>
        </div>
        <div class="session-meta">
          ${win.cmdline ? `<span>cmd: ${esc(win.cmdline)}</span>` : ''}
          ${size ? `<span>${size}</span>` : ''}
          ${win.cwd ? `<span>cwd: ${esc(win.cwd)}</span>` : ''}
          <span>tab: ${esc(win.tabTitle)}</span>
        </div>
        ${previewHtml}
        <div class="session-actions">
          <button class="btn btn-primary" onclick="Dashboard.connectKittyToTmux(${win.id}, '${esc(win.title)}')">Connect via tmux</button>
        </div>
      </div>`;
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
        alert(err.error || 'Failed to create session');
        return;
      }
      nameInput.value = '';
      cmdInput.value = '';
      await refresh();
    } catch (err) {
      alert('Failed to create session: ' + err.message);
    }
  }

  function connectTo(sessionName) {
    App.navigate('terminal', { session: sessionName });
  }

  /**
   * Connect to a Kitty window by creating a tmux session that attaches
   * to the same working directory, then navigating to it.
   */
  async function connectKittyToTmux(kittyWindowId, title) {
    // Create a tmux session named after the kitty window
    const safeName = `kitty-${kittyWindowId}`;
    try {
      // Fetch Kitty window details to get cwd
      const res = await fetch('/api/kitty/windows');
      const data = await res.json();
      const win = (data.windows || []).find((w) => w.id === kittyWindowId);
      const cwd = win && win.cwd ? win.cwd : undefined;

      // Create tmux session in the same directory
      const createRes = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: safeName,
          command: cwd ? `cd ${cwd} && bash` : 'bash',
        }),
      });

      if (!createRes.ok) {
        // Session may already exist — try connecting directly
        const err = await createRes.json();
        if (!err.error.includes('duplicate')) {
          console.warn('Session create failed, trying direct connect:', err.error);
        }
      }

      App.navigate('terminal', { session: safeName });
    } catch (err) {
      alert('Failed to connect: ' + err.message);
    }
  }

  async function kill(sessionName) {
    if (!confirm(`Kill session "${sessionName}"? This will terminate all processes in it.`)) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(sessionName)}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      alert('Failed to kill session: ' + err.message);
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

  // HTML escape
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  return { init, refresh, connectTo, connectKittyToTmux, kill };
})();
