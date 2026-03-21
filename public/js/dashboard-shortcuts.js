/**
 * dashboard-shortcuts.js — Quick Launch shortcuts dropdown and custom command popup.
 */

/* global App */

const DashboardShortcuts = (() => {
  let shortcutsData = [];
  let backdrop = null;
  let _deps = null;

  function init(deps) {
    _deps = deps;
    const btn = document.getElementById('shortcuts-btn');
    const menu = document.getElementById('shortcuts-menu');

    fetch('/shortcuts.json').then(r => r.ok ? r.json() : []).then(d => {
      shortcutsData = d;
      rebuildMenu();
    }).catch(() => {});

    backdrop = document.createElement('div');
    backdrop.className = 'shortcuts-backdrop hidden';
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);

    btn.addEventListener('click', () => {
      if (!menu.classList.contains('hidden')) { close(); return; }
      open(btn, menu);
    });

    backdrop.addEventListener('click', close);

    menu.addEventListener('click', (e) => {
      // Edit button clicked — don't close menu, open edit modal
      const editBtn = e.target.closest('.shortcut-edit-btn');
      if (editBtn) {
        e.stopPropagation();
        const idx = parseInt(editBtn.dataset.shortcutIdx, 10);
        close();
        if (shortcutsData[idx]) showEditShortcutPopup(idx);
        return;
      }
      const item = e.target.closest('.shortcut-item');
      if (!item) return;
      close();
      if (item.dataset.action === 'custom') { showCustomCommandPopup(); return; }
      const idx = parseInt(item.dataset.shortcutIdx, 10);
      if (shortcutsData[idx]) prefill(shortcutsData[idx]);
    });
  }

  function open(btn, menu) {
    if (window.innerWidth > 768) {
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.left = '';
      menu.style.bottom = '';
    }
    backdrop.classList.remove('hidden');
    menu.classList.remove('hidden');
  }

  function close() {
    const menu = document.getElementById('shortcuts-menu');
    if (menu) menu.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
  }

  function rebuildMenu() {
    const menu = document.getElementById('shortcuts-menu');
    const esc = _deps.esc;
    let html = shortcutsData.map((s, i) => `
      <div class="shortcut-item" data-shortcut-idx="${i}">
        <div class="shortcut-item-row">
          <span class="shortcut-label">${esc(s.label)}</span>
          <button class="shortcut-edit-btn" data-shortcut-idx="${i}" title="Edit shortcut">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L3.463 11.1a.25.25 0 00-.064.108l-.563 1.97 1.971-.564a.25.25 0 00.108-.064l8.61-8.61a.25.25 0 000-.353L12.427 2.488z"/></svg>
          </button>
        </div>
        <span class="shortcut-cmd">${esc(s.command)}</span>
      </div>`).join('');
    html += `<div class="shortcut-item shortcut-custom" data-action="custom">
      <span class="shortcut-label">+ Custom command</span>
      <span class="shortcut-cmd">Launch a session with any command</span>
    </div>`;
    menu.innerHTML = html;
  }

  function showCustomCommandPopup() {
    const { overlay, msg, confirmBtn, cancelBtn } = App.getModalElements();

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
      try {
        const res = await fetch('/api/shortcuts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, command: cmd }),
        });
        if (res.ok) {
          const data = await res.json();
          shortcutsData = data.shortcuts;
          rebuildMenu();
        }
      } catch { /* save failed, still prefill */ }
      prefill({ label, command: cmd });
    }

    function onCancel() { cleanup(); }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  }

  function showEditShortcutPopup(idx) {
    const shortcut = shortcutsData[idx];
    if (!shortcut) return;
    const { overlay, msg, confirmBtn, cancelBtn } = App.getModalElements();

    msg.innerHTML = `
      <div style="margin-bottom:12px;font-family:var(--mono);font-size:13px;font-weight:600;color:var(--accent)">Edit Shortcut</div>
      <input id="edit-label" type="text" value="${shortcut.label.replace(/"/g, '&quot;')}" placeholder="Title" autocomplete="off" style="width:100%;padding:8px 10px;margin-bottom:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--mono);font-size:12px;outline:none;">
      <input id="edit-cmd" type="text" value="${shortcut.command.replace(/"/g, '&quot;')}" placeholder="Command" autocomplete="off" style="width:100%;padding:8px 10px;margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--mono);font-size:12px;outline:none;">
      <button id="edit-delete-btn" style="width:100%;padding:8px 10px;background:transparent;border:1px solid var(--danger, #e55);border-radius:6px;color:var(--danger, #e55);font-family:var(--mono);font-size:12px;cursor:pointer;transition:background 0.15s;">Delete shortcut</button>`;

    overlay.classList.remove('hidden');
    setTimeout(() => document.getElementById('edit-label').focus(), 50);

    function cleanup() {
      overlay.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      const del = document.getElementById('edit-delete-btn');
      if (del) del.removeEventListener('click', onDelete);
    }

    async function onConfirm() {
      const label = document.getElementById('edit-label').value.trim();
      const cmd = document.getElementById('edit-cmd').value.trim();
      cleanup();
      if (!label || !cmd) return;
      try {
        const res = await fetch(`/api/shortcuts/${idx}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, command: cmd }),
        });
        if (res.ok) {
          const data = await res.json();
          shortcutsData = data.shortcuts;
          rebuildMenu();
        }
      } catch { /* save failed */ }
    }

    async function onDelete() {
      cleanup();
      try {
        const res = await fetch(`/api/shortcuts/${idx}`, { method: 'DELETE' });
        if (res.ok) {
          const data = await res.json();
          shortcutsData = data.shortcuts;
          rebuildMenu();
        }
      } catch { /* delete failed */ }
    }

    function onCancel() { cleanup(); }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    document.getElementById('edit-delete-btn').addEventListener('click', onDelete);
  }

  function prefill(shortcut) {
    const base = shortcut.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const name = base + '-' + Date.now().toString(36).slice(-4);
    document.getElementById('new-session-name').value = name;
    document.getElementById('new-session-cmd').value = shortcut.command;
    document.getElementById('new-session-cmd').focus();
  }

  return { init };
})();
