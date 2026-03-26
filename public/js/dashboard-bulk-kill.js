/**
 * dashboard-bulk-kill.js — Session selection, bulk kill modal, and filter logic.
 */

/* global App, ServerManager */

const DashboardBulkKill = (() => {
  let _deps = null;
  const SHELL_NAMES = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'nu', 'pwsh', 'login']);

  function init(deps) {
    _deps = deps;
    document.getElementById('bulk-kill-btn').addEventListener('click', handleBulkKill);
  }

  function toggleSelect(name) {
    const selected = _deps.selectedSessions;
    if (selected.has(name)) selected.delete(name);
    else selected.add(name);
    const card = document.querySelector(`.session-card[data-session="${CSS.escape(name)}"]`);
    if (card) {
      const circle = card.querySelector('.select-circle');
      if (circle) circle.classList.toggle('selected', selected.has(name));
      card.classList.toggle('session-selected', selected.has(name));
    }
    updateButton();
  }

  function updateButton() {
    const btn = document.getElementById('bulk-kill-btn');
    if (!btn) return;
    const count = _deps.selectedSessions.size;
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
    const selected = _deps.selectedSessions;
    if (selected.size > 0) {
      const sessions = _deps.getLastSessions();
      const lockedNames = new Set(sessions.filter(s => s.locked).map(s => s.name));
      const names = [...selected].filter(n => !lockedNames.has(n));
      if (names.length === 0) { await App.showModal('All selected sessions are locked.', 'OK'); return; }
      const confirmed = await App.showModal(
        `Kill ${names.length} selected session${names.length > 1 ? 's' : ''}? This will terminate all processes in them.${names.length < selected.size ? ' (locked sessions excluded)' : ''}`,
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
    const sessions = _deps.getLastSessions().filter(s => !s.locked);
    if (sessions.length === 0) { await App.showModal('No sessions to kill.', 'OK'); return; }

    const { overlay, msg, confirmBtn, cancelBtn } = App.getModalElements();
    const modal = overlay.querySelector('.modal');
    const dc = countForFilter(sessions, 'detached');
    const nc = countForFilter(sessions, 'no-commands');

    msg.innerHTML = `
      <div style="margin-bottom:12px;font-family:var(--mono);font-size:13px;font-weight:600;color:var(--danger)">Bulk Kill Sessions</div>
      <div class="bulk-kill-radios">
        <label class="bulk-radio"><input type="radio" name="bulk-filter" value="detached" checked>
          <span>Kill all detached sessions <span class="bulk-count">(${dc})</span></span></label>
        <label class="bulk-radio"><input type="radio" name="bulk-filter" value="no-commands">
          <span>Kill sessions with no running commands <span class="bulk-count">(${nc})</span></span></label>
        <label class="bulk-radio"><input type="radio" name="bulk-filter" value="inactive">
          <span>Kill sessions inactive since past
            <input id="inactive-minutes" type="number" value="10" min="1" max="9999"
                   style="width:50px;padding:2px 4px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--mono);font-size:12px;text-align:center;"
                   onclick="event.stopPropagation()"> min
            <span class="bulk-count" id="inactive-count">(${countInactive(sessions, 10)})</span></span></label>
        <label class="bulk-radio"><input type="radio" name="bulk-filter" value="all">
          <span>Kill all sessions <span class="bulk-count">(${sessions.length})</span></span></label>
      </div>
      <div class="bulk-kill-note">You have selected to kill <strong id="bulk-kill-target-count">${dc}</strong> session${dc !== 1 ? 's' : ''}</div>`;

    modal.style.maxWidth = '440px';
    overlay.classList.remove('hidden');

    const radios = msg.querySelectorAll('input[name="bulk-filter"]');
    const minutesInput = msg.querySelector('#inactive-minutes');

    function updateNote() {
      const filter = msg.querySelector('input[name="bulk-filter"]:checked').value;
      const minutes = parseInt(minutesInput.value, 10) || 10;
      const el = msg.querySelector('#inactive-count');
      if (el) el.textContent = `(${countInactive(sessions, minutes)})`;
      const t = msg.querySelector('#bulk-kill-target-count');
      if (t) t.textContent = countForFilter(sessions, filter, minutes);
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
        if (names.length === 0) { await App.showModal('No sessions match the selected filter.', 'OK'); return; }
        await executeBulkKill(names, filter, filter === 'inactive' ? minutes : undefined);
      }
      function onCancel() { cleanup(); }
      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  async function executeBulkKill(names, filter, inactiveMinutes) {
    try {
      // Get all sessions to find server mapping
      const allSessions = _deps.getLastSessions();
      const byServer = {};
      for (const name of names) {
        const session = allSessions.find(s => s.name === name);
        const server = session?._server || 'HOST';
        if (!byServer[server]) byServer[server] = [];
        byServer[server].push(name);
      }

      let totalKilled = [], totalFailed = [];
      for (const [server, serverNames] of Object.entries(byServer)) {
        const origin = server !== 'HOST' ? ServerManager.getOrigin(server) : '';
        const body = { names: serverNames };
        if (filter) body.filter = filter;
        if (inactiveMinutes !== undefined) body.inactiveMinutes = inactiveMinutes;
        const res = await fetch(`${origin}/api/sessions/bulk-kill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const result = await res.json();
          totalKilled.push(...result.killed);
          totalFailed.push(...result.failed);
        }
      }

      for (const name of totalKilled) _deps.selectedSessions.delete(name);
      if (totalFailed.length > 0) {
        await App.showModal(`Killed ${totalKilled.length}. Failed: ${totalFailed.map(f => f.name).join(', ')}`, 'OK');
      }
      await _deps.refresh();
    } catch (err) {
      await App.showModal('Bulk kill failed: ' + err.message, 'OK');
    }
  }

  return { init, toggleSelect, updateButton };
})();
