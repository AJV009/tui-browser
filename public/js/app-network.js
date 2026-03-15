/**
 * app-network.js — Local network fast-path detection and switching.
 * Probes local IPs for direct HTTPS connection, falls back to tunnel.
 */

/* global TerminalView */

const AppNetwork = (() => {
  let localOrigin = null;
  let certAccepted = false;
  let networkInfo = null;
  let probing = false;

  function getWsUrl(sessionName) {
    if (localOrigin) {
      return `wss://${localOrigin.replace(/^https?:\/\//, '')}/ws/terminal/${encodeURIComponent(sessionName)}`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(sessionName)}`;
  }

  async function isReachable(origin, timeoutMs = 800) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const r = await fetch(`${origin}/api/version`, { signal: controller.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }

  function switchTo(origin, mode, { showToast, currentSession, currentView }) {
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

  let _appCtx = null;

  async function probeLocalIPs() {
    if (probing) return;
    probing = true;
    try {
      if (!networkInfo) {
        try {
          const res = await fetch('/api/network');
          networkInfo = await res.json();
        } catch { probing = false; return; }
      }
      if (!networkInfo.localIPs || !networkInfo.httpsPort) { probing = false; return; }

      const ipsToTry = ['127.0.0.1', ...networkInfo.localIPs];

      const raceResult = await Promise.any(
        ipsToTry.map(async (ip) => {
          const origin = `https://${ip}:${networkInfo.httpsPort}`;
          if (await isReachable(origin)) return origin;
          throw new Error('unreachable');
        })
      ).catch(() => null);

      if (raceResult) {
        switchTo(raceResult, 'local', _appCtx);
      } else {
        if (!certAccepted && networkInfo.localIPs.length > 0) {
          let httpReachable = false;
          for (const ip of networkInfo.localIPs) {
            try {
              const controller = new AbortController();
              const t = setTimeout(() => controller.abort(), 1000);
              await fetch(`http://${ip}:${networkInfo.httpPort}/api/version`, { signal: controller.signal, mode: 'no-cors' });
              clearTimeout(t);
              httpReachable = true;
              break;
            } catch { /* not reachable */ }
          }
          if (httpReachable && !probeLocalIPs._prompted) {
            probeLocalIPs._prompted = true;
            const el = document.getElementById('connection-mode');
            if (el) {
              el.innerHTML = `<a href="/setup-local.html" title="Setup local fast-path" style="color:var(--orange);font-family:var(--mono);font-size:9px;text-decoration:underline">setup local</a>`;
            }
          }
        }
        if (localOrigin) switchTo(null, 'tunnel', _appCtx);
      }
    } catch { /* ignore */ }
    probing = false;
  }

  function onNetworkChange() {
    networkInfo = null;
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

  function startLocalProbing(appCtx) {
    _appCtx = appCtx;
    const cached = localStorage.getItem('tui_local_origin');
    if (cached) {
      localOrigin = cached;
      isReachable(cached).then(ok => {
        if (ok) { certAccepted = true; updateConnectionMode('local'); }
        else { localOrigin = null; localStorage.removeItem('tui_local_origin'); updateConnectionMode('tunnel'); }
      });
    }

    updateConnectionMode(localOrigin ? 'local' : 'tunnel');
    probeLocalIPs();

    window.addEventListener('online', onNetworkChange);
    window.addEventListener('offline', () => { if (localOrigin) switchTo(null, 'tunnel', _appCtx); });
    if (navigator.connection) navigator.connection.addEventListener('change', onNetworkChange);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onNetworkChange();
    });
  }

  return {
    getWsUrl,
    onNetworkChange,
    startLocalProbing,
    getLocalOrigin: () => localOrigin,
  };
})();
