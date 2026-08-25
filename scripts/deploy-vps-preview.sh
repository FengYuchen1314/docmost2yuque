#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$project_root/deploy/docker-compose.yml"
environment_file="$project_root/deploy/.env"
public_base_url="${1:-${PUBLIC_BASE_URL:-}}"
if [[ -z "$public_base_url" ]]; then
  echo "Usage: $0 https://your-domain.example (or set PUBLIC_BASE_URL)" >&2
  exit 2
fi
http_port="${2:-8088}"
compose_project="${COMPOSE_PROJECT_NAME:-docmost2yuque}"

case "$public_base_url" in
    https://*) session_cookie_secure=true ;;
    http://*) session_cookie_secure=false ;;
    *)
        printf 'PUBLIC_BASE_URL must start with http:// or https://\n' >&2
        exit 2
        ;;
esac

if ! [[ "$http_port" =~ ^[0-9]+$ ]] || (( http_port < 1 || http_port > 65535 )); then
    printf 'HTTP port must be an integer between 1 and 65535\n' >&2
    exit 2
fi

if [[ ! -f "$environment_file" ]]; then
    command -v openssl >/dev/null 2>&1 || {
        printf 'openssl is required to generate deployment secrets\n' >&2
        exit 1
    }

    scratch="$(mktemp -d)"
    trap 'rm -f -- "$scratch/collaboration-key.pem" "$scratch/deploy.env"; rmdir -- "$scratch" 2>/dev/null || true' EXIT
    umask 077

    openssl genpkey -algorithm Ed25519 -out "$scratch/collaboration-key.pem" >/dev/null 2>&1
    database_password="$(openssl rand -base64 36 | tr -d '\n')"
    settings_master_key="$(openssl rand -base64 32 | tr -d '\n')"
    privacy_hash_key="$(openssl rand -base64 32 | tr -d '\n')"
    collaboration_private_key="$(openssl pkey -in "$scratch/collaboration-key.pem" -outform DER | tail -c 32 | base64 -w0)"
    collaboration_public_key="$(openssl pkey -in "$scratch/collaboration-key.pem" -pubout -outform DER | tail -c 32 | base64 -w0)"
    collaboration_internal_token="$(openssl rand -hex 32)"

    temporary_environment="$scratch/deploy.env"
    printf '%s\n' \
        "DATABASE_PASSWORD=$database_password" \
        "SETTINGS_MASTER_KEY=$settings_master_key" \
        "PRIVACY_HASH_KEY=$privacy_hash_key" \
        "COLLAB_TICKET_PRIVATE_KEY=$collaboration_private_key" \
        "COLLAB_TICKET_PUBLIC_KEY=$collaboration_public_key" \
        "COLLAB_INTERNAL_TOKEN=$collaboration_internal_token" \
        "PUBLIC_BASE_URL=$public_base_url" \
        "SESSION_COOKIE_SECURE=$session_cookie_secure" \
        "HTTP_PORT=$http_port" \
        "WORKER_ID=worker-1" >"$temporary_environment"
    install -m 0600 "$temporary_environment" "$environment_file"
fi

chmod 0600 "$environment_file"

docker compose \
    --project-name "$compose_project" \
    --env-file "$environment_file" \
    --file "$compose_file" \
    config --quiet

docker compose \
    --project-name "$compose_project" \
    --env-file "$environment_file" \
    --file "$compose_file" \
    build

docker compose \
    --project-name "$compose_project" \
    --env-file "$environment_file" \
    --file "$compose_file" \
    up --detach --remove-orphans --wait --wait-timeout 300

docker compose \
    --project-name "$compose_project" \
    --env-file "$environment_file" \
    --file "$compose_file" \
    ps

printf 'DEPLOYMENT_READY url=%s project=%s\n' "$public_base_url" "$compose_project"
