FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# v1.11.56: switch from nginx:alpine (root) to nginx-unprivileged (UID 101).
# This is the official NGINX non-root image — it listens on 8080 instead of
# 80, removes the `user` directive from the main nginx.conf, moves the PID
# file to /tmp/nginx.pid, and points all *_temp_path dirs at /tmp. Combined
# with the docker-compose `APP_PORT: 8080` change, this makes the UI the
# final SoloStrike container to run as non-root. We only override
# conf.d/default.conf (server block), so the unprivileged base's main
# nginx.conf — which handles pid/temp paths — stays intact.
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
# CMD inherited from nginx-unprivileged base image (nginx -g 'daemon off;')
