#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Page reference E2E failed at line $LINENO" >&2' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_jar="${API_JAR:-$project_root/backend/app-api/build/libs/knowledge-platform-api.jar}"
if [[ ! -f "$api_jar" ]]; then
  echo "Build the API jar before running this script." >&2
  exit 1
fi

suffix="kp-reference-e2e-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
api="$suffix-api"
scratch="$(mktemp -d /tmp/kp-reference-e2e.XXXXXX)"

cleanup() {
  docker rm -f "$api" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  case "$scratch" in
    /tmp/kp-reference-e2e.*) rm -rf -- "$scratch" ;;
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
  docker logs "$api" >&2 || true
  return 1
}

json_value() {
  local field="$1"
  python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$field"
}

problem_code() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])'
}

post() {
  local cookie="$1" header="$2" token="$3" path="$4" data="$5" output="$6"
  curl -sS -o "$output" -w "%{http_code}" -b "$cookie" \
    -H "$header: $token" -H "Content-Type: application/json" \
    --data-binary "$data" "$api_url$path"
}

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias database \
  -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge \
  postgres:17.6-alpine >/dev/null
wait_for "PostgreSQL" docker exec "$database" pg_isready -U knowledge -d knowledge

settings_master_key="$(openssl rand -base64 32)"
docker run -d --name "$api" --network "$network" -p 127.0.0.1::8080 \
  --entrypoint java \
  -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge \
  -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge \
  -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$settings_master_key" \
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
    "workspaceName":"Reference Workspace"
  }' "$api_url/api/v1/setup/initialize")"
[[ "$setup_status" == "201" ]]
admin_id="$(json_value userId < "$scratch/setup.json")"
workspace_id="$(json_value workspaceId < "$scratch/setup.json")"

csrf_json="$(curl -fsS -b "$admin_cookie" "$api_url/api/v1/auth/csrf")"
csrf_header="$(printf "%s" "$csrf_json" | json_value headerName)"
csrf_token="$(printf "%s" "$csrf_json" | json_value token)"

kb_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-bases/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Knowledge Graph\",\"slug\":\"knowledge-graph\",\"ownerType\":\"PERSONAL\",\"ownerId\":\"$admin_id\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" \
  "$scratch/kb.json")"
[[ "$kb_status" == "201" ]]
kb_id="$(json_value id < "$scratch/kb.json")"

create_page() {
  local title="$1" path="$2" body="$3" output="$4"
  local status
  status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
    "/api/v1/pages/create" \
    "{\"knowledgeBaseId\":\"$kb_id\",\"title\":\"$title\",\"path\":\"$path\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$body\"}]}}" \
    "$output")"
  [[ "$status" == "201" ]]
}

create_page "Source" "source" "source body" "$scratch/source.json"
create_page "Fixed Target" "fixed-target" "fixed version one" "$scratch/fixed.json"
create_page "Live Target" "live-target" "live version one" "$scratch/live.json"
source_id="$(json_value id < "$scratch/source.json")"
fixed_id="$(json_value id < "$scratch/fixed.json")"
live_id="$(json_value id < "$scratch/live.json")"

publish_fixed_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/publish" \
  "{\"pageId\":\"$fixed_id\",\"idempotencyKey\":\"publish-fixed-target-v1\"}" \
  "$scratch/fixed-publication.json")"
[[ "$publish_fixed_status" == "201" ]]
fixed_publication_id="$(json_value id < "$scratch/fixed-publication.json")"

source_body="[[page:$fixed_id|mode=card]] {{embed:$fixed_id|mode=fixed|publication=$fixed_publication_id}} {{embed:$live_id|mode=live}}"
source_update_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/update" \
  "{\"pageId\":\"$source_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$source_body\"}]}}" \
  "$scratch/source-updated.json")"
[[ "$source_update_status" == "200" ]]

outgoing_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/page-references/outgoing" "{\"pageId\":\"$source_id\"}" "$scratch/outgoing.json")"
[[ "$outgoing_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d)==3
assert {r["mode"] for r in d} == {"CARD","FIXED","LIVE"}
assert all(r["accessible"] for r in d)' < "$scratch/outgoing.json"
fixed_reference_id="$(python3 -c 'import json,sys; print(next(r["referenceId"] for r in json.load(sys.stdin) if r["mode"]=="FIXED"))' < "$scratch/outgoing.json")"
live_reference_id="$(python3 -c 'import json,sys; print(next(r["referenceId"] for r in json.load(sys.stdin) if r["mode"]=="LIVE"))' < "$scratch/outgoing.json")"

fixed_resolve_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/page-references/resolve" "{\"referenceId\":\"$fixed_reference_id\"}" "$scratch/fixed-resolve.json")"
[[ "$fixed_resolve_status" == "200" ]]
[[ "$(json_value plainText < "$scratch/fixed-resolve.json")" == "fixed version one" ]]

fixed_update_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/update" \
  "{\"pageId\":\"$fixed_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"fixed version two\"}]}}" \
  "$scratch/fixed-updated.json")"
[[ "$fixed_update_status" == "200" ]]

fixed_resolve_again_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/page-references/resolve" "{\"referenceId\":\"$fixed_reference_id\"}" "$scratch/fixed-resolve-again.json")"
[[ "$fixed_resolve_again_status" == "200" ]]
[[ "$(json_value plainText < "$scratch/fixed-resolve-again.json")" == "fixed version one" ]]

live_update_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/update" \
  "{\"pageId\":\"$live_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"live version two\"}]}}" \
  "$scratch/live-updated.json")"
[[ "$live_update_status" == "200" ]]
live_resolve_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/page-references/resolve" "{\"referenceId\":\"$live_reference_id\"}" "$scratch/live-resolve.json")"
[[ "$live_resolve_status" == "200" ]]
[[ "$(json_value plainText < "$scratch/live-resolve.json")" == "live version two" ]]

cycle_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/update" \
  "{\"pageId\":\"$live_id\",\"expectedRevision\":1,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"{{embed:$source_id|mode=live}}\"}]}}" \
  "$scratch/cycle.json")"
[[ "$cycle_status" == "409" ]]
[[ "$(problem_code < "$scratch/cycle.json")" == "REFERENCE_EMBED_CYCLE" ]]

publish_source_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/publish" \
  "{\"pageId\":\"$source_id\",\"idempotencyKey\":\"publish-source-references-v1\"}" \
  "$scratch/source-publication.json")"
[[ "$publish_source_status" == "201" ]]

backlinks_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/page-references/backlinks" "{\"pageId\":\"$fixed_id\"}" "$scratch/backlinks.json")"
[[ "$backlinks_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d)==4
assert {r["sourceScope"] for r in d} == {"DRAFT","PUBLISHED"}
assert all(r["title"]=="Source" for r in d)' < "$scratch/backlinks.json"

graph_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/page-references/graph" "{\"pageId\":\"$source_id\",\"depth\":3,\"limit\":100}" "$scratch/graph.json")"
[[ "$graph_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d["nodes"])==3
assert len(d["edges"])==3
assert d["truncated"] is False' < "$scratch/graph.json"

member_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "
  with inserted as (
    insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at)
    select gen_random_uuid(),'member@example.com','member@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now()
    from users where id='$admin_id' returning id
  ), membership as (
    insert into workspace_memberships(workspace_id,user_id,role,created_at)
    select '$workspace_id',id,'MEMBER',now() from inserted returning user_id
  ) select user_id from membership;")"
acl_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/authorization/grant" \
  "{\"resourceType\":\"PAGE\",\"resourceId\":\"$source_id\",\"subjectType\":\"USER\",\"subjectId\":\"$member_id\",\"role\":\"READER\",\"effect\":\"ALLOW\",\"capabilities\":[]}" \
  "$scratch/member-acl.json")"
[[ "$acl_status" == "201" ]]

member_cookie="$scratch/member.cookies"
member_login_status="$(curl -sS -o "$scratch/member-login.json" -w "%{http_code}" -c "$member_cookie" \
  -H "Content-Type: application/json" --data-binary '{"email":"member@example.com","password":"Admin-Password-2026!"}' \
  "$api_url/api/v1/auth/login/password")"
[[ "$member_login_status" == "204" ]]
member_csrf_json="$(curl -fsS -b "$member_cookie" "$api_url/api/v1/auth/csrf")"
member_csrf_header="$(printf "%s" "$member_csrf_json" | json_value headerName)"
member_csrf_token="$(printf "%s" "$member_csrf_json" | json_value token)"
member_outgoing_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/page-references/outgoing" "{\"pageId\":\"$source_id\"}" "$scratch/member-outgoing.json")"
[[ "$member_outgoing_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d)==3
assert all(not r["accessible"] for r in d)
assert all(r["title"] is None and r["pageId"] is None for r in d)' < "$scratch/member-outgoing.json"

echo "PAGE_REFERENCE_E2E_COUNTS"
docker exec "$database" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from page_references where source_scope='DRAFT'),
  (select count(*) from page_references where source_scope='PUBLISHED'),
  (select count(*) from page_publications);"
echo "PAGE_REFERENCE_E2E_SUCCESS"
