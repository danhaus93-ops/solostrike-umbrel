#!/bin/sh
# SoloStrike API entrypoint
# v1.11.53: starts as root to fix permissions on mounted volumes (needed for
# users upgrading from v1.11.52 where the container ran as root), then drops
# privileges via su-exec and runs the actual app as the 'node' user (UID 1000).

set -e

# Directories that need writable ownership for the node user
DIRS_TO_OWN="/app/config /var/log/ckpool /etc/ckpool"

# Only fix permissions if we're currently root (init) — saves time on every restart
if [ "$(id -u)" = "0" ]; then
    for d in $DIRS_TO_OWN; do
        if [ -d "$d" ]; then
            # Only chown if not already owned by node user (1000)
            current_uid=$(stat -c %u "$d" 2>/dev/null || echo "0")
            if [ "$current_uid" != "1000" ]; then
                chown -R node:node "$d" 2>/dev/null || true
            fi
        fi
    done

    # Now drop privileges and exec the actual process as node user
    exec su-exec node:node node src/server.js
else
    # Already non-root (e.g., compose-level user override) — just exec
    exec node src/server.js
fi
