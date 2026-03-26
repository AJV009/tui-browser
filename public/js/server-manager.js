/**
 * server-manager.js — Multi-server connection manager.
 * Fetches server list, resolves best connection per server, aggregates discovery.
 */

/* global AppNetwork */

const ServerManager = (() => {
  let servers = [];          // from /api/servers
  let serverStates = {};     // name → { origin, mode, online, version, updating, sessions, unmatchedKitty }
  let primaryVersion = null;
  let onUpdate = null;       // callback when server states change

  async function init(updateCallback) {
    onUpdate = updateCallback;
    await loadServers();
  }

  async function loadServers() {
    try {
      const res = await fetch('/api/servers');
      const data = await res.json();
      servers = data.servers || [];
    } catch {
      servers = [];
    }

    if (servers.length === 0) {
      // No multi-server config — run in single-server mode (backwards compatible)
      serverStates = {};
      return;
    }

    // Initialize state for each server
    for (const s of servers) {
      if (!serverStates[s.name]) {
        serverStates[s.name] = {
          config: s,
          origin: null,
          mode: null,
          online: false,
          version: null,
          updating: false,
          sessions: [],
          unmatchedKitty: [],
        };
      } else {
        serverStates[s.name].config = s;
      }
    }

    // Remove states for servers no longer in config
    const nameSet = new Set(servers.map(s => s.name));
    for (const name of Object.keys(serverStates)) {
      if (!nameSet.has(name)) delete serverStates[name];
    }

    // Resolve connections for all servers
    await resolveAll();
  }

  function isMultiServer() {
    return servers.length > 0;
  }

  function getServers() {
    return servers;
  }

  function getServerStates() {
    return serverStates;
  }

  // ---------- Connection Resolution ----------

  async function isReachable(origin, timeoutMs = 1500) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const r = await fetch(`${origin}/api/identity`, { signal: controller.signal });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async function fetchNetworkInfo(origin, timeoutMs = 3000) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const r = await fetch(`${origin}/api/network`, { signal: controller.signal });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async function resolveServer(state) {
    const config = state.config;
    const configUrl = config.url || '';
    if (!configUrl) { state.origin = null; state.mode = null; state.online = false; state.version = null; return; }

    // Normalize the configured URL
    const baseUrl = configUrl.includes('://') ? configUrl : `https://${configUrl}`;

    // First check if the configured URL is reachable
    const identity = await isReachable(baseUrl, 3000);
    if (!identity) {
      state.origin = null; state.mode = null; state.online = false; state.version = null; state.localIPs = [];
      return;
    }

    // Server is reachable — now try to discover local IPs for a faster path
    state.version = identity.version;
    state.online = true;

    const networkInfo = await fetchNetworkInfo(baseUrl);
    if (networkInfo && networkInfo.localIPs && networkInfo.httpsPort) {
      state.localIPs = networkInfo.localIPs;
      // Race local IPs for a faster connection
      const localOrigins = ['127.0.0.1', ...networkInfo.localIPs].map(ip => `https://${ip}:${networkInfo.httpsPort}`);
      try {
        const fastest = await Promise.any(
          localOrigins.map(async (origin) => {
            const id = await isReachable(origin, 800);
            if (id) return origin;
            throw new Error('unreachable');
          })
        );
        state.origin = fastest;
        state.mode = 'local';
        return;
      } catch { /* no local path available */ }
    } else {
      state.localIPs = [];
    }

    // Fall back to configured URL
    state.origin = baseUrl;
    state.mode = 'url';
  }

  async function resolveAll() {
    await Promise.allSettled(
      Object.values(serverStates).map(state => resolveServer(state))
    );
  }

  async function reconnectServer(name) {
    const state = serverStates[name];
    if (!state) return;
    await resolveServer(state);
    if (state.online) await discoverServer(state);
    if (onUpdate) onUpdate();
  }

  // ---------- Discovery Aggregation ----------

  async function discoverServer(state) {
    if (!state.online || !state.origin) {
      state.sessions = [];
      state.unmatchedKitty = [];
      return;
    }
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${state.origin}/api/discover`, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      state.sessions = (data.sessions || []).map(s => ({ ...s, _server: state.config.name, _origin: state.origin }));
      state.unmatchedKitty = (data.unmatchedKitty || []).map(k => ({ ...k, _server: state.config.name }));
    } catch {
      state.online = false;
      state.sessions = [];
      state.unmatchedKitty = [];
    }
  }

  async function discoverAll() {
    await Promise.allSettled(
      Object.values(serverStates).map(state => discoverServer(state))
    );

    // Check for version mismatches and trigger updates
    checkVersionSync();

    if (onUpdate) onUpdate();
  }

  // ---------- Version Sync ----------

  function setPrimaryVersion(version) {
    primaryVersion = version;
  }

  function checkVersionSync() {
    if (!primaryVersion) return;
    for (const state of Object.values(serverStates)) {
      if (state.online && state.version && state.version !== primaryVersion && !state.updating) {
        triggerUpdate(state);
      }
    }
  }

  async function triggerUpdate(state) {
    state.updating = true;
    if (onUpdate) onUpdate();
    try {
      const res = await fetch(`${state.origin}/api/update`, { method: 'POST' });
      if (!res.ok) state.updating = false;
      // Server will restart — it'll come back online with new version on next discovery cycle
    } catch {
      state.updating = false;
    }
  }

  // ---------- WebSocket URL ----------

  function getWsUrl(serverName, sessionName) {
    const state = serverStates[serverName];
    if (!state || !state.origin) return null;
    const wsOrigin = state.origin.replace(/^http/, 'ws');
    return `${wsOrigin}/ws/terminal/${encodeURIComponent(sessionName)}`;
  }

  // ---------- API Proxy ----------

  function getOrigin(serverName) {
    const state = serverStates[serverName];
    return state ? state.origin : null;
  }

  async function fetchLocalIPs(url) {
    const baseUrl = url.includes('://') ? url : `https://${url}`;
    const info = await fetchNetworkInfo(baseUrl, 5000);
    if (info && info.localIPs) return { ips: info.localIPs, httpsPort: info.httpsPort };
    return null;
  }

  return {
    init,
    loadServers,
    isMultiServer,
    getServers,
    getServerStates,
    resolveAll,
    reconnectServer,
    discoverAll,
    setPrimaryVersion,
    getWsUrl,
    getOrigin,
    fetchLocalIPs,
  };
})();
