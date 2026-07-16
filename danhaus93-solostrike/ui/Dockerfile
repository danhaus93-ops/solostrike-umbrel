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
# v3.2.0: store-agnostic config. nginx-unprivileged inherits the official
# image's entrypoint, which runs /docker-entrypoint.d/20-envsubst-on-templates.sh:
# it renders /etc/nginx/templates/*.template -> /etc/nginx/conf.d/* at container
# start. Only env names matching NGINX_ENVSUBST_FILTER are substituted, so
# nginx's own runtime vars ($host, $uri, $remote_addr...) survive untouched.
# API_HOST is supplied per-store by docker-compose (the container name differs
# between the community app id and the official 'lonestrike' id).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER="^API_HOST$"

# That render SKIPS SILENTLY (logs, returns 0) if the output dir isn't writable
# by the runtime user — see docker-nginx-unprivileged#88. If that happened we'd
# be left serving the base image's default.conf (the nginx welcome page) instead
# of the UI, with no error. Delete that default and guarantee writability, so a
# rendered template is the ONLY possible source of a server block: any failure
# is then loud instead of a silently-wrong app.
USER root
RUN rm -f /etc/nginx/conf.d/default.conf \
    && chown -R 101:0 /etc/nginx/conf.d \
    && chmod -R g+w /etc/nginx/conf.d
USER 101
EXPOSE 8080
# CMD inherited from nginx-unprivileged base image
