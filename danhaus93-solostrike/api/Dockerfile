FROM node:20-alpine

RUN apk add --no-cache wget python3 make g++ zeromq-dev

WORKDIR /app

# Copy package.json with node user ownership
COPY --chown=node:node package.json ./
RUN npm install --production

# Copy source with node user ownership
COPY --chown=node:node src/ ./src/

# Pre-create directories the app writes to, owned by node user.
# Volume mounts at runtime will need host directories owned by UID 1000.
# (For users upgrading from v1.11.52: uninstall + reinstall is required.)
RUN mkdir -p /var/log/ckpool /etc/ckpool /app/config && \
    chown -R node:node /var/log/ckpool /etc/ckpool /app/config

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- --timeout=5 http://localhost:3001/api/health || exit 1

# v1.11.53: pure non-root execution. UID 1000 (node user, built into node:alpine).
USER node

CMD ["node", "src/server.js"]
