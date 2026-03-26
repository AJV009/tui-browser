/**
 * settings-panel.js — Server settings overlay for adding/editing/removing servers.
 */

/* global ServerManager, App */

const SettingsPanel = (() => {
  let editingServers = [];

  const SYNC_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.3-4"/><path d="M13.5 8a5.5 5.5 0 0 1-9.3 4"/><path d="M11.5 1.5v3h3"/><path d="M4.5 14.5v-3h-3"/></svg>';

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
      ? servers.map(s => ({ name: s.name || '', url: s.url || '', _localIPs: null }))
      : [{ name: '', url: '', _localIPs: null }];
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
      let localHtml = '';
      if (s._localIPs && s._localIPs.length > 0) {
        localHtml = `<div class="settings-local-ips">${esc(s._localIPs.join(', '))}</div>`;
      }
      return `
      <div class="settings-server-entry" data-index="${i}">
        <label>Name</label>
        <input type="text" data-field="name" value="${esc(s.name)}" placeholder="e.g. desktop">
        <label>URL</label>
        <div class="settings-url-row">
          <input type="text" data-field="url" value="${esc(s.url || '')}" placeholder="https://example.trycloudflare.com or 192.168.1.10:7484">
          <button class="settings-sync-btn" data-action="sync-ips" data-index="${i}" title="Fetch local IPs">${SYNC_SVG}</button>
        </div>
        ${localHtml}
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

    list.querySelectorAll('[data-action="sync-ips"]').forEach(btn => {
      btn.addEventListener('click', () => syncIPs(parseInt(btn.dataset.index), btn));
    });
  }

  async function syncIPs(idx, btn) {
    const url = editingServers[idx].url;
    if (!url || !url.trim()) { App.showToast('Enter a URL first', 'warning', 2000); return; }
    btn.classList.add('syncing');
    btn.disabled = true;
    try {
      const result = await ServerManager.fetchLocalIPs(url.trim());
      if (result && result.ips.length > 0) {
        editingServers[idx]._localIPs = result.ips.map(ip => `${ip}:${result.httpsPort}`);
        App.showToast(`Found ${result.ips.length} local IP${result.ips.length > 1 ? 's' : ''}`, 'success', 2000);
      } else {
        editingServers[idx]._localIPs = null;
        App.showToast('No local IPs found — server may not have HTTPS enabled', 'warning', 3000);
      }
      renderEntries();
    } catch {
      App.showToast('Could not reach server', 'error', 3000);
    }
  }

  function addEntry() {
    editingServers.push({ name: '', url: '', _localIPs: null });
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
