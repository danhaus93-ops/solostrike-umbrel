# syntax=docker/dockerfile:1

# Stage 1: Compile the Bun app into a static binary for the target platform
FROM oven/bun:1.2 AS builder
ARG TARGETPLATFORM
WORKDIR /build

# Install deps (no lockfile required — we have no runtime deps anyway)
COPY package.json ./
RUN bun install || true

# Copy source
COPY . .

# Select the correct Bun compile target based on Docker buildx platform
RUN set -ex; \
    case "$TARGETPLATFORM" in \
      "linux/amd64") BUN_TARGET="bun-linux-x64-modern" ;; \
      "linux/arm64") BUN_TARGET="bun-linux-arm64" ;; \
      *) echo "Unsupported platform: $TARGETPLATFORM" && exit 1 ;; \
    esac; \
    bun build ./index.ts --compile --target=$BUN_TARGET --outfile=/build/server

# Stage 2: Minimal distroless runtime
FROM gcr.io/distroless/base-debian12
COPY --from=builder /build/server /server
EXPOSE 3000
ENTRYPOINT ["/server"]
