FROM node:20-alpine

# Install build deps + su-exec (lightweight privilege-dropping tool)
RUN apk add --no-cache wget python3 make g++ zeromq-dev su-exec

WORKDIR /app

# Copy package.json and install deps as root (faster, no perms issues during build)
COPY package.json ./
RUN npm install --production

# Copy source
COPY src/ ./src/

# v1.11.53: Copy entrypoint that handles perm fixes and drops to node user
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create directories the app writes to, pre-owned by node user.
# Volume mounts at runtime can override ownership; entrypoint will chown if needed.
RUN mkdir -p /var/log/ckpool /etc/ckpool /app/config && \
    chown -R node:node /var/log/ckpool /etc/ckpool /app/config /app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- --timeout=5 http://localhost:3001/api/health || exit 1

# v1.11.53: entrypoint starts as root briefly (to fix mounted volume perms for
# users upgrading from older versions where container ran as root), then uses
# su-exec to drop to 'node' user (UID 1000) before running the app.
# This gives us non-root execution while handling the upgrade-path edge case
# gracefully. With security_opt: no-new-privileges:true in compose, the brief
# root window cannot be exploited to gain elevated kernel capabilities.

ENTRYPOINT ["/entrypoint.sh"]
