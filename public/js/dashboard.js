/**
 * dashboard.js — Session list UI with auto-refresh.
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
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(res.statusText);
      const sessions = await res.json();
      render(sessions);
    } catch (err) {
      renderError(err.message);
    }
  }

  function render(sessions) {
    const list = document.getElementById('session-list');

    if (sessions.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <h3>No sessions found</h3>
          <p>Create a new tmux session to get started.</p>
        </div>`;
      return;
    }

    list.innerHTML = sessions.map((s) => {
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
    }).join('');
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

  return { init, refresh, connectTo, kill };
})();
