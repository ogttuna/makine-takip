# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src

ARG VITE_COLLECTOR_URL=""
ENV VITE_COLLECTOR_URL=${VITE_COLLECTOR_URL}
RUN npm run build

FROM rust:1.95.0-bookworm AS collector-build
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY collector ./collector
COPY migrations ./migrations
COPY src-tauri ./src-tauri

RUN cargo build --locked --release -p collector

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 makinetakip \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin makinetakip

WORKDIR /app
COPY --from=collector-build /app/target/release/collector /usr/local/bin/collector
COPY --from=frontend-build /app/dist ./dist

RUN mkdir -p /data \
    && chown -R makinetakip:makinetakip /app /data

USER makinetakip

ENV FREEZEDRY_BIND_ADDR=0.0.0.0:4777 \
    FREEZEDRY_DB_URL=sqlite:///data/freezedry.db \
    RUST_LOG=collector=info,tower_http=info

EXPOSE 4777

ENTRYPOINT ["collector"]

FROM alpine:3.22 AS backup-runtime

RUN apk add --no-cache sqlite
COPY docker/sqlite-backup.sh /usr/local/bin/sqlite-backup
RUN chmod 0755 /usr/local/bin/sqlite-backup

ENTRYPOINT ["/usr/local/bin/sqlite-backup"]
