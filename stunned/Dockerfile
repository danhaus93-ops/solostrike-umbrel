FROM alpine:3.20

RUN apk add --no-cache stunnel openssl ca-certificates

# The entrypoint generates a self-signed cert on first run if one doesn't exist,
# then starts stunnel in the foreground for Docker.
COPY entrypoint.sh /entrypoint.sh
COPY stunnel.conf /etc/stunnel/stunnel.conf
RUN chmod +x /entrypoint.sh

# stunnel needs to write its PID file; keep the config pointed at /run
RUN mkdir -p /run/stunnel && chown -R nobody:nobody /run/stunnel

EXPOSE 4333

ENTRYPOINT ["/entrypoint.sh"]
