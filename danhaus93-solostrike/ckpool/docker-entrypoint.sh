#!/bin/bash
set -e

CONFIG_FILE="/etc/ckpool/ckpool.conf"
LOG_DIR="/var/log/ckpool"

mkdir -p "$LOG_DIR" /etc/ckpool

echo "[SoloStrike] Waiting for Bitcoin Core at ${BITCOIN_RPC_HOST}:${BITCOIN_RPC_PORT}..."
until nc -z "${BITCOIN_RPC_HOST}" "${BITCOIN_RPC_PORT}" 2>/dev/null; do
  echo "[SoloStrike] Bitcoin Core not ready, retrying in 5s..."
  sleep 5
done
echo "[SoloStrike] Bitcoin Core is up!"

# If no config exists yet, write a placeholder.
# The API service can overwrite this later with the user's configured address.
if [ ! -f "$CONFIG_FILE" ]; then
  echo "[SoloStrike] No config found, writing default..."

  cat > "$CONFIG_FILE" <<EOF
{
  "btcd": [
    {
      "url": "http://${BITCOIN_RPC_HOST}:${BITCOIN_RPC_PORT}",
      "user": "${BITCOIN_RPC_USER}",
      "pass": "${BITCOIN_RPC_PASS}",
      "notify": true
    }
  ],
  "btcaddress": "bc1qexample0000000000000000000000000000000",
  "btcsig": "SoloStrike/",
  "blockpoll": 100,
  "nonce1length": 4,
  "nonce2length": 8,
  "update_interval": 30,
  "version_mask": "1fffe000",
  "logdir": "/var/log/ckpool",
  "serverurl": [
    "0.0.0.0:3333"
  ],
  "mindiff": 512,
  "startdiff": 512,
  "maxdiff": 0,
  "solo": true
}
EOF
fi

echo "[SoloStrike] Starting ckpool..."
exec ckpool --btcsolo --config "$CONFIG_FILE"
