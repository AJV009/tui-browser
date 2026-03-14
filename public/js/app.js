/**
 * app.js — SPA router and state management.
 * Hash-based routing: #dashboard | #terminal/<sessionName>
 */

/* global Dashboard, TerminalView */

const App = (() => {
  let currentView = 'dashboard';
  let currentSession = null;

  const views = {
    dashboard: () => document.getElementById('dashboard-view'),
    terminal: () => document.getElementById('terminal-view'),
  };

  function navigate(view, params = {}) {
    if (view === 'terminal' && params.session) {
      window.location.hash = `#terminal/${encodeURIComponent(params.session)}`;
    } else {
      window.location.hash = '#dashboard';
    }
  }

  function handleRoute() {
    const hash = window.location.hash.slice(1) || 'dashboard';
    const parts = hash.split('/');
    const view = parts[0];

    // Hide all views
    views.dashboard().classList.add('hidden');
    views.terminal().classList.add('hidden');

    // Show back button only in terminal view
    const backBtn = document.getElementById('back-btn');

    if (view === 'terminal' && parts[1]) {
      const sessionName = decodeURIComponent(parts[1]);
      currentView = 'terminal';
      currentSession = sessionName;
      views.terminal().classList.remove('hidden');
      backBtn.style.display = 'inline-flex';
      document.getElementById('terminal-session-name').textContent = sessionName;
      TerminalView.connect(sessionName);
    } else {
      currentView = 'dashboard';
      currentSession = null;
      views.dashboard().classList.remove('hidden');
      backBtn.style.display = 'none';
      TerminalView.disconnect();
      Dashboard.refresh();
    }
  }

  // ---------- Toast ----------

  let toastTimer = null;

  function showToast(message, type, duration) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `toast toast-${type} visible`;
    if (duration) {
      toastTimer = setTimeout(() => { toast.classList.remove('visible'); }, duration);
    }
  }

  function formatTimestamp(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // ---------- Version polling + auto-update ----------

  let knownVersion = null;

  function startVersionPolling() {
    fetch('/api/version').then(r => r.json()).then(d => {
      knownVersion = d.version;
      const label = document.getElementById('version-label');
      if (label) label.textContent = `v${d.version}`;
      if (d.startedAt) {
        const el = document.getElementById('updated-label');
        if (el) el.textContent = `last updated: ${formatTimestamp(d.startedAt)}`;
      }
    }).catch(() => {});

    setInterval(() => {
      fetch('/api/version').then(r => r.json()).then(d => {
        if (knownVersion && d.version !== knownVersion) {
          knownVersion = d.version;
          showToast('Update available \u2014 reloading\u2026', 'success');
          setTimeout(() => window.location.reload(), 1500);
        }
      }).catch(() => {});
    }, 30000);
  }

  // ---------- Online / Offline ----------

  function initConnectivityToasts() {
    window.addEventListener('offline', () => {
      showToast('You are offline', 'warning');
    });
    window.addEventListener('online', () => {
      showToast('Back online', 'success', 3000);
    });
  }

  // ---------- Modal ----------

  function showModal(message, confirmLabel = 'Confirm') {
    return new Promise((resolve) => {
      const overlay = document.getElementById('modal-overlay');
      const msg = document.getElementById('modal-message');
      const confirmBtn = document.getElementById('modal-confirm');
      const cancelBtn = document.getElementById('modal-cancel');
      msg.textContent = message;
      confirmBtn.title = confirmLabel;
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

  // ---------- Init ----------

  function init() {
    window.addEventListener('hashchange', handleRoute);

    document.getElementById('back-btn').addEventListener('click', () => {
      navigate('dashboard');
    });

    // Initialize sub-modules
    Dashboard.init();
    TerminalView.init();

    // Route to initial view
    handleRoute();

    // Start polling for server updates
    startVersionPolling();

    // Online/offline detection
    initConnectivityToasts();
  }

  return { init, navigate, showModal, getCurrentSession: () => currentSession };
})();

document.addEventListener('DOMContentLoaded', App.init);
