# Tailscale Security Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock down tui-browser to only accept connections from the Tailscale network by binding to the Tailscale interface, removing the local fast-path system, removing Cloudflare tunnel references, and adding security headers.

**Architecture:** The server binds exclusively to its Tailscale IP (via `BIND` env var). The entire AppNetwork local fast-path system is deleted — Tailscale handles routing. CORS middleware is removed (no cross-origin requests). ServerManager's IP racing logic is stripped to a simple reachability check. README and install.sh are rewritten for Tailscale-only access.

**Tech Stack:** Node.js, Express, Tailscale (external), systemd

---

## File Structure

### Files to Delete
- `public/js/app-network.js` — entire local fast-path system (154 lines)
- `public/setup-local.html` — guided cert acceptance page (no longer needed)

### Files to Modify
- `server/index.js` — bind to `BIND` env var, remove CORS, add security headers, remove HTTPS fast-path log
- `server/routes.js` — remove `/api/network` endpoint and `getLocalIPs()` helper
- `public/js/app.js` — remove all AppNetwork references, simplify getWsUrl/onNetworkChange
- `public/js/server-manager.js` — remove IP racing, fetchNetworkInfo, fetchLocalIPs, mode tracking, getHostMode
- `public/js/dashboard.js` — remove LOCAL_SVG/TUNNEL_SVG, remove mode icon from server groups, remove connection-mode hiding
- `public/js/settings-panel.js` — remove Sync button and local IP display
- `public/js/terminal-controls.js` — verify no AppNetwork references (should be clean)
- `public/index.html` — remove `#connection-mode` element, remove `app-network.js` script tag
- `public/css/base.css` — remove connection-mode styles if any
- `install.sh` — require Tailscale, auto-detect IP, set BIND in systemd unit, remove cert generation
- `README.md` — complete rewrite of networking/security/setup sections

---

### Task 1: Bind Server to Tailscale IP

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add BIND env var and enforce it**

In `server/index.js`, after the existing `PORT` and `HTTPS_PORT` declarations (lines 21-22), add `BIND` parsing. Then modify the server startup to bind to it.

Replace lines 21-25:
```javascript
const PORT = parseInt(process.env.PORT || process.argv[2], 10) || 3000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || PORT + 1;
const PKG_VERSION = require('../package.json').version;
const BUILD_ID = Date.now().toString(36);
const FULL_VERSION = `${PKG_VERSION.replace(/\.\d+$/, '')}.${BUILD_ID}`;
```

With:
```javascript
const PORT = parseInt(process.env.PORT || process.argv[2], 10) || 3000;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || PORT + 1;
const BIND = process.env.BIND || null;
const PKG_VERSION = require('../package.json').version;
const BUILD_ID = Date.now().toString(36);
const FULL_VERSION = `${PKG_VERSION.replace(/\.\d+$/, '')}.${BUILD_ID}`;
```

- [ ] **Step 2: Remove CORS middleware**

Delete lines 32-42 (the entire CORS middleware block):
```javascript
// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

- [ ] **Step 3: Add security headers middleware**

In the same location where CORS was (after `app.use(express.json(...))`), add:
```javascript
// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
```

- [ ] **Step 4: Update server startup to use BIND**

Replace lines 133-143:
```javascript
  server.listen(PORT, () => console.log(`TUI Browser listening on http://localhost:${PORT}`));
  if (httpsServer) {
    const os = require('os');
    const ips = [];
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs) { if (a.family === 'IPv4' && !a.internal) ips.push(a.address); }
    }
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`TUI Browser HTTPS on port ${HTTPS_PORT} (local fast-path)`);
      ips.forEach(ip => console.log(`  https://${ip}:${HTTPS_PORT}`));
    });
  }
```

With:
```javascript
  const bindArgs = BIND ? [PORT, BIND] : [PORT];
  server.listen(...bindArgs, () => {
    const addr = BIND || '0.0.0.0';
    console.log(`TUI Browser listening on http://${addr}:${PORT}`);
  });
  if (httpsServer) {
    const httpsBindArgs = BIND ? [HTTPS_PORT, BIND] : [HTTPS_PORT];
    httpsServer.listen(...httpsBindArgs, () => {
      const addr = BIND || '0.0.0.0';
      console.log(`TUI Browser HTTPS on https://${addr}:${HTTPS_PORT}`);
    });
  }
```

- [ ] **Step 5: Update HTTPS warning message**

Change line 83:
```javascript
  console.warn('[server] HTTPS certs not found, local fast-path disabled.');
```
To:
```javascript
  console.warn('[server] HTTPS certs not found — HTTPS disabled.');
```

- [ ] **Step 6: Test the bind change**

```bash
# Start with BIND on Tailscale IP
BIND=100.91.68.37 PORT=7483 node server/index.js
# Expected output: TUI Browser listening on http://100.91.68.37:7483

# In another terminal, verify it's NOT reachable on localhost:
curl -s http://localhost:7483/api/version
# Expected: connection refused

# Verify it IS reachable on Tailscale IP:
curl -s http://100.91.68.37:7483/api/version
# Expected: JSON response with version

# Stop the test server (Ctrl+C)
```

- [ ] **Step 7: Commit**

```bash
git add server/index.js
git commit -m "feat: bind server to BIND env var, add security headers, remove CORS"
```

---

### Task 2: Remove `/api/network` Endpoint

**Files:**
- Modify: `server/routes.js`

- [ ] **Step 1: Remove getLocalIPs() and /api/network**

In `server/routes.js`, delete the `getLocalIPs()` function (lines 17-25):
```javascript
function getLocalIPs() {
  const ips = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    }
  }
  return ips;
}
```

And delete the `/api/network` route (lines 41-43):
```javascript
  app.get('/api/network', (_req, res) => {
    res.json({ localIPs: getLocalIPs(), httpsPort: config.HTTPS_PORT, httpPort: config.PORT });
  });
```

Also remove the `os` require at line 7 since it's no longer needed:
```javascript
const os = require('os');
```
Check if `os` is used anywhere else in routes.js first — if not, remove it.

- [ ] **Step 2: Test**

```bash
BIND=100.91.68.37 PORT=7483 node server/index.js &
curl -s http://100.91.68.37:7483/api/network
# Expected: 404 or "Cannot GET /api/network"
curl -s http://100.91.68.37:7483/api/identity
# Expected: still works, returns { name, version }
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add server/routes.js
git commit -m "feat: remove /api/network endpoint (no longer exposing local IPs)"
```

---

### Task 3: Delete AppNetwork and Remove All References

**Files:**
- Delete: `public/js/app-network.js`
- Delete: `public/setup-local.html`
- Modify: `public/index.html`
- Modify: `public/js/app.js`

- [ ] **Step 1: Delete app-network.js and setup-local.html**

```bash
rm public/js/app-network.js
rm -f public/setup-local.html
```

- [ ] **Step 2: Remove app-network.js script tag from index.html**

In `public/index.html`, delete line 316:
```html
  <script src="/js/app-network.js"></script>
```

- [ ] **Step 3: Remove #connection-mode element from index.html**

In `public/index.html`, delete line 30:
```html
        <span id="connection-mode" class="connection-mode"></span>
```

- [ ] **Step 4: Rewrite app.js to remove all AppNetwork references**

In `public/js/app.js`, change the globals comment (line 6):
```javascript
/* global Dashboard, TerminalView, AppNetwork, FileBrowser, FileEditor, FileUpload, ServerManager, SettingsPanel */
```
To:
```javascript
/* global Dashboard, TerminalView, FileBrowser, FileEditor, FileUpload, ServerManager, SettingsPanel */
```

Replace the `getWsUrl` export (lines 264-267):
```javascript
    getWsUrl: (sessionName, serverName) => {
      if (serverName) return ServerManager.getWsUrl(serverName, sessionName);
      return AppNetwork.getWsUrl(sessionName);
    },
```
With:
```javascript
    getWsUrl: (sessionName, serverName) => {
      return ServerManager.getWsUrl(serverName || 'HOST', sessionName);
    },
```

Replace the `onNetworkChange` export (line 268):
```javascript
    onNetworkChange: () => AppNetwork.onNetworkChange(),
```
With:
```javascript
    onNetworkChange: () => ServerManager.onNetworkChange(),
```

Remove the `getLocalOrigin` export (line 271):
```javascript
    getLocalOrigin: () => AppNetwork.getLocalOrigin(),
```
Delete this line entirely.

In `init()`, remove the AppNetwork block (lines 254-258):
```javascript
    AppNetwork.startLocalProbing({
      showToast,
      get currentSession() { return currentSession; },
      get currentView() { return currentView; },
    });
```
Delete these lines entirely.

- [ ] **Step 5: Commit**

```bash
git rm public/js/app-network.js
git rm -f public/setup-local.html
git add public/index.html public/js/app.js
git commit -m "feat: delete AppNetwork local fast-path system entirely"
```

---

### Task 4: Simplify ServerManager (Remove IP Racing & Mode Tracking)

**Files:**
- Modify: `public/js/server-manager.js`

- [ ] **Step 1: Remove mode from server state and getHostMode()**

In `server-manager.js`, update the state structure comment (line 11):
```javascript
  let serverStates = {};     // name → { origin, mode, online, version, updating, sessions, unmatchedKitty }
```
To:
```javascript
  let serverStates = {};     // name → { origin, online, version, updating, sessions, unmatchedKitty }
```

Delete the entire `getHostMode()` function (lines 150-158):
```javascript
  function getHostMode() {
    // HOST mode reflects how the page was loaded
    // If AppNetwork has a local origin, we're on LAN. Otherwise tunnel/url.
    if (typeof AppNetwork !== 'undefined' && AppNetwork.getLocalOrigin()) return 'local';
    // Check if page was loaded from localhost or a local IP
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'local';
    return 'url';
  }
```

Delete the `updateHostMode()` function (lines 160-163):
```javascript
  function updateHostMode() {
    const hostState = serverStates['HOST'];
    if (hostState) hostState.mode = getHostMode();
  }
```

- [ ] **Step 2: Remove mode from HOST initialization**

In `loadServers()`, update the HOST state initialization (lines 36-48). Change:
```javascript
    if (!serverStates['HOST']) {
      serverStates['HOST'] = {
        config: { name: 'HOST', url: '' },
        origin: '',
        mode: getHostMode(),
        online: true,
        version: null,
        updating: false,
        sessions: [],
        unmatchedKitty: [],
        isHost: true,
      };
    } else {
      serverStates['HOST'].mode = getHostMode();
    }
```
To:
```javascript
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
```

- [ ] **Step 3: Remove mode from remote server state initialization**

In `loadServers()`, update the remote state initialization (lines 55-65). Change:
```javascript
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
```
To:
```javascript
        serverStates[s.name] = {
          config: s,
          origin: null,
          online: false,
          version: null,
          updating: false,
          sessions: [],
          unmatchedKitty: [],
        };
```

- [ ] **Step 4: Simplify resolveServer() — remove IP racing**

Replace the entire `resolveServer()` function (lines 204-242):
```javascript
  async function resolveServer(state) {
    const config = state.config;
    const configUrl = config.url || '';
    if (!configUrl) { state.origin = null; state.mode = null; state.online = false; state.version = null; return; }

    const baseUrl = configUrl.includes('://') ? configUrl : `https://${configUrl}`;

    const identity = await isReachable(baseUrl, 3000);
    if (!identity) {
      state.origin = null; state.mode = null; state.online = false; state.version = null; state.localIPs = [];
      return;
    }

    state.version = identity.version;
    state.online = true;

    const networkInfo = await fetchNetworkInfo(baseUrl);
    if (networkInfo && networkInfo.localIPs && networkInfo.httpsPort) {
      state.localIPs = networkInfo.localIPs;
      const localOrigins = networkInfo.localIPs.map(ip => `https://${ip}:${networkInfo.httpsPort}`);
      try {
        const fastest = await Promise.any(
          localOrigins.map(async (origin) => {
            const id = await isReachable(origin, 1500);
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

    state.origin = baseUrl;
    state.mode = 'url';
  }
```

With the simplified version:
```javascript
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
```

- [ ] **Step 5: Delete fetchNetworkInfo() and fetchLocalIPs()**

Delete `fetchNetworkInfo()` (lines 193-202):
```javascript
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
```

Delete `fetchLocalIPs()` (lines 360-365):
```javascript
  async function fetchLocalIPs(url) {
    const baseUrl = url.includes('://') ? url : `https://${url}`;
    const info = await fetchNetworkInfo(baseUrl, 5000);
    if (info && info.localIPs) return { ips: info.localIPs, httpsPort: info.httpsPort };
    return null;
  }
```

- [ ] **Step 6: Simplify onNetworkChange()**

Replace the `onNetworkChange()` function (lines 166-178):
```javascript
  async function onNetworkChange() {
    updateHostMode();
    // Re-resolve all remote servers immediately
    await Promise.allSettled(
      Object.values(serverStates).filter(s => !s.isHost).map(state => resolveServer(state))
    );
    // Re-discover all
    await Promise.allSettled(
      Object.values(serverStates).map(state => discoverServer(state))
    );
    saveToCache();
    if (onUpdate) onUpdate();
  }
```

With:
```javascript
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
```

- [ ] **Step 7: Simplify discoverAll() — remove updateHostMode**

In `discoverAll()` (line 291), remove `updateHostMode();` call (line 292):
```javascript
  async function discoverAll() {
    pollCount++;
    updateHostMode();
```
Change to:
```javascript
  async function discoverAll() {
    pollCount++;
```

Also in `discoverAll()`, update the re-resolve filter (line 298). Change:
```javascript
      const needsResolve = Object.values(serverStates).filter(s => !s.isHost && (!s.online || s.mode === 'url'));
```
To:
```javascript
      const needsResolve = Object.values(serverStates).filter(s => !s.isHost && !s.online);
```

- [ ] **Step 8: Remove mode from cache and reconnectServer**

In `saveToCache()`, remove `mode` from the cached fields (line 105):
```javascript
          mode: state.mode,
```
Delete this line.

In `restoreFromCache()`, remove `mode` from restoration (line 124):
```javascript
          mode: data.mode,
```
Delete this line.

In `reconnectServer()` (line 256), remove `state.mode = getHostMode();`:
```javascript
      state.mode = getHostMode();
```
Delete this line.

- [ ] **Step 9: Remove fetchLocalIPs from the return object**

In the return statement (lines 367-381), remove `fetchLocalIPs`:
```javascript
    fetchLocalIPs,
```
Delete this line.

- [ ] **Step 10: Commit**

```bash
git add public/js/server-manager.js
git commit -m "feat: strip IP racing and mode tracking from ServerManager"
```

---

### Task 5: Update Dashboard — Remove Mode Icons

**Files:**
- Modify: `public/js/dashboard.js`

- [ ] **Step 1: Remove LOCAL_SVG and TUNNEL_SVG constants**

Delete lines 151-152:
```javascript
  const LOCAL_SVG = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#00e5a0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5L8 2l6 5.5"/><path d="M3.5 6.5V14H7v-4h2v4h3.5V6.5"/></svg>';
  const TUNNEL_SVG = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c-2 2-3 4-3 6.5s1 4.5 3 6.5M8 1.5c2 2 3 4 3 6.5s-1 4.5-3 6.5"/></svg>';
```

- [ ] **Step 2: Remove connection-mode hiding and mode icon from renderMultiServer**

In `renderMultiServer()`, delete lines 166-167:
```javascript
    const connMode = document.getElementById('connection-mode');
    if (connMode) connMode.style.display = 'none';
```

Delete the mode icon block (lines 190-192):
```javascript
      if (isOnline && state.mode) {
        html += `<span class="server-group-mode-icon" title="${state.mode === 'local' ? 'Local network (LAN)' : 'Internet'}">${state.mode === 'local' ? LOCAL_SVG : TUNNEL_SVG}</span>`;
      }
```

- [ ] **Step 3: Commit**

```bash
git add public/js/dashboard.js
git commit -m "feat: remove connection mode icons from dashboard"
```

---

### Task 6: Simplify Settings Panel — Remove Sync Button

**Files:**
- Modify: `public/js/settings-panel.js`

- [ ] **Step 1: Remove SYNC_SVG and syncIPs function**

Delete line 10 (SYNC_SVG constant):
```javascript
  const SYNC_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.3-4"/><path d="M13.5 8a5.5 5.5 0 0 1-9.3 4"/><path d="M11.5 1.5v3h3"/><path d="M4.5 14.5v-3h-3"/></svg>';
```

Delete the entire `syncIPs()` function (lines 81-99):
```javascript
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
```

- [ ] **Step 2: Simplify renderEntries — remove sync button and local IPs display**

In `renderEntries()`, replace the server entry template (lines 40-57). Change:
```javascript
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
```
To:
```javascript
    list.innerHTML = editingServers.map((s, i) => `
      <div class="settings-server-entry" data-index="${i}">
        <label>Name</label>
        <input type="text" data-field="name" value="${esc(s.name)}" placeholder="e.g. desktop">
        <label>URL</label>
        <input type="text" data-field="url" value="${esc(s.url || '')}" placeholder="http://100.x.x.x:7483 (Tailscale IP)">
        <button class="settings-server-remove" data-action="remove-server" data-index="${i}">Remove</button>
      </div>`).join('');
```

- [ ] **Step 3: Remove sync-ips event listener block**

Delete the sync-ips event listener block (lines 76-78):
```javascript
    list.querySelectorAll('[data-action="sync-ips"]').forEach(btn => {
      btn.addEventListener('click', () => syncIPs(parseInt(btn.dataset.index), btn));
    });
```

- [ ] **Step 4: Remove _localIPs from editingServers**

In `open()`, change the server mapping (lines 25-27):
```javascript
      ? servers.map(s => ({ name: s.name || '', url: s.url || '', _localIPs: null }))
      : [{ name: '', url: '', _localIPs: null }];
```
To:
```javascript
      ? servers.map(s => ({ name: s.name || '', url: s.url || '' }))
      : [{ name: '', url: '' }];
```

In `addEntry()`, change (line 102):
```javascript
    editingServers.push({ name: '', url: '', _localIPs: null });
```
To:
```javascript
    editingServers.push({ name: '', url: '' });
```

- [ ] **Step 5: Commit**

```bash
git add public/js/settings-panel.js
git commit -m "feat: remove Sync button and local IP display from settings panel"
```

---

### Task 7: Update install.sh — Require Tailscale, Set BIND

**Files:**
- Modify: `install.sh`

- [ ] **Step 1: Add Tailscale check to dependency section**

After the existing dependency checks (after line 41), add Tailscale verification. Replace the existing dependency block (lines 32-41):
```bash
missing=()
command -v node  >/dev/null || missing+=(node)
command -v npm   >/dev/null || missing+=(npm)
command -v tmux  >/dev/null || missing+=(tmux)

if [ ${#missing[@]} -gt 0 ]; then
  err "Missing required dependencies: ${missing[*]}"
  echo "  Install them before running this script."
  exit 1
fi
```

With:
```bash
missing=()
command -v node  >/dev/null || missing+=(node)
command -v npm   >/dev/null || missing+=(npm)
command -v tmux  >/dev/null || missing+=(tmux)

if [ ${#missing[@]} -gt 0 ]; then
  err "Missing required dependencies: ${missing[*]}"
  echo "  Install them before running this script."
  exit 1
fi

# Tailscale is required for network security
if ! command -v tailscale &>/dev/null; then
  err "Tailscale is required but not installed."
  echo "  Install: https://tailscale.com/download"
  echo "  Then run: sudo tailscale up"
  exit 1
fi

if ! tailscale status &>/dev/null; then
  err "Tailscale is installed but not running."
  echo "  Start it with: sudo tailscale up"
  exit 1
fi

TAILSCALE_IP=$(tailscale ip -4 2>/dev/null)
if [ -z "$TAILSCALE_IP" ]; then
  err "Could not detect Tailscale IPv4 address."
  echo "  Make sure Tailscale is connected: tailscale status"
  exit 1
fi

info "Tailscale IP: $TAILSCALE_IP"
```

- [ ] **Step 2: Remove HTTPS cert generation section**

Delete the entire cert generation block (lines 100-113):
```bash
# ──────────────────────────────────────────────
step "Generating HTTPS certificates for local fast-path"
# ──────────────────────────────────────────────

if [ ! -f "$SCRIPT_DIR/certs/server.crt" ]; then
  if command -v openssl &>/dev/null; then
    bash "$SCRIPT_DIR/scripts/generate-certs.sh"
    info "HTTPS certificates generated (accept cert on phone for fast local access)"
  else
    warn "openssl not found — skipping HTTPS cert generation (local fast-path disabled)"
  fi
else
  info "HTTPS certificates already exist, skipping"
fi
```

- [ ] **Step 3: Update servers.json template**

In the servers.json initialization (lines 76-89), change:
```bash
if [ "$IS_PRIMARY" = true ] && [ ! -f "$SCRIPT_DIR/data/servers.json" ]; then
  cat > "$SCRIPT_DIR/data/servers.json" << SEOF
{
  "servers": [
    {
      "name": "$SERVER_NAME",
      "tunnel": "",
      "local": []
    }
  ]
}
SEOF
  echo "Initialized servers.json with self as primary."
fi
```
To:
```bash
if [ "$IS_PRIMARY" = true ] && [ ! -f "$SCRIPT_DIR/data/servers.json" ]; then
  cat > "$SCRIPT_DIR/data/servers.json" << SEOF
{
  "servers": [
    {
      "name": "$SERVER_NAME",
      "url": "http://$TAILSCALE_IP:7483"
    }
  ]
}
SEOF
  echo "Initialized servers.json with self as primary."
fi
```

- [ ] **Step 4: Add BIND to systemd unit**

In the systemd service file (lines 182-201), add the `BIND` environment variable. After line 194:
```bash
Environment=PORT=7483
```
Add:
```bash
Environment=BIND=$TAILSCALE_IP
```

- [ ] **Step 5: Update startup output**

Replace the startup success message (lines 263-265):
```bash
  info "TUI Browser is running!"
  echo ""
  echo -e "  ${GREEN}http://localhost:7483${NC}"
  echo ""
```
With:
```bash
  info "TUI Browser is running!"
  echo ""
  echo -e "  ${GREEN}http://$TAILSCALE_IP:7483${NC}  (Tailscale only)"
  echo ""
```

- [ ] **Step 6: Commit**

```bash
git add install.sh
git commit -m "feat: require Tailscale in install.sh, bind to Tailscale IP"
```

---

### Task 8: Rewrite README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Remove "Local Network Fast-Path" section**

Delete the entire section from `## Local Network Fast-Path (Auto-Switching)` (line 139) through line 192 (before `## Remote Access`).

- [ ] **Step 2: Replace "Remote Access (Cloudflare Tunnel)" section**

Delete the entire section from `## Remote Access (Cloudflare Tunnel)` (line 194) through line 236. Replace with:

```markdown
## Network Access (Tailscale)

TUI Browser requires [Tailscale](https://tailscale.com/) for network access. Tailscale creates an encrypted mesh VPN — the server binds exclusively to its Tailscale IP and is invisible to the public internet and local LAN.

**Setup:**

1. Install Tailscale on all machines: https://tailscale.com/download
2. Run `tailscale up` and authenticate
3. Run `./install.sh` — it auto-detects the Tailscale IP and binds to it

**Access from any device:**
- Install the Tailscale app (Android, iOS, macOS, Windows, Linux)
- Join the same Tailscale network
- Open `http://<tailscale-ip>:7483` in your browser

**MagicDNS:** Tailscale assigns each machine a hostname like `machine-name.tailnet-name.ts.net`. Use these instead of raw IPs.
```

- [ ] **Step 3: Replace "Security" section**

Delete the entire section from `## Security` (line 238) through line 257. Replace with:

```markdown
## Security

**This tool gives full shell access and filesystem access from a browser.**

TUI Browser binds exclusively to the Tailscale network interface. It is unreachable from the public internet or local LAN — only devices on your Tailscale network can connect.

**Defense layers:**
- **Network isolation** — server binds to Tailscale IP only (`BIND` env var)
- **WireGuard encryption** — all traffic encrypted end-to-end by Tailscale
- **Device authentication** — only devices you approve on your Tailscale account can reach the server
- **No exposed ports** — nothing listens on public or LAN interfaces

**Recommended firewall rules** (defense in depth):
```bash
# Block tui-browser ports on all non-Tailscale interfaces
sudo ufw deny 7483
sudo ufw deny 7484
```
```

- [ ] **Step 4: Update "Service Management" section**

Remove the Cloudflare tunnel service commands (lines 269-271):
```markdown
# Cloudflare tunnel (if configured)
systemctl --user start tui-browser-tunnel
systemctl --user stop tui-browser-tunnel
```

- [ ] **Step 5: Update API table — remove /api/network**

In the API table, delete the row:
```markdown
| `GET` | `/api/network` | Local IPs + HTTPS port for LAN fast-path |
```

- [ ] **Step 6: Update "Under the Hood" section**

Delete or update these bullet points:
- Delete: `- **Local network fast-path** — auto-discovers LAN IPs from each server and races them against the configured URL. Green house icon = local, orange globe = remote. Works per-server in multi-machine setups.`
- Delete: `- **Cloudflare Tunnel support** — secure remote access via HTTPS with zero port forwarding.`
- Add: `- **Tailscale network isolation** — binds exclusively to the Tailscale interface. Unreachable from public internet or local LAN.`

- [ ] **Step 7: Update "Server settings panel" in Features**

Change:
```markdown
- **Server settings panel** — add/remove servers via the wrench icon. Enter a URL (tunnel or local IP), sync button auto-discovers LAN IPs for fast-path connections.
```
To:
```markdown
- **Server settings panel** — add/remove servers via the wrench icon. Enter Tailscale IPs or MagicDNS hostnames.
```

- [ ] **Step 8: Update Project Structure — remove app-network.js and setup-local.html**

In the project structure tree, delete:
```
│   │   ├── app-network.js    # Local network fast-path detection
```

- [ ] **Step 9: Update Multi-Machine Federation section**

Replace the networking description (lines 447-450):
```markdown
- The client fetches `/api/network` from each server to auto-discover LAN IPs
- It races LAN IPs against the configured URL for the fastest connection per server
```
With:
```markdown
- Each server's Tailscale IP or MagicDNS hostname is configured in the settings panel
- The client connects directly to each server over the Tailscale mesh
```

Delete the "Setting Up a New Machine" Cloudflare tunnel sub-section (lines 461-483) and replace with:
```markdown
2. **Ensure Tailscale is installed** on the new machine and joined to the same network.

3. **Add the server** in the primary's dashboard via the wrench icon, using the Tailscale IP (e.g., `http://100.x.x.x:7483`) or MagicDNS hostname.
```

Delete the entire "Enabling Local Fast-Path Between Machines" section (lines 485-513).

- [ ] **Step 10: Update architecture diagram**

Replace the architecture diagram (lines 416-432):
```markdown
```
Phone/Tablet/Laptop Browser              Machine A (primary)          Machine B (remote)
┌──────────────────────────┐            ┌──────────────────────┐    ┌──────────────────────┐
│  Dashboard               │            │  Node.js Server      │    │  Node.js Server      │
│  ┌─ HOST ──────────────┐ │ Tailscale  │  ├── REST API        │    │  ├── REST API        │
│  │ Sessions from A     │ │◄══════════►│  ├── WebSocket       │    │  ├── WebSocket       │
│  └─────────────────────┘ │  WireGuard │  ├── tmux discovery  │    │  ├── tmux discovery  │
│  ┌─ LAPTOP ────────────┐ │  encrypted │  ├── serves frontend │    │  ├── /api/identity   │
│  │ Sessions from B     │ │◄══════╦═══►│  ├── /api/servers    │    │  └── /api/update     │
│  └─────────────────────┘ │       ║    │  └── session-manager │    └──────────────────────┘
│  Terminal View           │       ║    └──────────────────────┘               │
│  ┌─────────────────────┐ │       ║               │                          ▼
│  │ xterm.js — direct   │ │       ╚══════════════════════════►    ┌────────────────────┐
│  │ WireGuard to B      │ │                       ▼               │ tmux sessions      │
│  └─────────────────────┘ │            ┌────────────────────┐    └────────────────────┘
└──────────────────────────┘            │ tmux sessions      │
                                        └────────────────────┘
```
```

- [ ] **Step 11: Update Quick Start**

After the install commands, change:
```markdown
After install, the dashboard is at `http://localhost:7483`. Add additional servers via the wrench icon in the dashboard header.
```
To:
```markdown
After install, the dashboard is at `http://<tailscale-ip>:7483`. Add additional servers via the wrench icon in the dashboard header using their Tailscale IPs.
```

- [ ] **Step 12: Update Prerequisites**

Add Tailscale to the prerequisites list:
```markdown
### Prerequisites

- **Node.js** >= 18
- **tmux** >= 3.2 (for `allow-passthrough`)
- **Tailscale** — required for network access ([install](https://tailscale.com/download))
- **Kitty** (optional — for host terminal integration)
- **Claude CLI** (optional — for AI session title generation)
```

- [ ] **Step 13: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for Tailscale-only networking"
```

---

### Task 9: Final Cleanup and Integration Test

**Files:**
- Verify all changes work together

- [ ] **Step 1: Verify no remaining AppNetwork references**

```bash
grep -r "AppNetwork" public/ --include="*.js" --include="*.html"
# Expected: no matches

grep -r "app-network" public/ --include="*.js" --include="*.html"
# Expected: no matches

grep -r "getLocalOrigin" public/ --include="*.js"
# Expected: no matches

grep -r "getHostMode\|updateHostMode" public/ --include="*.js"
# Expected: no matches

grep -r "fetchLocalIPs\|fetchNetworkInfo\|localIPs" public/ --include="*.js"
# Expected: no matches

grep -r "connection-mode" public/ --include="*.html" --include="*.css" --include="*.js"
# Expected: no matches (or only CSS class definitions to clean up)

grep -r "api/network" public/ server/ --include="*.js"
# Expected: no matches

grep -r "cloudflare\|tunnel" README.md
# Expected: no matches (case insensitive check)
```

- [ ] **Step 2: Clean up any remaining connection-mode CSS**

Check `public/css/base.css` and `public/css/dashboard.css` for `.connection-mode` or `#connection-mode` styles. Delete any found.

- [ ] **Step 3: Integration test on this machine**

```bash
# Start with Tailscale binding
systemctl --user stop tui-browser
BIND=100.91.68.37 PORT=7483 node server/index.js &

# Test API endpoints
curl -s http://100.91.68.37:7483/api/version | head -1
# Expected: JSON with version

curl -s http://100.91.68.37:7483/api/identity | head -1
# Expected: JSON with name and version

curl -s http://100.91.68.37:7483/api/network
# Expected: 404

# Test security headers
curl -sI http://100.91.68.37:7483/api/version | grep -i "x-content-type\|x-frame\|cache-control"
# Expected:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# Cache-Control: no-store

# Test no CORS headers
curl -sI -H "Origin: https://evil.com" http://100.91.68.37:7483/api/version | grep -i "access-control"
# Expected: no output (no CORS headers)

# Test localhost is blocked
curl -s http://localhost:7483/api/version
# Expected: connection refused

# Stop test server
kill %1
```

- [ ] **Step 4: Test from g5 via Tailscale**

```bash
ssh g5-server "curl -s http://100.91.68.37:7483/api/version"
# Expected: JSON response (g5 can reach 3400 via Tailscale)
```

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "chore: clean up remaining fast-path references"
```

---
