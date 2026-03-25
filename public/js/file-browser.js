/**
 * file-browser.js — File browser overlay with directory listing,
 * breadcrumb navigation, context menu, selection mode, and directory picker.
 */

/* global App, FileEditor, FileUpload, getIconForFile, getIconForFolder */

const FileBrowser = (() => {
  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  let _currentPath = '';
  let _history = [];
  let _selectionMode = false;
  let _selected = new Set();
  let _entries = [];
  let _sortBy = 'name';
  let _showHidden = false;
  let _contextTarget = null;
  let _originView = 'dashboard'; // 'dashboard' or 'terminal'

  // DOM references (set in init)
  let $overlay, $breadcrumb, $fileList, $selectionBar, $contextMenu, $contextBackdrop;

  function init() {
    $overlay = document.getElementById('file-browser-overlay');
    $breadcrumb = document.getElementById('fb-breadcrumb');
    $fileList = document.getElementById('fb-file-list');
    $selectionBar = document.getElementById('fb-selection-bar');
    $contextMenu = document.getElementById('fb-context-menu');
    $contextBackdrop = document.getElementById('fb-context-backdrop');

    // Back button
    document.getElementById('fb-back-btn').addEventListener('click', close);
    // Action pills
    document.getElementById('fb-upload-btn').addEventListener('click', () => {
      if (typeof FileUpload !== 'undefined') FileUpload.open(_currentPath, () => refresh());
    });
    document.getElementById('fb-mkdir-btn').addEventListener('click', promptMkdir);
    document.getElementById('fb-sort-btn').addEventListener('click', cycleSort);
    document.getElementById('fb-hidden-btn').addEventListener('click', toggleHidden);
    // Selection bar actions
    $selectionBar.addEventListener('click', handleSelectionAction);
    // Context menu backdrop
    $contextBackdrop.addEventListener('click', hideContextMenu);
    // File list delegation
    $fileList.addEventListener('click', handleFileClick);
    // Long-press for context menu
    setupLongPress();

    // DirPicker buttons (wired here, not in DOMContentLoaded — IIFE runs after DOM ready)
    const dpCloseBtn = document.getElementById('dp-close-btn');
    if (dpCloseBtn) dpCloseBtn.addEventListener('click', () => DirPicker.close());
    const dpConfirmBtn = document.getElementById('dp-confirm-btn');
    if (dpConfirmBtn) dpConfirmBtn.addEventListener('click', () => DirPicker.confirm());
    const dpMkdirBtn = document.getElementById('dp-mkdir-btn');
    if (dpMkdirBtn) dpMkdirBtn.addEventListener('click', () => DirPicker.mkdir());
  }

  async function open(initialPath) {
    _originView = window.location.hash.includes('terminal') ? 'terminal' : 'dashboard';
    const targetPath = initialPath || await getDefaultPath();
    _currentPath = targetPath;
    _history = [];
    _selectionMode = false;
    _selected.clear();
    $overlay.classList.remove('hidden');
    App.pushOverlay('file-browser', close);
    await refresh();
  }

  function close() {
    if ($overlay.classList.contains('hidden')) return;
    $overlay.classList.add('hidden');
    App.popOverlay('file-browser');
    exitSelectionMode();
    hideContextMenu();
  }

  // ---------- API Helper ----------

  async function api(endpoint, body = {}) {
    const res = await fetch(`/api/files/${endpoint}`, {
      method: endpoint === 'cwd' ? 'GET' : 'POST',
      headers: endpoint === 'cwd' ? {} : { 'Content-Type': 'application/json' },
      body: endpoint === 'cwd' ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  // ---------- Default Path ----------

  async function getDefaultPath() {
    if (_originView === 'terminal') {
      const hash = window.location.hash;
      const sessionName = hash.split('/').slice(1).join('/');
      if (sessionName) {
        try {
          const res = await fetch(`/api/files/cwd?session=${encodeURIComponent(sessionName)}`);
          const data = await res.json();
          if (data.path) return data.path;
        } catch {}
      }
    }
    // Fallback: home directory
    try {
      const cwdRes = await fetch('/api/files/cwd?session=_');
      const data = await cwdRes.json();
      return data.path; // Falls back to $HOME on server
    } catch {
      return '/home';
    }
  }

  // ---------- Breadcrumb ----------

  function renderBreadcrumb() {
    const home = _currentPath.match(/^\/home\/[^/]+/)?.[0] || '';
    let display = _currentPath;
    if (home && _currentPath.startsWith(home)) {
      display = '~' + _currentPath.slice(home.length);
    }
    const parts = display.split('/').filter(Boolean);
    $breadcrumb.innerHTML = parts.map((part, i) => {
      const fullPath = display.startsWith('~')
        ? home + '/' + parts.slice(1, i + 1).join('/')
        : '/' + parts.slice(0, i + 1).join('/');
      const isLast = i === parts.length - 1;
      return `<span class="fb-crumb${isLast ? ' fb-crumb-current' : ''}" data-path="${fullPath}">${part}</span>`;
    }).join('<span class="fb-crumb-sep">/</span>');
    $breadcrumb.scrollLeft = $breadcrumb.scrollWidth;
    // Click on breadcrumb segments
    $breadcrumb.querySelectorAll('.fb-crumb:not(.fb-crumb-current)').forEach(el => {
      el.addEventListener('click', () => navigateTo(el.dataset.path));
    });
  }

  // ---------- Navigation ----------

  async function navigateTo(dirPath) {
    _history.push(_currentPath);
    _currentPath = dirPath;
    exitSelectionMode();
    await refresh();
  }

  async function refresh() {
    try {
      _entries = await api('list', { path: _currentPath, showHidden: _showHidden });
      renderBreadcrumb();
      renderFileList();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }

  // ---------- File List Rendering ----------

  function getIconUrl(entry) {
    if (typeof getIconForFile === 'undefined' && typeof getIconForFolder === 'undefined') {
      // vscode-icons-js not loaded — fallback
      return entry.type === 'directory' ? '/icons/default_folder.svg' : '/icons/default_file.svg';
    }
    try {
      const iconName = entry.type === 'directory'
        ? (window.getIconForFolder ? getIconForFolder(entry.name) : 'default_folder.svg')
        : (window.getIconForFile ? getIconForFile(entry.name) : 'default_file.svg');
      return `/icons/${iconName}`;
    } catch {
      return entry.type === 'directory' ? '/icons/default_folder.svg' : '/icons/default_file.svg';
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }

  function renderFileList() {
    // Sort entries
    const sorted = [..._entries];
    if (_sortBy === 'date') sorted.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    else if (_sortBy === 'size') sorted.sort((a, b) => b.size - a.size);
    // Folders first is already handled by server, re-apply after sort
    sorted.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return 0;
    });

    $fileList.innerHTML = sorted.map(entry => {
      const iconUrl = getIconUrl(entry);
      const meta = entry.type === 'directory'
        ? `${formatDate(entry.modified)}`
        : `${formatSize(entry.size)} \u00b7 ${formatDate(entry.modified)}`;
      const isSelected = _selected.has(entry.name);
      return `
        <div class="fb-file-row${isSelected ? ' selected' : ''}" data-name="${esc(entry.name)}" data-type="${entry.type}">
          ${_selectionMode ? `<div class="fb-checkbox${isSelected ? ' checked' : ''}">
            ${isSelected ? '\u2713' : ''}</div>` : ''}
          <img class="fb-file-icon" src="${iconUrl}" alt="" width="24" height="24">
          <div class="fb-file-info">
            <div class="fb-file-name">${esc(entry.name)}</div>
            <div class="fb-file-meta">${meta}</div>
          </div>
          <span class="fb-file-trail">${entry.type === 'directory' ? '\u203a' : '\u22ee'}</span>
        </div>`;
    }).join('');

    // Update sort button text
    document.getElementById('fb-sort-btn').textContent =
      _sortBy === 'name' ? 'Sort \u2195' : _sortBy === 'date' ? 'Date \u2195' : 'Size \u2195';
  }

  // ---------- File Click Handling ----------

  function handleFileClick(e) {
    const row = e.target.closest('.fb-file-row');
    if (!row) return;
    const name = row.dataset.name;
    const type = row.dataset.type;

    if (_selectionMode) {
      toggleSelection(name);
      return;
    }

    const fullPath = _currentPath + '/' + name;
    if (type === 'directory') {
      navigateTo(fullPath);
    } else {
      if (typeof FileEditor !== 'undefined') FileEditor.open(fullPath);
    }
  }

  // ---------- Long-press / Context Menu ----------

  function setupLongPress() {
    let timer = null;
    let startX, startY;
    $fileList.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.fb-file-row');
      if (!row) return;
      startX = e.clientX;
      startY = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        showContextMenu(row, e);
      }, 500);
    });
    $fileList.addEventListener('pointermove', (e) => {
      if (timer && (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10)) {
        clearTimeout(timer);
        timer = null;
      }
    });
    $fileList.addEventListener('pointerup', () => { if (timer) clearTimeout(timer); timer = null; });
    $fileList.addEventListener('pointercancel', () => { if (timer) clearTimeout(timer); timer = null; });
  }

  function showContextMenu(row, e) {
    e.preventDefault();
    const name = row.dataset.name;
    const type = row.dataset.type;
    _contextTarget = { name, type, path: _currentPath + '/' + name };
    row.classList.add('context-active');

    const actions = [
      { label: 'Select', icon: '\u2610', action: 'select' },
      { label: 'Rename', icon: '\u270f\ufe0f', action: 'rename' },
      { label: 'Copy', icon: '\ud83d\udccb', action: 'copy' },
      { label: 'Move', icon: '\ud83d\udce6', action: 'move' },
      { label: 'Download', icon: '\u2193', action: 'download' },
      { label: 'Info', icon: '\u2139\ufe0f', action: 'info' },
      { label: 'Delete', icon: '\ud83d\uddd1', action: 'delete', danger: true },
    ];

    $contextMenu.innerHTML = actions.map(a =>
      `<div class="fb-ctx-item${a.danger ? ' fb-ctx-danger' : ''}" data-action="${a.action}">
        <span class="fb-ctx-icon">${a.icon}</span>
        <span>${a.label}</span>
      </div>`
    ).join('');

    // Position near the row
    const rect = row.getBoundingClientRect();
    $contextMenu.style.top = Math.min(rect.bottom, window.innerHeight - 350) + 'px';
    $contextMenu.style.left = '12px';
    $contextMenu.style.right = '12px';
    $contextMenu.classList.remove('hidden');
    $contextBackdrop.classList.remove('hidden');

    // Context menu click handler
    $contextMenu.onclick = (ev) => {
      const item = ev.target.closest('.fb-ctx-item');
      if (!item) return;
      handleContextAction(item.dataset.action);
    };
  }

  function hideContextMenu() {
    if (!$contextMenu) return;
    $contextMenu.classList.add('hidden');
    $contextBackdrop.classList.add('hidden');
    document.querySelectorAll('.fb-file-row.context-active').forEach(r => r.classList.remove('context-active'));
    _contextTarget = null;
  }

  async function handleContextAction(action) {
    const target = _contextTarget;
    hideContextMenu();
    if (!target) return;

    switch (action) {
      case 'select':
        enterSelectionMode(target.name);
        break;
      case 'rename':
        promptRename(target);
        break;
      case 'copy':
        DirPicker.open('Copy to...', 'Copy Here', async (destDir) => {
          const dest = destDir + '/' + target.name;
          try {
            await api('copy', { src: target.path, dest });
            App.showToast('Copied', 'success', 2000);
            await refresh();
          } catch (err) {
            if (err.message === 'exists') {
              if (confirm(`"${target.name}" already exists. Replace?`)) {
                await api('copy', { src: target.path, dest, overwrite: true });
                App.showToast('Copied (replaced)', 'success', 2000);
                await refresh();
              }
            } else { App.showToast(err.message, 'error'); }
          }
        });
        break;
      case 'move':
        DirPicker.open('Move to...', 'Move Here', async (destDir) => {
          const dest = destDir + '/' + target.name;
          try {
            await api('move', { src: target.path, dest });
            App.showToast('Moved', 'success', 2000);
            await refresh();
          } catch (err) {
            if (err.message === 'exists') {
              if (confirm(`"${target.name}" already exists. Replace?`)) {
                await api('move', { src: target.path, dest, overwrite: true });
                App.showToast('Moved (replaced)', 'success', 2000);
                await refresh();
              }
            } else { App.showToast(err.message, 'error'); }
          }
        });
        break;
      case 'download':
        downloadFile(target.path);
        break;
      case 'info':
        showFileInfo(target);
        break;
      case 'delete':
        if (confirm(`Delete "${target.name}"?`)) {
          try {
            await api('delete', { path: target.path });
            App.showToast('Deleted', 'success', 2000);
            await refresh();
          } catch (err) { App.showToast(err.message, 'error'); }
        }
        break;
    }
  }

  // ---------- Selection Mode ----------

  function enterSelectionMode(initialName) {
    _selectionMode = true;
    _selected.clear();
    if (initialName) _selected.add(initialName);
    renderFileList();
    updateSelectionBar();
    $selectionBar.classList.remove('hidden');
  }

  function exitSelectionMode() {
    _selectionMode = false;
    _selected.clear();
    if ($selectionBar) $selectionBar.classList.add('hidden');
    if (_entries.length > 0) renderFileList();
  }

  function toggleSelection(name) {
    if (_selected.has(name)) _selected.delete(name);
    else _selected.add(name);
    renderFileList();
    updateSelectionBar();
  }

  function updateSelectionBar() {
    // Update selection count in topbar could go here
  }

  async function handleSelectionAction(e) {
    const btn = e.target.closest('.fb-sel-action');
    if (!btn) return;
    const action = btn.dataset.action;
    const paths = [..._selected].map(name => _currentPath + '/' + name);

    switch (action) {
      case 'delete':
        if (!confirm(`Delete ${_selected.size} items?`)) return;
        for (const p of paths) {
          try { await api('delete', { path: p }); } catch {}
        }
        App.showToast(`Deleted ${_selected.size} items`, 'success', 2000);
        exitSelectionMode();
        await refresh();
        break;
      case 'download':
        // For multiple files, download each (or could zip — future enhancement)
        for (const p of paths) downloadFile(p);
        break;
      case 'copy':
      case 'move':
        DirPicker.open(
          action === 'copy' ? 'Copy to...' : 'Move to...',
          action === 'copy' ? 'Copy Here' : 'Move Here',
          async (destDir) => {
            for (const p of paths) {
              const name = p.split('/').pop();
              const dest = destDir + '/' + name;
              try {
                await api(action, { src: p, dest });
              } catch (err) {
                if (err.message === 'exists') {
                  if (confirm(`"${name}" exists. Replace?`)) {
                    await api(action, { src: p, dest, overwrite: true });
                  }
                }
              }
            }
            App.showToast(`${action === 'copy' ? 'Copied' : 'Moved'} ${_selected.size} items`, 'success', 2000);
            exitSelectionMode();
            await refresh();
          }
        );
        break;
    }
  }

  // ---------- Utility Functions ----------

  async function promptMkdir() {
    const name = prompt('New folder name:');
    if (!name) return;
    try {
      await api('mkdir', { path: _currentPath + '/' + name });
      App.showToast('Folder created', 'success', 2000);
      await refresh();
    } catch (err) { App.showToast(err.message, 'error'); }
  }

  async function promptRename(target) {
    const newName = prompt('Rename to:', target.name);
    if (!newName || newName === target.name) return;
    try {
      await api('rename', {
        oldPath: target.path,
        newPath: _currentPath + '/' + newName,
      });
      App.showToast('Renamed', 'success', 2000);
      await refresh();
    } catch (err) {
      if (err.message.includes('exists')) App.showToast('A file with that name already exists', 'error');
      else App.showToast(err.message, 'error');
    }
  }

  function downloadFile(filePath) {
    const url = '/api/files/download?path=' + encodeURIComponent(filePath);
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function cycleSort() {
    const order = ['name', 'date', 'size'];
    _sortBy = order[(order.indexOf(_sortBy) + 1) % order.length];
    renderFileList();
  }

  function toggleHidden() {
    _showHidden = !_showHidden;
    document.getElementById('fb-hidden-btn').classList.toggle('fb-pill-active', _showHidden);
    refresh();
  }

  function showFileInfo(target) {
    const entry = _entries.find(e => e.name === target.name);
    if (!entry) return;
    const info = [
      `Name: ${entry.name}`,
      `Type: ${entry.type}`,
      `Size: ${formatSize(entry.size)}`,
      `Modified: ${new Date(entry.modified).toLocaleString()}`,
      `Permissions: ${entry.permissions}`,
      `Path: ${target.path}`,
    ].join('\n');
    alert(info);
  }

  // ---------- Directory Picker (for copy/move destination) ----------

  const DirPicker = (() => {
    let _dpPath = '';
    let _dpCallback = null;

    function open(title, confirmLabel, callback) {
      _dpPath = _currentPath;
      _dpCallback = callback;
      document.getElementById('dp-title').textContent = title;
      document.getElementById('dp-confirm-btn').textContent = confirmLabel;
      document.getElementById('dir-picker-overlay').classList.remove('hidden');
      App.pushOverlay('dir-picker', close);
      renderDirList();
    }

    function close() {
      if (document.getElementById('dir-picker-overlay').classList.contains('hidden')) return;
      document.getElementById('dir-picker-overlay').classList.add('hidden');
      App.popOverlay('dir-picker');
      _dpCallback = null;
    }

    function confirm() {
      if (_dpCallback) _dpCallback(_dpPath);
      close();
    }

    async function mkdir() {
      const name = prompt('New folder name:');
      if (!name) return;
      try {
        await api('mkdir', { path: _dpPath + '/' + name });
        renderDirList();
      } catch (err) { App.showToast(err.message, 'error'); }
    }

    async function renderDirList() {
      try {
        const entries = await api('list', { path: _dpPath });
        const dirs = entries.filter(e => e.type === 'directory');
        const $list = document.getElementById('dp-dir-list');
        $list.innerHTML = dirs.map(d => `
          <div class="fb-file-row" data-name="${esc(d.name)}" data-type="directory">
            <img class="fb-file-icon" src="${getIconUrl(d)}" width="24" height="24">
            <div class="fb-file-info"><div class="fb-file-name">${esc(d.name)}</div></div>
            <span class="fb-file-trail">\u203a</span>
          </div>
        `).join('') || '<div class="fb-empty">No folders</div>';

        // Breadcrumb
        const $bc = document.getElementById('dp-breadcrumb');
        const home = _dpPath.match(/^\/home\/[^/]+/)?.[0] || '';
        let display = _dpPath;
        if (home && _dpPath.startsWith(home)) display = '~' + _dpPath.slice(home.length);
        $bc.textContent = display || '/';

        // Click handlers
        $list.onclick = (e) => {
          const row = e.target.closest('.fb-file-row');
          if (row) {
            _dpPath = _dpPath + '/' + row.dataset.name;
            renderDirList();
          }
        };
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    }

    return { open, close, confirm, mkdir };
  })();

  // ---------- Public API ----------

  return { init, open, close, refresh, downloadFile };
})();
