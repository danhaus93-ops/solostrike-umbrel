#!/bin/sh
# SoloStrike stunnel entrypoint
# Generates a self-signed TLS cert on first run, then launches stunnel.
#
# Cert lives in /certs which is mounted from the Umbrel app-data volume,
# so it persists across container restarts and upgrades.

set -e

CERT_DIR="/certs"
CERT_FILE="$CERT_DIR/stunnel.pem"

mkdir -p "$CERT_DIR"
chmod 755 "$CERT_DIR"

if [ ! -f "$CERT_FILE" ]; then
    echo "[stunnel] Generating self-signed TLS certificate (valid 10 years)..."
    openssl req -new -x509 \
        -newkey rsa:2048 \
        -keyout /tmp/stunnel.key \
        -out /tmp/stunnel.crt \
        -days 3650 \
        -nodes \
        -subj "/CN=solostrike.local/O=SoloStrike/OU=ckpool-solo"

    # stunnel expects key + cert concatenated in a single .pem file
    cat /tmp/stunnel.key /tmp/stunnel.crt > "$CERT_FILE"
    chmod 600 "$CERT_FILE"
    chown nobody:nobody "$CERT_FILE"
    rm -f /tmp/stunnel.key /tmp/stunnel.crt

    echo "[stunnel] Certificate generated at $CERT_FILE"
else
    echo "[stunnel] Reusing existing certificate at $CERT_FILE"
    chown nobody:nobody "$CERT_FILE" 2>/dev/null || true
fi

# Make sure the stunnel pid dir is writable by nobody (for setuid drop)
chown -R nobody:nobody /run/stunnel

echo "[stunnel] Starting stunnel on :4333 → ckpool:3333"
exec stunnel /etc/stunnel/stunnel.conf
