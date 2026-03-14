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
      // Fetch display title if available
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

  // ---------- Local Network Fast Path ----------

  let localOrigin = null;  // e.g. 'https://192.168.0.131:7484'
  let certAccepted = false;
  let networkInfo = null; // cached /api/network response
  let probing = false;

  function getWsUrl(sessionName) {
    if (localOrigin) {
      return `wss://${localOrigin.replace(/^https?:\/\//, '')}/ws/terminal/${encodeURIComponent(sessionName)}`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(sessionName)}`;
  }

  // Quick check if a specific origin is reachable (800ms timeout for speed)
  async function isReachable(origin, timeoutMs = 800) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const r = await fetch(`${origin}/api/version`, { signal: controller.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }

  function switchTo(origin, mode) {
    const changed = localOrigin !== origin;
    localOrigin = origin;
    if (origin) {
      certAccepted = true;
      localStorage.setItem('tui_local_origin', origin);
    } else {
      localStorage.removeItem('tui_local_origin');
    }
    updateConnectionMode(mode);
    if (changed) {
      showToast(mode === 'local' ? 'Local network \u2014 fast path active' : 'Switched to tunnel', mode === 'local' ? 'success' : 'warning', 3000);
      if (currentSession && currentView === 'terminal') {
        TerminalView.disconnect();
        TerminalView.connect(currentSession);
      }
    }
  }

  async function probeLocalIPs() {
    if (probing) return;
    probing = true;
    try {
      // Refresh network info periodically (IPs can change)
      if (!networkInfo) {
        try {
          const res = await fetch('/api/network');
          networkInfo = await res.json();
        } catch { probing = false; return; }
      }
      if (!networkInfo.localIPs || !networkInfo.httpsPort) { probing = false; return; }

      const ipsToTry = ['127.0.0.1', ...networkInfo.localIPs];

      // Race all local IPs — first one to respond wins
      const raceResult = await Promise.any(
        ipsToTry.map(async (ip) => {
          const origin = `https://${ip}:${networkInfo.httpsPort}`;
          if (await isReachable(origin)) return origin;
          throw new Error('unreachable');
        })
      ).catch(() => null);

      if (raceResult) {
        switchTo(raceResult, 'local');
      } else {
        // HTTPS failed — check if HTTP is reachable (IP on network but cert not accepted)
        if (!certAccepted && networkInfo.localIPs.length > 0) {
          let httpReachable = false;
          for (const ip of networkInfo.localIPs) {
            try {
              const controller = new AbortController();
              const t = setTimeout(() => controller.abort(), 1000);
              const r = await fetch(`http://${ip}:${networkInfo.httpPort}/api/version`, { signal: controller.signal, mode: 'no-cors' });
              clearTimeout(t);
              httpReachable = true;
              break;
            } catch { /* not reachable */ }
          }
          // Only show setup link if IP is reachable but HTTPS cert is the blocker
          if (httpReachable && !probeLocalIPs._prompted) {
            probeLocalIPs._prompted = true;
            const el = document.getElementById('connection-mode');
            if (el) {
              el.innerHTML = `<a href="/setup-local.html" title="Setup local fast-path" style="color:var(--orange);font-family:var(--mono);font-size:9px;text-decoration:underline">setup local</a>`;
            }
          }
        }
        if (localOrigin) switchTo(null, 'tunnel');
      }
    } catch { /* ignore */ }
    probing = false;
  }

  // Instant re-probe on any network change
  function onNetworkChange() {
    networkInfo = null; // force refresh IPs
    probeLocalIPs();
  }

  function updateConnectionMode(mode) {
    const el = document.getElementById('connection-mode');
    if (!el) return;
    if (mode === 'local') {
      el.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#00e5a0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5L8 2l6 5.5"/><path d="M3.5 6.5V14H7v-4h2v4h3.5V6.5"/></svg>';
      el.title = 'Local network (LAN)';
    } else {
      el.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c-2 2-3 4-3 6.5s1 4.5 3 6.5M8 1.5c2 2 3 4 3 6.5s-1 4.5-3 6.5"/></svg>';
      el.title = 'Internet (tunnel)';
    }
  }

  function startLocalProbing() {
    // Try cached local origin first for instant reconnect
    const cached = localStorage.getItem('tui_local_origin');
    if (cached) {
      localOrigin = cached;
      isReachable(cached).then(ok => {
        if (ok) {
          certAccepted = true;
          updateConnectionMode('local');
        } else {
          localOrigin = null;
          localStorage.removeItem('tui_local_origin');
          updateConnectionMode('tunnel');
        }
      });
    }

    updateConnectionMode(localOrigin ? 'local' : 'tunnel');

    // Initial check on load
    probeLocalIPs();

    // Re-check on network changes, phone wake, tab focus — no polling
    window.addEventListener('online', onNetworkChange);
    window.addEventListener('offline', () => { if (localOrigin) switchTo(null, 'tunnel'); });
    if (navigator.connection) {
      navigator.connection.addEventListener('change', onNetworkChange);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onNetworkChange();
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

    // Start probing for local network fast path
    startLocalProbing();
  }

  return { init, navigate, showModal, getWsUrl, getCurrentSession: () => currentSession, getLocalOrigin: () => localOrigin };
})();

document.addEventListener('DOMContentLoaded', App.init);
