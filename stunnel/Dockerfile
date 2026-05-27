FROM alpine:3.20

RUN apk add --no-cache stunnel openssl ca-certificates

COPY entrypoint.sh /entrypoint.sh
COPY stunnel.conf /etc/stunnel/stunnel.conf
RUN chmod +x /entrypoint.sh

# Pre-create directories owned by nobody (the runtime user).
# Volume mounts at runtime need host /certs directory owned by UID 65534.
# (For users upgrading from v1.11.52: uninstall + reinstall is required.)
RUN mkdir -p /run/stunnel /certs && \
    chown -R nobody:nobody /run/stunnel /certs

EXPOSE 4333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD pgrep stunnel > /dev/null || exit 1

# v1.11.53: pure non-root execution. UID 65534 (nobody, built into alpine).
USER nobody

ENTRYPOINT ["/entrypoint.sh"]
