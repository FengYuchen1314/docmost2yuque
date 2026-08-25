#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
    printf 'usage: %s IMAGE_ARCHIVE CHECKSUM_FILE IMAGE_REF PROJECT_ROOT\n' "$0" >&2
    exit 2
fi

image_archive="$1"
checksum_file="$2"
image_ref="$3"
project_root="$4"
compose_project="${COMPOSE_PROJECT_NAME:-docmost2yuque}"

if [[ ! -f "$image_archive" || ! -f "$checksum_file" ]]; then
    printf 'image archive or checksum file is missing\n' >&2
    exit 2
fi

if [[ ! "$image_ref" =~ ^docmost2yuque-web:[0-9a-f]{40}$ ]]; then
    printf 'image reference must be a commit-addressed docmost2yuque web image\n' >&2
    exit 2
fi

project_root="$(realpath "$project_root")"
compose_file="$project_root/deploy/docker-compose.yml"
environment_file="$project_root/deploy/.env"

if [[ ! -f "$compose_file" || ! -f "$environment_file" ]]; then
    printf 'the deployment directory does not contain the expected Compose files\n' >&2
    exit 2
fi

expected_checksum="$(awk 'NR == 1 { print $1 }' "$checksum_file")"
actual_checksum="$(sha256sum "$image_archive" | awk '{ print $1 }')"
if [[ ! "$expected_checksum" =~ ^[0-9a-f]{64}$ || "$expected_checksum" != "$actual_checksum" ]]; then
    printf 'web image archive checksum verification failed\n' >&2
    exit 1
fi

base_compose=(
    docker compose
    --project-name "$compose_project"
    --env-file "$environment_file"
    --file "$compose_file"
)

current_container="$("${base_compose[@]}" ps -q web)"
if [[ -z "$current_container" ]]; then
    printf 'the currently deployed web container was not found\n' >&2
    exit 1
fi

previous_image="$(docker inspect --format '{{.Config.Image}}' "$current_container")"
deployment_started=false
umask 077
override_file="$(mktemp /tmp/docmost2yuque-web-override.XXXXXX.yml)"
printf '%s\n' \
    'services:' \
    '  web:' \
    '    image: "${WEB_IMAGE:?WEB_IMAGE must be set}"' > "$override_file"
compose=("${base_compose[@]}" --file "$override_file")

rollback() {
    if [[ "$deployment_started" == true && -n "$previous_image" ]]; then
        printf 'rolling the web service back to %s\n' "$previous_image" >&2
        WEB_IMAGE="$previous_image" "${compose[@]}" up \
            --detach \
            --no-deps \
            --no-build \
            --wait \
            --wait-timeout 120 \
            web >&2 || true
    fi
}

cleanup() {
    exit_code=$?
    if (( exit_code != 0 )); then
        rollback
    fi
    rm -f -- "$image_archive" "$checksum_file" "$override_file"
    exit "$exit_code"
}
trap cleanup EXIT

gzip --decompress --stdout -- "$image_archive" | docker load
docker image inspect "$image_ref" >/dev/null

WEB_IMAGE="$image_ref" "${compose[@]}" config --quiet
deployment_started=true
WEB_IMAGE="$image_ref" "${compose[@]}" up \
    --detach \
    --no-deps \
    --no-build \
    --wait \
    --wait-timeout 120 \
    web

new_container="$(WEB_IMAGE="$image_ref" "${compose[@]}" ps -q web)"
if [[ -z "$new_container" ]]; then
    printf 'the replacement web container was not created\n' >&2
    exit 1
fi

published_address="$(WEB_IMAGE="$image_ref" "${compose[@]}" port web 8080 | head -n 1)"
published_port="${published_address##*:}"
if [[ ! "$published_port" =~ ^[0-9]+$ ]]; then
    printf 'could not determine the published web port\n' >&2
    exit 1
fi

ready=false
for _ in {1..30}; do
    if curl --fail --silent --show-error --output /dev/null \
        --max-time 5 "http://127.0.0.1:$published_port/"; then
        ready=true
        break
    fi
    sleep 2
done

if [[ "$ready" != true ]]; then
    printf 'the replacement web service did not pass its HTTP readiness check\n' >&2
    exit 1
fi

deployment_started=false
printf 'WEB_DEPLOYMENT_READY image=%s previous=%s\n' "$image_ref" "$previous_image"
