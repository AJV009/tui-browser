#!/bin/bash
# Generate TLS certificates for local HTTPS fast-path
# Uses mkcert (preferred) or falls back to openssl self-signed

set -e

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
PUBLIC_DIR="$(cd "$(dirname "$0")/.." && pwd)/public"
mkdir -p "$CERT_DIR"

# Collect local IPs
LOCAL_IPS=$(ip -4 addr show 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1 | grep -v '^127\.' || hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$')

if command -v mkcert &>/dev/null; then
  echo "Using mkcert for trusted certificates..."

  # Install CA if not yet done
  if [ ! -f "$(mkcert -CAROOT)/rootCA.pem" ]; then
    mkcert -install 2>/dev/null || echo "Note: run 'sudo mkcert -install' to trust CA system-wide"
  fi

  # Generate cert for all local IPs
  mkcert -cert-file "$CERT_DIR/server.crt" -key-file "$CERT_DIR/server.key" \
    localhost 127.0.0.1 $LOCAL_IPS

  # Copy CA cert to public dir for easy phone download
  cp "$(mkcert -CAROOT)/rootCA.pem" "$PUBLIC_DIR/tui-browser-ca.crt"

  echo ""
  echo "To trust on Android/iOS (one-time):"
  echo "  1. Open https://tui.yourdomain.com/tui-browser-ca.crt on your phone"
  echo "  2. Android: Settings > Security > Install certificate > CA certificate"
  echo "  3. iOS: Settings > Profile Downloaded > Install > Trust"
  echo ""
else
  echo "Using openssl (self-signed, browsers will show warnings)..."

  SAN="DNS:localhost,IP:127.0.0.1"
  for ip in $LOCAL_IPS; do
    SAN="$SAN,IP:$ip"
  done

  openssl req -x509 -newkey rsa:2048 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -days 365 -nodes \
    -subj "/CN=TUI Browser/O=TUI Browser" \
    -addext "subjectAltName=$SAN" 2>/dev/null
fi

echo "Certificates in $CERT_DIR"
echo "Local IPs: $LOCAL_IPS"
