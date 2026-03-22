/**
 * app.js — SPA router, modal, toast, version polling.
 * Network probing is in app-network.js (AppNetwork).
 */

/* global Dashboard, TerminalView, AppNetwork */

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

    views.dashboard().classList.add('hidden');
    views.terminal().classList.add('hidden');

    const backBtn = document.getElementById('back-btn');

    if (view === 'terminal' && parts[1]) {
      const sessionName = decodeURIComponent(parts[1]);
      currentView = 'terminal';
      currentSession = sessionName;
      views.terminal().classList.remove('hidden');
      backBtn.style.display = 'inline-flex';
      document.getElementById('terminal-session-name').textContent = sessionName;
      TerminalView.connect(sessionName);
      fetch(`/api/sessions/${encodeURIComponent(sessionName)}`).then(r => r.json()).then(d => {
        if (d.displayTitle) document.getElementById('terminal-session-name').textContent = d.displayTitle;
      }).catch(() => {});
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

  // ---------- Version polling ----------

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

  // ---------- High Contrast ----------

  function initContrastToggle() {
    const saved = localStorage.getItem('tui_high_contrast');
    if (saved === '1') document.documentElement.classList.add('high-contrast');
    document.getElementById('contrast-btn').addEventListener('click', () => {
      const on = document.documentElement.classList.toggle('high-contrast');
      localStorage.setItem('tui_high_contrast', on ? '1' : '0');
    });
  }

  // ---------- Online / Offline ----------

  function initConnectivityToasts() {
    window.addEventListener('offline', () => showToast('You are offline', 'warning'));
    window.addEventListener('online', () => showToast('Back online', 'success', 3000));
  }

  // ---------- Modal ----------

  function getModalElements() {
    return {
      overlay: document.getElementById('modal-overlay'),
      msg: document.getElementById('modal-message'),
      confirmBtn: document.getElementById('modal-confirm'),
      cancelBtn: document.getElementById('modal-cancel'),
    };
  }

  function showModal(message, confirmLabel = 'Confirm') {
    return new Promise((resolve) => {
      const { overlay, msg, confirmBtn, cancelBtn } = getModalElements();
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
    document.getElementById('back-btn').addEventListener('click', () => navigate('dashboard'));

    Dashboard.init();
    TerminalView.init();
    TerminalNotes.initNotesOverlay();
    handleRoute();
    startVersionPolling();
    initConnectivityToasts();
    initContrastToggle();

    AppNetwork.startLocalProbing({
      showToast,
      get currentSession() { return currentSession; },
      get currentView() { return currentView; },
    });
  }

  return {
    init, navigate, showModal, showToast, getModalElements,
    getWsUrl: (...args) => AppNetwork.getWsUrl(...args),
    onNetworkChange: () => AppNetwork.onNetworkChange(),
    getCurrentSession: () => currentSession,
    getLocalOrigin: () => AppNetwork.getLocalOrigin(),
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
