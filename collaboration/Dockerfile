# syntax=docker/dockerfile:1.7
FROM rust:1.90-bookworm AS build
WORKDIR /source
COPY collaboration/ ./
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/source/target,sharing=locked \
    cargo build --release --package collab-server \
    && cp /source/target/release/collab-server /tmp/collab-server

FROM debian:bookworm-slim
RUN useradd --system --uid 10002 --create-home collab \
    && apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=collab:collab /tmp/collab-server /app/collab-server
USER collab
EXPOSE 8090
ENTRYPOINT ["/app/collab-server"]
