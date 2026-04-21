# syntax=docker/dockerfile:1

# Single-stage: use the official Bun slim image as both build and runtime.
# On native arm64 runners this gives us a native arm64 bun; on amd64 runners,
# a native amd64 bun. No cross-compilation required.
FROM oven/bun:1-slim

WORKDIR /app

# Copy manifest first for layer caching
COPY package.json ./

# No runtime deps in this server, but running install creates an empty
# node_modules so bun can resolve types cleanly. Ignore failures since
# @types/bun is a dev dep only and the runtime doesn't need it.
RUN bun install --production || true

# Copy the rest of the source
COPY . .

# The widget server listens on 3000 internally
EXPOSE 3000

# Drop the default root user provided by the bun image
USER bun

# Run directly with bun — no compile step needed
CMD ["bun", "run", "index.ts"]
