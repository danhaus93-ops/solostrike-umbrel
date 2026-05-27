#!/bin/sh
# SoloStrike stunnel entrypoint
# v1.11.53: container runs as nobody from start (USER nobody in Dockerfile).
# /run/stunnel and /certs are pre-chowned to nobody:nobody in Dockerfile,
# so this script doesn't need root for any setup.

set -e

CERT_DIR="/certs"
CERT_FILE="$CERT_DIR/stunnel.pem"

if [ ! -f "$CERT_FILE" ]; then
    echo "[stunnel] Generating self-signed TLS certificate (valid 10 years)..."
    openssl req -new -x509 \
        -newkey rsa:2048 \
        -keyout /tmp/stunnel.key \
        -out /tmp/stunnel.crt \
        -days 3650 \
        -nodes \
        -subj "/CN=solostrike.local/O=SoloStrike/OU=ckpool-solo"

    cat /tmp/stunnel.key /tmp/stunnel.crt > "$CERT_FILE"
    chmod 600 "$CERT_FILE"
    rm -f /tmp/stunnel.key /tmp/stunnel.crt

    echo "[stunnel] Certificate generated at $CERT_FILE"
else
    echo "[stunnel] Reusing existing certificate at $CERT_FILE"
fi

echo "[stunnel] Starting stunnel on :4333 → ckpool:3333 (as nobody)"
exec stunnel /etc/stunnel/stunnel.conf
