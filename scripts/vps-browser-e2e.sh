#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Browser E2E failed at line $LINENO" >&2' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$project_root/deploy/docker-compose.yml"
suffix="$(date +%s)-$$"
project="kp-browser-e2e-$suffix"
scratch="$(mktemp -d /tmp/kp-browser-e2e.XXXXXX)"

cleanup() {
  set +e
  docker compose -p "$project" -f "$compose_file" down -v --remove-orphans --rmi local >/dev/null 2>&1
  case "$scratch" in
    /tmp/kp-browser-e2e.*) rm -rf -- "$scratch" ;;
  esac
}
trap cleanup EXIT

openssl genpkey -algorithm Ed25519 -out "$scratch/collaboration-key.pem" >/dev/null 2>&1
http_port="$(python3 -c 'import socket; value=socket.socket(); value.bind(("127.0.0.1", 0)); print(value.getsockname()[1]); value.close()')"
export DATABASE_PASSWORD="browser-e2e-$suffix"
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

mkdir -p "$project_root/frontend/test-results/visual"
docker run --rm --init --ipc=host --network host \
  -e PLAYWRIGHT_BASE_URL="http://127.0.0.1:$http_port" \
  -e PLAYWRIGHT_SPEC="${PLAYWRIGHT_SPEC:-}" \
  -e HOME=/tmp/playwright-home \
  -v "$project_root/frontend:/workspace" \
  -w /workspace \
  mcr.microsoft.com/playwright:v1.62.0-noble \
  bash -lc 'npm ci --no-audit --no-fund && if [[ -n "$PLAYWRIGHT_SPEC" ]]; then npx playwright test "$PLAYWRIGHT_SPEC"; else npm run test:e2e; fi'

printf 'BROWSER_E2E_SUCCESS viewports=4 themes=2\n'
