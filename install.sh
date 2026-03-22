#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
YELLOW='\033[1;33m'
GREEN='\033[1;32m'
CYAN='\033[1;36m'
RED='\033[1;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[x]${NC} $*"; }
step()  { echo -e "${CYAN}==> $*${NC}"; }

# ──────────────────────────────────────────────
step "Checking dependencies"
# ──────────────────────────────────────────────

missing=()
command -v node  >/dev/null || missing+=(node)
command -v npm   >/dev/null || missing+=(npm)
command -v tmux  >/dev/null || missing+=(tmux)

if [ ${#missing[@]} -gt 0 ]; then
  err "Missing required dependencies: ${missing[*]}"
  echo "  Install them before running this script."
  exit 1
fi

info "node $(node --version), npm $(npm --version), tmux $(tmux -V)"

# Optional
if command -v kitty >/dev/null; then
  info "kitty found (optional Kitty integration available)"
  HAS_KITTY=1
else
  warn "kitty not found — Kitty integration will be skipped"
  HAS_KITTY=0
fi

# ──────────────────────────────────────────────
step "Installing npm dependencies"
# ──────────────────────────────────────────────

cd "$SCRIPT_DIR"
npm install --production

# ──────────────────────────────────────────────
step "Setting up tmux-kitty-shell wrapper"
# ──────────────────────────────────────────────

mkdir -p ~/.local/bin
cp "$SCRIPT_DIR/scripts/tmux-kitty-shell" ~/.local/bin/tmux-kitty-shell
chmod +x ~/.local/bin/tmux-kitty-shell
info "Installed ~/.local/bin/tmux-kitty-shell"

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

# ──────────────────────────────────────────────
step "Setting up tmux configuration"
# ──────────────────────────────────────────────

TMUX_CONF="$HOME/.tmux.conf"
MARKER="# --- tui-browser managed ---"

# Check if we already wrote our block
if [ -f "$TMUX_CONF" ] && grep -qF "$MARKER" "$TMUX_CONF"; then
  info "tmux.conf already configured (found marker), skipping"
else
  if [ -f "$TMUX_CONF" ]; then
    warn "Existing ~/.tmux.conf found — appending TUI Browser settings"
  fi
  cat >> "$TMUX_CONF" <<'TMUXEOF'

# --- tui-browser managed ---
# Terminal capabilities
set -g default-terminal "tmux-256color"
set -ag terminal-overrides ",xterm-kitty:RGB"
set -g allow-passthrough on
set -sg escape-time 0
set -g extended-keys on
set -as terminal-features 'xterm*:extkeys'

# UTF-8 support
set-window-option -q -g utf8 on

# Size to the most recently active client, not the smallest
set -g window-size latest
set -g aggressive-resize on

# Mouse support
set -g mouse on

# Hide status bar (tui-browser provides its own UI)
set -g status off

# Forward pane titles to kitty
set -g set-titles on
set -g set-titles-string '#T'

# Keep windows alive after process exit
set -g remain-on-exit on

# Cursor shape passthrough (blinking beam)
set -ga terminal-overrides ',*:Ss=\E[%p1%d q:Se=\E[5 q'

# Clipboard and events
set -g set-clipboard on
set -g focus-events on
# --- end tui-browser managed ---
TMUXEOF
  info "Wrote tmux settings to $TMUX_CONF"
fi

# ──────────────────────────────────────────────
step "Setting up systemd user service"
# ──────────────────────────────────────────────

SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"

# Detect node path (Volta, nvm, or system)
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"

cat > "$SERVICE_DIR/tui-browser.service" <<SVCEOF
[Unit]
Description=TUI Browser — terminal mirroring server
After=network.target

[Service]
Type=simple
WorkingDirectory=$SCRIPT_DIR
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
Environment=HOME=$HOME
Environment=LANG=en_IN.UTF-8
Environment=LC_ALL=en_IN.UTF-8
Environment=PORT=7483
ExecStart=$NODE_BIN $SCRIPT_DIR/server/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
SVCEOF

info "Created $SERVICE_DIR/tui-browser.service"

# File watcher — auto-restart on code changes
cat > "$SERVICE_DIR/tui-browser-watch.path" <<WPEOF
[Unit]
Description=Watch TUI Browser source files for changes

[Path]
PathModified=$SCRIPT_DIR/server
PathModified=$SCRIPT_DIR/public/js
PathModified=$SCRIPT_DIR/public/css

[Install]
WantedBy=default.target
WPEOF

cat > "$SERVICE_DIR/tui-browser-watch.service" <<WSEOF
[Unit]
Description=Restart TUI Browser on file changes

[Service]
Type=oneshot
ExecStart=systemctl --user restart tui-browser.service
WSEOF

info "Created file watcher (auto-restart on code changes)"

# Reload systemd and enable everything
systemctl --user daemon-reload
systemctl --user enable tui-browser.service
systemctl --user enable tui-browser-watch.path
info "Service + watcher enabled (will start on boot)"

# Enable lingering so the service runs before login
if command -v loginctl >/dev/null; then
  loginctl enable-linger "$(whoami)" 2>/dev/null || true
  info "Linger enabled — service will start at boot, even before login"
fi

# ──────────────────────────────────────────────
step "Starting the service"
# ──────────────────────────────────────────────

systemctl --user restart tui-browser.service
systemctl --user restart tui-browser-watch.path
sleep 1

if systemctl --user is-active --quiet tui-browser.service; then
  info "TUI Browser is running!"
  echo ""
  echo -e "  ${GREEN}http://localhost:7483${NC}"
  echo ""
else
  err "Service failed to start. Check logs with:"
  echo "  journalctl --user -u tui-browser.service -n 20"
fi

# ──────────────────────────────────────────────
step "Service management commands"
# ──────────────────────────────────────────────

echo ""
echo "  Start:   systemctl --user start tui-browser"
echo "  Stop:    systemctl --user stop tui-browser"
echo "  Restart: systemctl --user restart tui-browser"
echo "  Logs:    journalctl --user -u tui-browser -f"
echo "  Status:  systemctl --user status tui-browser"
echo ""

# ──────────────────────────────────────────────
# Manual steps (printed, not automated)
# ──────────────────────────────────────────────

echo ""
echo -e "${YELLOW}════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  MANUAL SETUP REQUIRED${NC}"
echo -e "${YELLOW}════════════════════════════════════════════════════════${NC}"
echo ""

if [ "$HAS_KITTY" -eq 1 ]; then
  KITTY_CONF="$HOME/.config/kitty/kitty.conf"
  echo -e "  ${CYAN}1. Kitty config${NC} ($KITTY_CONF)"
  echo ""

  # Check if already configured
  if [ -f "$KITTY_CONF" ] && grep -qF "tmux-kitty-shell" "$KITTY_CONF"; then
    echo -e "     ${GREEN}Already configured!${NC}"
  else
    echo "     Add/change these lines:"
    echo ""
    echo -e "     ${GREEN}allow_remote_control yes${NC}"
    echo -e "     ${GREEN}listen_on unix:/tmp/kitty-socket${NC}"
    echo -e "     ${GREEN}shell $HOME/.local/bin/tmux-kitty-shell${NC}"
    echo ""
    echo "     Then restart Kitty for changes to take effect."
  fi
else
  echo "  Kitty not installed — skip Kitty config."
fi

echo ""
echo -e "  ${CYAN}2. Locale (if Unicode looks broken)${NC}"
echo ""
echo "     Add to your ~/.zshrc or ~/.bashrc:"
echo ""
echo -e "     ${GREEN}export LANG=en_IN.UTF-8${NC}"
echo -e "     ${GREEN}export LC_ALL=en_IN.UTF-8${NC}"
echo ""
echo -e "${YELLOW}════════════════════════════════════════════════════════${NC}"
echo ""
info "Setup complete!"
