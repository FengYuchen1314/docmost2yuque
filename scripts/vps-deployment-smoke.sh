#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Deployment smoke failed at line $LINENO" >&2' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$project_root/deploy/docker-compose.yml"
suffix="$(date +%s)-$$"
project="kp-deploy-smoke-$suffix"
scratch="$(mktemp -d /tmp/kp-deploy-smoke.XXXXXX)"

cleanup() {
  set +e
  docker compose -p "$project" -f "$compose_file" down -v --remove-orphans --rmi local >/dev/null 2>&1
  case "$scratch" in
    /tmp/kp-deploy-smoke.*) rm -rf -- "$scratch" ;;
  esac
}
trap cleanup EXIT

wait_for() {
  local description="$1"
  shift
  for _ in $(seq 1 90); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "Timed out waiting for $description" >&2
  return 1
}

openssl genpkey -algorithm Ed25519 -out "$scratch/collaboration-key.pem" >/dev/null 2>&1
http_port="$(python3 -c 'import socket; value=socket.socket(); value.bind(("127.0.0.1", 0)); print(value.getsockname()[1]); value.close()')"
export DATABASE_PASSWORD="deployment-smoke-$suffix"
export SETTINGS_MASTER_KEY="$(openssl rand -base64 32)"
export PRIVACY_HASH_KEY="$(openssl rand -base64 32)"
export COLLAB_TICKET_PRIVATE_KEY="$(openssl pkey -in "$scratch/collaboration-key.pem" -outform DER | tail -c 32 | base64 -w0)"
export COLLAB_TICKET_PUBLIC_KEY="$(openssl pkey -in "$scratch/collaboration-key.pem" -pubout -outform DER | tail -c 32 | base64 -w0)"
export COLLAB_INTERNAL_TOKEN="$(openssl rand -base64 32)"
export SESSION_COOKIE_SECURE=false
export PUBLIC_BASE_URL="http://127.0.0.1:$http_port"
export HTTP_PORT="127.0.0.1:$http_port"

docker compose -p "$project" -f "$compose_file" config -q
docker compose -p "$project" -f "$compose_file" up -d --build --wait --wait-timeout 240

base_url="http://127.0.0.1:$http_port"
wait_for "web-proxied API health" curl -fsS "$base_url/actuator/health"
health="$(curl -fsS "$base_url/actuator/health")"
[[ "$health" == *'"status":"UP"'* ]]

index_headers="$(curl -fsSI "$base_url/")"
grep -qi '^x-content-type-options: nosniff' <<<"$index_headers"
grep -qi '^cache-control: no-cache' <<<"$index_headers"
grep -qi '^content-security-policy:.*img-src.*https:' <<<"$index_headers"
grep -qi '^content-security-policy:.*media-src.*https:' <<<"$index_headers"
grep -qi '^content-security-policy:.*frame-src.*youtube.com' <<<"$index_headers"

asset_path="$(curl -fsS "$base_url/" | grep -oE '/assets/[^"'\'' ]+\.js' | head -n 1)"
[[ -n "$asset_path" ]]
asset_headers="$(curl -fsSI "$base_url$asset_path")"
grep -qi '^cache-control: max-age=31536000' <<<"$asset_headers"

# A request above the old 25MB edge limit must reach the API. The payload is
# deliberately not a valid authenticated multipart upload; any API response is
# acceptable, but an Nginx 413 is not.
large_request_status="$(head -c $((26 * 1024 * 1024)) /dev/zero | curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/octet-stream' --data-binary @- "$base_url/api/v1/attachments/upload")"
[[ "$large_request_status" != "413" ]]

api_container="$(docker compose -p "$project" -f "$compose_file" ps -q api)"
worker_container="$(docker compose -p "$project" -f "$compose_file" ps -q worker)"
collab_container="$(docker compose -p "$project" -f "$compose_file" ps -q collab)"
web_container="$(docker compose -p "$project" -f "$compose_file" ps -q web)"
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$api_container")" == "healthy" ]]
[[ "$(docker inspect --format '{{.State.Status}}' "$worker_container")" == "running" ]]
[[ "$(docker inspect --format '{{.State.Status}}' "$collab_container")" == "running" ]]
[[ "$(docker inspect --format '{{.State.Status}}' "$web_container")" == "running" ]]
[[ -z "$(docker exec "$web_container" find /usr/share/nginx/html -type f -name '*.map' -print -quit)" ]]

migration_count="$(docker compose -p "$project" -f "$compose_file" exec -T database psql -U knowledge -d knowledge -Atc 'select count(*) from flyway_schema_history')"
collaboration_table="$(docker compose -p "$project" -f "$compose_file" exec -T database psql -U knowledge -d knowledge -Atc "select coalesce(to_regclass('public.collaboration_updates')::text, '')")"
[[ "$migration_count" -gt 0 ]]
[[ "$collaboration_table" == "collaboration_updates" ]]

printf 'DEPLOYMENT_SMOKE_SUCCESS migrations=%s collaboration=%s\n' "$migration_count" "$collaboration_table"
