#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Collaboration E2E failed at line $LINENO" >&2' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_jar="${API_JAR:-$project_root/backend/app-api/build/libs/knowledge-platform-api.jar}"
if [[ ! -f "$api_jar" || ! -d "$project_root/frontend/node_modules/yjs" ]]; then
  echo "Build the API jar and install frontend dependencies before running this script." >&2
  exit 1
fi

suffix="kp-collab-e2e-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
api="$suffix-api"
collab="$suffix-collab"
image="$suffix-image"
scratch="$(mktemp -d /tmp/kp-collab-e2e.XXXXXX)"

cleanup() {
  docker rm -f "$collab" "$api" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  case "$scratch" in
    /tmp/kp-collab-e2e.*) rm -rf -- "$scratch" ;;
  esac
}
trap cleanup EXIT

wait_for() {
  local description="$1"
  shift
  for _ in $(seq 1 120); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "Timed out waiting for $description" >&2
  docker logs "$api" >&2 || true
  docker logs "$collab" >&2 || true
  return 1
}

json_value() {
  local field="$1"
  python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$field"
}

post() {
  local path="$1"
  local data="$2"
  local output="$3"
  curl -sS -o "$output" -w "%{http_code}" -b "$admin_cookie" \
    -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" \
    --data-binary "$data" "$api_url$path"
}

start_collab() {
  docker run -d --name "$collab" --network "$network" -p 127.0.0.1::8090 \
    -e COLLAB_TICKET_PUBLIC_KEY="$public_key" \
    -e COLLAB_INTERNAL_TOKEN="$internal_token" \
    -e COLLAB_MATERIALIZATION_URL=http://api:8080/api/internal/v1/collaboration/materialize \
    -e COLLAB_BIND_ADDRESS=0.0.0.0:8090 \
    -e DATABASE_HOST=database -e DATABASE_PORT=5432 -e DATABASE_NAME=knowledge \
    -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge \
    "$image" >/dev/null
  collab_port="$(docker port "$collab" 8090/tcp | sed -n 's/.*://p' | head -1)"
  ws_base="ws://127.0.0.1:$collab_port"
  wait_for "collaboration readiness" curl -fsS "http://127.0.0.1:$collab_port/health/ready"
}

issue_ticket() {
  local output="$1"
  local status
  status="$(post "/api/v1/collaboration/ticket" "{\"pageId\":\"$page_id\"}" "$output")"
  [[ "$status" == "200" ]]
  json_value ticket < "$output"
}

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias database \
  -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge \
  postgres:17.6-alpine >/dev/null
wait_for "PostgreSQL" docker exec "$database" pg_isready -U knowledge -d knowledge

openssl genpkey -algorithm Ed25519 -out "$scratch/collaboration-key.pem"
private_key="$(openssl pkey -in "$scratch/collaboration-key.pem" -outform DER | tail -c 32 | base64 -w0)"
public_key="$(openssl pkey -in "$scratch/collaboration-key.pem" -pubout -outform DER | tail -c 32 | base64 -w0)"
settings_master_key="$(openssl rand -base64 32)"
internal_token="$(openssl rand -base64 32)"

docker build -q -f "$project_root/collaboration/Dockerfile" -t "$image" "$project_root" >/dev/null
docker run -d --name "$api" --network "$network" --network-alias api -p 127.0.0.1::8080 --entrypoint java \
  -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge \
  -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge \
  -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$settings_master_key" \
  -e COLLAB_TICKET_PRIVATE_KEY="$private_key" \
  -e COLLAB_INTERNAL_TOKEN="$internal_token" \
  -v "$api_jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null

api_port="$(docker port "$api" 8080/tcp | sed -n 's/.*://p' | head -1)"
api_url="http://127.0.0.1:$api_port"
wait_for "API health" curl -fsS "$api_url/actuator/health"

admin_cookie="$scratch/admin.cookies"
setup_status="$(curl -sS -o "$scratch/setup.json" -w "%{http_code}" -c "$admin_cookie" \
  -H "Content-Type: application/json" --data-binary '{
    "email":"admin@example.com",
    "password":"Admin-Password-2026!",
    "passwordConfirmation":"Admin-Password-2026!",
    "workspaceName":"Primary Workspace"
  }' "$api_url/api/v1/setup/initialize")"
[[ "$setup_status" == "201" ]]
admin_id="$(json_value userId < "$scratch/setup.json")"
workspace_id="$(json_value workspaceId < "$scratch/setup.json")"
csrf_json="$(curl -fsS -b "$admin_cookie" "$api_url/api/v1/auth/csrf")"
csrf_header="$(printf "%s" "$csrf_json" | json_value headerName)"
csrf_token="$(printf "%s" "$csrf_json" | json_value token)"

kb_status="$(post "/api/v1/knowledge-bases/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Collaboration\",\"slug\":\"collaboration\",\"ownerType\":\"PERSONAL\",\"ownerId\":\"$admin_id\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" \
  "$scratch/kb.json")"
[[ "$kb_status" == "201" ]] || { cat "$scratch/kb.json" >&2; exit 1; }
kb_id="$(json_value id < "$scratch/kb.json")"
page_status="$(post "/api/v1/pages/create" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"title\":\"Shared page\",\"path\":\"shared-page\",\"contentType\":\"DOCUMENT\"}" \
  "$scratch/page.json")"
[[ "$page_status" == "201" ]]
page_id="$(json_value id < "$scratch/page.json")"

start_collab
ticket_one="$(issue_ticket "$scratch/ticket-one.json")"
ticket_two="$(issue_ticket "$scratch/ticket-two.json")"
expected_text="persistent collaborative body"
docker run --rm --network host \
  -e MODE=broadcast -e EXPECTED_TEXT="$expected_text" -e WS_BASE="$ws_base" \
  -e PAGE_ID="$page_id" -e TICKET_ONE="$ticket_one" -e TICKET_TWO="$ticket_two" \
  -v "$project_root/frontend:/workspace/frontend:ro" -w /workspace/frontend \
  node:24-bookworm-slim node scripts/collaboration-e2e.mjs

materialized() {
  local value
  value="$(docker exec "$database" psql -U knowledge -d knowledge -Atc \
    "select plain_text from page_drafts where page_id='$page_id'")"
  [[ "$value" == "$expected_text" ]]
}
wait_for "Java page materialization" materialized
draft_revision="$(docker exec "$database" psql -U knowledge -d knowledge -Atc \
  "select draft_revision from pages where id='$page_id'")"
[[ "$draft_revision" -ge 1 ]]

update_count="$(docker exec "$database" psql -U knowledge -d knowledge -Atc \
  "select count(*) from collaboration_updates where page_id='$page_id'")"
[[ "$update_count" -ge 1 ]]
docker rm -f "$collab" >/dev/null
start_collab
recovery_ticket="$(issue_ticket "$scratch/recovery-ticket.json")"
if ! docker run --rm --network host \
  -e MODE=recover -e EXPECTED_TEXT="$expected_text" -e WS_BASE="$ws_base" \
  -e PAGE_ID="$page_id" -e TICKET_ONE="$recovery_ticket" \
  -v "$project_root/frontend:/workspace/frontend:ro" -w /workspace/frontend \
  node:24-bookworm-slim node scripts/collaboration-e2e.mjs; then
  docker logs "$collab" >&2
  exit 1
fi

permission_ticket="$(issue_ticket "$scratch/permission-ticket.json")"
page_update_status="$(post "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":$draft_revision,\"visibilityOverride\":\"PRIVATE\",\"revisionKind\":\"MANUAL\"}" \
  "$scratch/page-update.json")"
[[ "$page_update_status" == "200" ]]
docker run --rm --network host \
  -e MODE=rejected -e EXPECTED_TEXT="$expected_text" -e WS_BASE="$ws_base" \
  -e PAGE_ID="$page_id" -e TICKET_ONE="$permission_ticket" \
  -v "$project_root/frontend:/workspace/frontend:ro" -w /workspace/frontend \
  node:24-bookworm-slim node scripts/collaboration-e2e.mjs

logout_ticket="$(issue_ticket "$scratch/logout-ticket.json")"
logout_status="$(curl -sS -o /dev/null -w "%{http_code}" -b "$admin_cookie" \
  -H "$csrf_header: $csrf_token" -X POST "$api_url/api/v1/auth/logout")"
[[ "$logout_status" == "200" || "$logout_status" == "204" || "$logout_status" == "302" ]]
docker run --rm --network host \
  -e MODE=rejected -e EXPECTED_TEXT="$expected_text" -e WS_BASE="$ws_base" \
  -e PAGE_ID="$page_id" -e TICKET_ONE="$logout_ticket" \
  -v "$project_root/frontend:/workspace/frontend:ro" -w /workspace/frontend \
  node:24-bookworm-slim node scripts/collaboration-e2e.mjs

echo "COLLABORATION_E2E_COUNTS"
outbox_count="$(docker exec "$database" psql -U knowledge -d knowledge -Atc \
  "select count(*) from collaboration_materialization_outbox")"
echo "$update_count|$draft_revision|$outbox_count"
[[ "$outbox_count" == "0" ]]
echo "COLLABORATION_E2E_SUCCESS"
