FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    build-essential git autoconf automake libtool pkg-config \
    libjansson-dev libzmq3-dev libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/ckolivas/ckpool.git /ckpool-src
WORKDIR /ckpool-src
RUN autoreconf -fi && ./configure && make -j$(nproc)

FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    libjansson4 libzmq5 libcurl4 netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /ckpool-src/src/ckpool /usr/local/bin/ckpool
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
RUN mkdir -p /etc/ckpool /var/log/ckpool

EXPOSE 3333 3334
ENTRYPOINT ["/entrypoint.sh"]
