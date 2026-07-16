#!/bin/sh
# LoneStrike stunnel entrypoint
# v1.11.53: container runs as nobody from start (USER nobody in Dockerfile).
# /run/stunnel and /certs are pre-chowned to nobody:nobody in Dockerfile,
# so this script doesn't need root for any setup.

set -e

# v3.2.0: CKPOOL_HOST is the FULL container name of our ckpool (differs per store:
# danhaus93-solostrike_ckpool_1 vs lonestrike_ckpool_1). Required — fail loudly
# rather than silently forwarding miners to a bare "ckpool" alias that may belong
# to another app on the shared Umbrel network.
: "${CKPOOL_HOST:?CKPOOL_HOST env var is required (set it in docker-compose.yml)}"

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
        -subj "/CN=lonestrike.local/O=LoneStrike/OU=ckpool-solo"

    cat /tmp/stunnel.key /tmp/stunnel.crt > "$CERT_FILE"
    chmod 600 "$CERT_FILE"
    rm -f /tmp/stunnel.key /tmp/stunnel.crt

    echo "[stunnel] Certificate generated at $CERT_FILE"
else
    echo "[stunnel] Reusing existing certificate at $CERT_FILE"
fi

# Render the config template. Runs as nobody, so write to /tmp (world-writable);
# /etc/stunnel is read-only to this user.
sed "s|@CKPOOL_HOST@|${CKPOOL_HOST}|g" /etc/stunnel/stunnel.conf.template > /tmp/stunnel.conf

echo "[stunnel] Starting stunnel on :4333 → ${CKPOOL_HOST}:3333 (as nobody)"
exec stunnel /tmp/stunnel.conf
