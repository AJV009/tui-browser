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
        <span class="shortcut-label">${esc(s.label)}</span>
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

  function prefill(shortcut) {
    const base = shortcut.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const name = base + '-' + Date.now().toString(36).slice(-4);
    document.getElementById('new-session-name').value = name;
    document.getElementById('new-session-cmd').value = shortcut.command;
    document.getElementById('new-session-cmd').focus();
  }

  return { init };
})();
