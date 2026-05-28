FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# v1.11.57: nginx-unprivileged (UID 101, listens 8080). The unprivileged base
# moves pid to /tmp/nginx.pid, drops the `user` directive, and points temp
# paths at /tmp in the MAIN nginx.conf (which we do NOT override). We only
# replace conf.d/default.conf with our server block (listen 8080). Paired with
# APP_PORT: 8080 in docker-compose. Makes the UI the last container to go
# non-root. Config + non-root runtime verified in sandbox (REST proxy + WS).
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
# CMD inherited from nginx-unprivileged base image
