/**
 * server-manager.js — Multi-server connection manager.
 * Fetches server list, resolves best connection per server, aggregates discovery.
 * Progressive rendering: HOST renders first, remotes fill in as they resolve.
 */

const ServerManager = (() => {
  let servers = [];          // from /api/servers
  let serverStates = {};     // name → { origin, online, version, updating, sessions, unmatchedKitty }
  let primaryVersion = null;
  let onUpdate = null;       // callback when server states change
  let pollCount = 0;         // tracks poll cycles for periodic re-resolve
  const RESOLVE_INTERVAL = 5; // re-resolve offline servers every N poll cycles
  const CACHE_KEY = 'tui_server_states_cache';

  // ---------- Init ----------

  async function init(updateCallback) {
    onUpdate = updateCallback;
    restoreFromCache();
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

    // Always include HOST as the local server
    if (!serverStates['HOST']) {
      serverStates['HOST'] = {
        config: { name: 'HOST', url: '' },
        origin: '',
        online: true,
        version: null,
        updating: false,
        sessions: [],
        unmatchedKitty: [],
        isHost: true,
      };
    }

    // Initialize state for each remote server
    for (const s of servers) {
      if (s.name === 'HOST') continue;
      if (!serverStates[s.name]) {
        serverStates[s.name] = {
          config: s,
          origin: null,
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

    // Remove states for servers no longer in config (but never remove HOST)
    const nameSet = new Set(['HOST', ...servers.map(s => s.name)]);
    for (const name of Object.keys(serverStates)) {
      if (!nameSet.has(name)) delete serverStates[name];
    }

    // Discover HOST immediately (instant — same origin), render right away
    await discoverServer(serverStates['HOST']);
    if (onUpdate) onUpdate();

    // Resolve + discover remotes in background, render progressively
    resolveAndDiscoverRemotes();
  }

  async function resolveAndDiscoverRemotes() {
    const remotes = Object.values(serverStates).filter(s => !s.isHost);
    await Promise.allSettled(remotes.map(async (state) => {
      await resolveServer(state);
      if (state.online) await discoverServer(state);
      // Render after each remote completes
      if (onUpdate) onUpdate();
    }));
    saveToCache();
  }

  // ---------- Cache ----------

  function saveToCache() {
    try {
      const cache = {};
      for (const [name, state] of Object.entries(serverStates)) {
        cache[name] = {
          sessions: state.sessions,
          unmatchedKitty: state.unmatchedKitty,
          online: state.online,
          origin: state.origin,
          version: state.version,
          isHost: state.isHost || false,
        };
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch { /* localStorage full or unavailable */ }
  }

  function restoreFromCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (!cached) return;
      for (const [name, data] of Object.entries(cached)) {
        serverStates[name] = {
          config: { name, url: '' },
          origin: data.origin || '',
          online: data.online,
          version: data.version,
          updating: false,
          sessions: data.sessions || [],
          unmatchedKitty: data.unmatchedKitty || [],
          isHost: data.isHost || false,
        };
      }
    } catch { /* bad cache */ }
  }

  function isMultiServer() {
    return true;
  }

  function getServers() {
    return servers;
  }

  function getServerStates() {
    return serverStates;
  }

  // Called when the network changes (WiFi ↔ mobile)
  async function onNetworkChange() {
    await Promise.allSettled(
      Object.values(serverStates).filter(s => !s.isHost).map(state => resolveServer(state))
    );
    await Promise.allSettled(
      Object.values(serverStates).map(state => discoverServer(state))
    );
    saveToCache();
    if (onUpdate) onUpdate();
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

  async function resolveServer(state) {
    const config = state.config;
    const configUrl = config.url || '';
    if (!configUrl) { state.origin = null; state.online = false; state.version = null; return; }

    const baseUrl = configUrl.includes('://') ? configUrl : `https://${configUrl}`;

    const identity = await isReachable(baseUrl, 3000);
    if (!identity) {
      state.origin = null; state.online = false; state.version = null;
      return;
    }

    state.version = identity.version;
    state.online = true;
    state.origin = baseUrl;
  }

  async function resolveAll() {
    await Promise.allSettled(
      Object.values(serverStates).filter(s => !s.isHost).map(state => resolveServer(state))
    );
  }

  async function reconnectServer(name) {
    const state = serverStates[name];
    if (!state) return;
    if (state.isHost) {
      // HOST: don't resolve (no url), just re-discover
      state.online = true;
      await discoverServer(state);
    } else {
      await resolveServer(state);
      if (state.online) await discoverServer(state);
    }
    if (onUpdate) onUpdate();
    saveToCache();
  }

  // ---------- Discovery Aggregation ----------

  async function discoverServer(state) {
    if (!state.online || (state.origin == null && !state.isHost)) {
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
    pollCount++;

    // Every Nth cycle, re-resolve offline servers
    const shouldReResolve = pollCount % RESOLVE_INTERVAL === 0;

    if (shouldReResolve) {
      const needsResolve = Object.values(serverStates).filter(s => !s.isHost && !s.online);
      await Promise.allSettled(needsResolve.map(state => resolveServer(state)));
    }

    // Discover all online servers in parallel
    await Promise.allSettled(
      Object.values(serverStates).map(state => discoverServer(state))
    );

    checkVersionSync();
    saveToCache();

    if (onUpdate) onUpdate();
  }

  // ---------- Version Sync ----------

  function setPrimaryVersion(version) {
    primaryVersion = version;
  }

  function checkVersionSync() {
    if (!primaryVersion) return;
    for (const state of Object.values(serverStates)) {
      if (state.isHost) continue;
      // Clear updating flag if version now matches
      if (state.updating && state.version === primaryVersion) {
        state.updating = false;
      }
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
    } catch {
      state.updating = false;
    }
  }

  // ---------- WebSocket URL ----------

  function getWsUrl(serverName, sessionName) {
    const state = serverStates[serverName];
    if (!state) return null;
    let origin = state.origin;
    if (!origin && state.isHost) {
      // HOST with empty origin — use current page location
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(sessionName)}`;
    }
    if (!origin) return null;
    const wsOrigin = origin.replace(/^http/, 'ws');
    return `${wsOrigin}/ws/terminal/${encodeURIComponent(sessionName)}`;
  }

  // ---------- API ----------

  function getOrigin(serverName) {
    const state = serverStates[serverName];
    return state ? state.origin : null;
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
    onNetworkChange,
  };
})();
