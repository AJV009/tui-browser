/**
 * settings-panel.js — Server settings overlay for adding/editing/removing servers.
 */

/* global ServerManager, App */

const SettingsPanel = (() => {
  let editingServers = [];

  function init() {
    document.getElementById('settings-btn').addEventListener('click', open);
    document.getElementById('settings-cancel').addEventListener('click', close);
    document.getElementById('settings-save').addEventListener('click', save);
    document.getElementById('settings-add-server').addEventListener('click', addEntry);

    document.getElementById('settings-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'settings-overlay') close();
    });
  }

  function open() {
    const servers = ServerManager.getServers();
    editingServers = servers.length > 0
      ? servers.map(s => ({ name: s.name || '', url: s.url || '' }))
      : [{ name: '', url: '' }];
    renderEntries();
    document.getElementById('settings-overlay').classList.remove('hidden');
    App.pushOverlay('settings', close);
  }

  function close() {
    document.getElementById('settings-overlay').classList.add('hidden');
    App.popOverlay('settings');
  }

  function renderEntries() {
    const list = document.getElementById('settings-server-list');
    list.innerHTML = editingServers.map((s, i) => {
      return `
      <div class="settings-server-entry" data-index="${i}">
        <label>Name</label>
        <input type="text" data-field="name" value="${esc(s.name)}" placeholder="e.g. desktop">
        <label>URL</label>
        <input type="text" data-field="url" value="${esc(s.url || '')}" placeholder="http://100.x.x.x:7483 (Tailscale IP)">
        <button class="settings-server-remove" data-action="remove-server" data-index="${i}">Remove</button>
      </div>`;
    }).join('');

    list.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', (e) => {
        const entry = e.target.closest('.settings-server-entry');
        const idx = parseInt(entry.dataset.index);
        const field = e.target.dataset.field;
        editingServers[idx][field] = e.target.value;
      });
    });

    list.querySelectorAll('[data-action="remove-server"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        editingServers.splice(idx, 1);
        renderEntries();
      });
    });
  }

  function addEntry() {
    editingServers.push({ name: '', url: '' });
    renderEntries();
    const entries = document.querySelectorAll('.settings-server-entry');
    const last = entries[entries.length - 1];
    if (last) last.querySelector('input').focus();
  }

  async function save() {
    const valid = editingServers.filter(s => s.name && s.name.trim());
    try {
      const res = await fetch('/api/servers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: valid.map(s => ({ name: s.name, url: s.url })) }),
      });
      if (!res.ok) {
        const err = await res.json();
        App.showToast(err.error || 'Failed to save', 'error', 3000);
        return;
      }
      App.showToast('Servers saved', 'success', 2000);
      close();
      await ServerManager.loadServers();
    } catch (err) {
      App.showToast('Failed to save: ' + err.message, 'error', 3000);
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  }

  return { init };
})();
