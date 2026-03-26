# Tailscale Security Lockdown — Design Spec

## Goal

Lock down tui-browser so it is completely invisible to the public internet. Only devices on the user's Tailscale network can reach the server. No application-level authentication — Tailscale's WireGuard-based device authentication IS the auth layer.

## Architecture

Tailscale creates a private mesh VPN across all devices. Each device gets a stable `100.x.x.x` IP. tui-browser binds exclusively to this IP, making it unreachable from the public internet or even the local LAN.

```
Phone (Tailscale) ──┐
                    ├── WireGuard mesh ── tui-browser (100.x.x.x only)
Laptop (Tailscale) ─┘
```

No Cloudflare tunnel. No proxy. No relay. Direct encrypted connections only.

## Machines

| Machine | Tailscale IP | MagicDNS | Role |
|---------|-------------|----------|------|
| 3400 (latitude) | `100.91.68.37` | `alphons-latitude3400.tail9ef77f.ts.net` | Primary |
| g5 (desktop) | `100.107.158.12` | `alphons-g55500.tail9ef77f.ts.net` | Remote |

## Changes

### 1. Server Bind Address

**Current:** `server/index.js` binds HTTP and HTTPS to `0.0.0.0` (all interfaces).

**New:** Bind to a specific IP via `BIND` environment variable.

- `BIND=100.91.68.37` — only Tailscale interface
- No default fallback to `0.0.0.0`. The `BIND` variable is required. If not set, the server refuses to start with a clear error message.
- Both HTTP and HTTPS servers bind to the same address.
- The systemd unit sets `Environment=BIND=<tailscale-ip>`.

### 2. Remove AppNetwork Local Fast-Path

**Current:** `public/js/app-network.js` probes local LAN IPs (`192.168.x.x`) and races them against the tunnel URL to find the fastest connection path. Switches between "local" and "tunnel" modes with toasts.

**Remove entirely.** Tailscale handles routing — devices on the same LAN connect directly (no relay), devices across networks use Tailscale's DERP relay. The fast-path optimization is redundant.

**What gets removed:**
- `public/js/app-network.js` — delete the file
- All references to `AppNetwork` in `app.js`, `terminal.js`, `server-manager.js`
- The `GET /api/network` endpoint in `server/routes.js` (exposes local IPs — security risk, no longer needed)
- The connection mode indicator (house/globe icon) in the UI
- The "setup local" link and `setup-local.html` if it exists
- `localStorage` keys: `tui_local_origin`

**What replaces it:**
- WebSocket URLs are constructed directly from `window.location` (for HOST) or from `ServerManager.getOrigin(serverName)` (for remotes)
- No mode switching, no toasts, no probing

### 3. Simplify ServerManager Connection Resolution

**Current:** `server-manager.js` `resolveServer()` fetches `/api/network` from each remote server, gets its local IPs, races them against the configured URL to find the fastest path.

**New:** `resolveServer()` simply checks if the configured URL is reachable via `/api/identity`. No IP racing, no local path detection. The Tailscale IP in the config IS the direct path.

**Remove:**
- `fetchNetworkInfo()` function
- `fetchLocalIPs()` function and its export
- Local IP racing logic in `resolveServer()`
- `state.localIPs` field
- `state.mode` field (always direct — no "local" vs "url" distinction)
- Settings panel "Sync" button that fetched local IPs

### 4. Remove Cloudflare Tunnel References

- Remove any tunnel-related setup in `install.sh`
- Remove tunnel URL references from documentation
- Update `data/servers.json` to use Tailscale IPs or MagicDNS hostnames

### 5. Remove Connection Mode UI

**Current:** House icon (LAN) or globe icon (tunnel) shown in dashboard header and per-server sections.

**Remove:** No mode distinction exists anymore. All connections are Tailscale direct. Remove the `#connection-mode` element, `updateConnectionMode()`, and related CSS.

### 6. Update `install.sh`

- Prompt for Tailscale IP (or auto-detect via `tailscale ip -4`)
- Set `BIND` in the systemd unit's `Environment=` line
- Remove Cloudflare tunnel setup if any exists
- Remove HTTPS cert generation prompts. Tailscale handles encryption via WireGuard, so HTTP on the Tailscale IP is already encrypted end-to-end. The HTTPS server code stays in `index.js` (no removal) but certs are no longer generated during install. If certs already exist, HTTPS still works.
- Verify Tailscale is installed and running before proceeding

### 7. CORS Simplification

**Current:** Echoes any `Origin` header back in `Access-Control-Allow-Origin`.

**New:** No CORS headers needed. All servers are accessed directly by the browser at their own Tailscale IP — no cross-origin requests. Remove the CORS middleware entirely.

### 8. Security Headers

Add minimal hardening headers to all responses:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Cache-Control: no-store` for API responses

No new dependencies needed — just a small middleware function.

### 9. Update README and Documentation

- Remove all Cloudflare tunnel references, setup instructions, and architecture mentions from `README.md`
- Replace with Tailscale as the required networking layer
- Document Tailscale as a prerequisite (install + `tailscale up` before running `install.sh`)
- Update architecture diagram to show Tailscale mesh instead of tunnel/LAN dual-path
- Update the multi-server setup section to use Tailscale IPs/MagicDNS hostnames instead of tunnel URLs
- Remove any "local fast-path" documentation (no longer exists)
- Remove connection mode (house/globe) documentation

### 10. Enforce Tailscale in `install.sh`

`install.sh` must verify Tailscale is installed and active before proceeding:
- Check `tailscale status` succeeds — if not, print instructions and exit
- Auto-detect Tailscale IP via `tailscale ip -4`
- Use detected IP as the `BIND` address in the systemd unit
- Refuse to proceed without a valid Tailscale IP

### 11. Firewall (Documentation Only)

Document the recommended `ufw` rules:
```
ufw deny 7483    # block HTTP on all interfaces
ufw deny 7484    # block HTTPS on all interfaces
```
Not strictly necessary since the server won't bind to non-Tailscale interfaces, but defense in depth.

## What Does NOT Change

- Terminal WebSocket protocol (binary PTY data)
- Dashboard polling and rendering
- Session CRUD API endpoints
- File browser API endpoints
- Multi-server federation (ServerManager, server groups, collapsible sections)
- Settings panel (minus the Sync button and local IP display)
- tmux/Kitty discovery
- Auto-update mechanism between servers

## Security Posture After This Change

| Threat | Mitigation |
|--------|------------|
| Internet attacker finds the port | Server doesn't bind to public interface. Port doesn't exist. |
| LAN attacker (same WiFi) | Server doesn't bind to LAN interface. Only Tailscale. |
| Tailscale account compromise | Attacker needs access to user's Tailscale account AND a device on the network. |
| Physical device access | Same risk as any app on an unlocked device. Out of scope. |
| MITM on network | WireGuard encryption. Tailscale handles key exchange. |
| `/api/network` leaking IPs | Endpoint removed entirely. |

## Non-Goals

- Per-user accounts or access control
- Application-level authentication (tokens, passwords, cookies)
- Audit logging
- Rate limiting (only trusted devices can connect)
