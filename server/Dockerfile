FROM node:20-alpine AS client-builder

WORKDIR /app

# Build utils
COPY utils ./utils
RUN cd utils && npm install && npm run build

# Build transport client
COPY transport/client ./transport/client
RUN cd transport/client && npm install && npm run build

# Build client
COPY client ./client
RUN cd client && npm install && npm run build

FROM rust:1.83-bookworm AS server-builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install sqlx-cli for migrations
RUN cargo install sqlx-cli --no-default-features --features postgres

# Copy transport dependency first
COPY transport ./transport

# Copy server files
COPY server ./server

# Build the server
WORKDIR /app/server
RUN cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary
COPY --from=server-builder /app/server/target/release/server /app/server

# Copy sqlx-cli for migrations
COPY --from=server-builder /usr/local/cargo/bin/sqlx /usr/local/bin/sqlx

# Copy migrations
COPY server/migrations /app/migrations

# Copy client dist
COPY --from=client-builder /app/client/dist /app/client/dist

# Create directories for uploads and avatars
RUN mkdir -p /app/uploads/avatars /app/uploads/channel_files /app/avatars /app/logs

# Create entrypoint script
RUN echo '#!/bin/sh\ncd /app && sqlx migrate run && exec /app/server' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 3000
EXPOSE 4443/udp

CMD ["/app/entrypoint.sh"]
