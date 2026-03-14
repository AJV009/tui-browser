#!/bin/bash
# Generate self-signed cert for local HTTPS access
# Includes all current local IPv4 addresses as SANs

set -e

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERT_DIR"

# Collect local IPs
LOCAL_IPS=$(ip -4 addr show | grep 'inet ' | awk '{print $2}' | cut -d/ -f1 | grep -v '^127\.' || hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$')

# Build SAN list
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

echo "Certificate generated in $CERT_DIR"
echo "SANs: $SAN"
echo ""
echo "To trust on your phone (one-time):"
echo "  Visit https://<local-ip>:7484 and accept the certificate warning"
