FROM node:20-alpine
RUN apk add --no-cache wget python3 make g++ zeromq-dev
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
RUN mkdir -p /var/log/ckpool /etc/ckpool /app/config
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- --timeout=5 http://localhost:3001/api/health || exit 1
CMD ["node", "src/server.js"]
