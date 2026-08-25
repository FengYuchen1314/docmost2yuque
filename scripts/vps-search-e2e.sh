#!/usr/bin/env bash
set -Eeuo pipefail

on_error() {
  local line="$1"
  echo "Search E2E failed at line $line" >&2
  if [[ -n "${api:-}" ]]; then docker logs "$api" >&2 || true; fi
}
trap 'on_error "$LINENO"' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_jar="${API_JAR:-$project_root/backend/app-api/build/libs/knowledge-platform-api.jar}"
[[ -f "$api_jar" ]] || { echo "Build the API jar before running this script." >&2; exit 1; }

suffix="kp-search-e2e-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
api="$suffix-api"
scratch="$(mktemp -d /tmp/kp-search-e2e.XXXXXX)"

cleanup() {
  docker rm -f "$api" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  case "$scratch" in /tmp/kp-search-e2e.*) rm -rf -- "$scratch" ;; esac
}
trap cleanup EXIT

wait_for() {
  local description="$1"; shift
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

post() {
  local cookie="$1" header="$2" token="$3" path="$4" data="$5" output="$6"
  curl -sS -o "$output" -w "%{http_code}" -b "$cookie" \
    -H "$header: $token" -H "Content-Type: application/json" \
    --data-binary "$data" "$api_url$path"
}

assert_result() {
  local file="$1" type="$2" title="$3"
  python3 - "$file" "$type" "$title" <<'PY'
import json,sys
d=json.load(open(sys.argv[1], encoding="utf-8"))
kind,title=sys.argv[2:]
assert any(x["resourceType"] == kind and x["title"] == title for x in d["results"]), d
assert isinstance(d["nextOffset"], int)
assert isinstance(d["hasMore"], bool)
PY
}

assert_absent() {
  local file="$1" forbidden="$2"
  python3 - "$file" "$forbidden" <<'PY'
import json,sys
d=json.load(open(sys.argv[1], encoding="utf-8")); forbidden=sys.argv[2]
blob=json.dumps(d,ensure_ascii=False)
assert forbidden not in blob, blob
assert d["results"] == [], d
PY
}

assert_page_status() {
  local file="$1" title="$2" status="$3" owner_id="$4"
  python3 - "$file" "$title" "$status" "$owner_id" <<'PY'
import json,sys
d=json.load(open(sys.argv[1], encoding="utf-8"))
title,status,owner_id=sys.argv[2:]
matches=[x for x in d["results"] if x["resourceType"] == "PAGE" and x["title"] == title]
assert len(matches) == 1, d
assert matches[0]["publicationStatus"] == status, matches[0]
assert matches[0]["ownerId"] == owner_id, matches[0]
PY
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
    "workspaceName":"Search Workspace"
  }' "$api_url/api/v1/setup/initialize")"
[[ "$setup_status" == "201" ]]
admin_id="$(json_value userId < "$scratch/setup.json")"
workspace_id="$(json_value workspaceId < "$scratch/setup.json")"
csrf_json="$(curl -fsS -b "$admin_cookie" "$api_url/api/v1/auth/csrf")"
csrf_header="$(printf "%s" "$csrf_json" | json_value headerName)"
csrf_token="$(printf "%s" "$csrf_json" | json_value token)"

private_kb_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-bases/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Admin Vault\",\"slug\":\"admin-vault\",\"ownerType\":\"PERSONAL\",\"ownerId\":\"$admin_id\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" \
  "$scratch/private-kb.json")"
[[ "$private_kb_status" == "201" ]]
private_kb_id="$(json_value id < "$scratch/private-kb.json")"

private_page_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/create" \
  "{\"knowledgeBaseId\":\"$private_kb_id\",\"title\":\"秘密架构手册\",\"path\":\"secret-architecture\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"事务边界由 SearchRepository 和 PostgreSQL 共同维护\"}]}}" \
  "$scratch/private-page.json")"
[[ "$private_page_status" == "201" ]]
private_page_id="$(json_value id < "$scratch/private-page.json")"

search_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"事务边界\",\"resourceTypes\":[\"PAGE\"],\"limit\":20}" \
  "$scratch/search-cn.json")"
[[ "$search_status" == "200" ]]
assert_result "$scratch/search-cn.json" PAGE "秘密架构手册"
assert_page_status "$scratch/search-cn.json" "秘密架构手册" UNPUBLISHED "$admin_id"

filtered_search_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"事务边界\",\"resourceTypes\":[\"PAGE\"],\"knowledgeBaseId\":\"$private_kb_id\",\"creatorId\":\"$admin_id\",\"updatedFrom\":\"2020-01-01T00:00:00Z\",\"updatedTo\":\"2090-01-01T00:00:00Z\",\"offset\":0,\"limit\":1}" \
  "$scratch/search-filtered.json")"
[[ "$filtered_search_status" == "200" ]]
assert_result "$scratch/search-filtered.json" PAGE "秘密架构手册"

wrong_creator_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"事务边界\",\"resourceTypes\":[\"PAGE\"],\"knowledgeBaseId\":\"$private_kb_id\",\"creatorId\":\"00000000-0000-0000-0000-000000000001\"}" \
  "$scratch/search-wrong-creator.json")"
[[ "$wrong_creator_status" == "200" ]]
assert_absent "$scratch/search-wrong-creator.json" "秘密架构手册"

future_search_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"事务边界\",\"resourceTypes\":[\"PAGE\"],\"knowledgeBaseId\":\"$private_kb_id\",\"updatedFrom\":\"2090-01-01T00:00:00Z\"}" \
  "$scratch/search-future.json")"
[[ "$future_search_status" == "200" ]]
assert_absent "$scratch/search-future.json" "秘密架构手册"

invalid_range_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"事务边界\",\"updatedFrom\":\"2090-01-01T00:00:00Z\",\"updatedTo\":\"2020-01-01T00:00:00Z\"}" \
  "$scratch/search-invalid-range.json")"
[[ "$invalid_range_status" == "400" ]]

code_search_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"SearchRepository\",\"resourceTypes\":[\"PAGE\"]}" \
  "$scratch/search-code.json")"
[[ "$code_search_status" == "200" ]]
assert_result "$scratch/search-code.json" PAGE "秘密架构手册"

note_request_id="$(cat /proc/sys/kernel/random/uuid)"
note_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/create" \
  "{\"workspaceId\":\"$workspace_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"星际发布清单\"}]},\"plainText\":\"星际发布清单\n检查索引回滚\",\"source\":\"API\",\"clientRequestId\":\"$note_request_id\",\"tagIds\":[]}" \
  "$scratch/note.json")"
[[ "$note_status" == "201" ]]
note_id="$(json_value id < "$scratch/note.json")"
note_search_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"索引回滚\",\"resourceTypes\":[\"QUICK_NOTE\"]}" \
  "$scratch/search-note.json")"
[[ "$note_search_status" == "200" ]] || { cat "$scratch/search-note.json" >&2; docker logs "$api" >&2; exit 1; }
assert_result "$scratch/search-note.json" QUICK_NOTE "星际发布清单"

member_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "
  with inserted as (
    insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at)
    select gen_random_uuid(),'member@example.com','member@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now()
    from users where id='$admin_id' returning id
  ), membership as (
    insert into workspace_memberships(workspace_id,user_id,role,created_at)
    select '$workspace_id',id,'MEMBER',now() from inserted returning user_id
  ) select user_id from membership;")"
[[ -n "$member_id" ]]

member_cookie="$scratch/member.cookies"
member_login_status="$(curl -sS -o "$scratch/member-login.json" -w "%{http_code}" -c "$member_cookie" \
  -H "Content-Type: application/json" --data-binary '{"email":"member@example.com","password":"Admin-Password-2026!"}' \
  "$api_url/api/v1/auth/login/password")"
[[ "$member_login_status" == "204" ]]
member_csrf_json="$(curl -fsS -b "$member_cookie" "$api_url/api/v1/auth/csrf")"
member_csrf_header="$(printf "%s" "$member_csrf_json" | json_value headerName)"
member_csrf_token="$(printf "%s" "$member_csrf_json" | json_value token)"
member_search_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"秘密架构\",\"resourceTypes\":[\"PAGE\"]}" \
  "$scratch/member-search.json")"
[[ "$member_search_status" == "200" ]]
assert_absent "$scratch/member-search.json" "秘密架构手册"

public_kb_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-bases/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Public Manual\",\"slug\":\"public-manual\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$workspace_id\",\"visibility\":\"PUBLIC\",\"publishMode\":\"MANUAL\"}" \
  "$scratch/public-kb.json")"
[[ "$public_kb_status" == "201" ]]
public_kb_id="$(json_value id < "$scratch/public-kb.json")"
public_page_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/create" \
  "{\"knowledgeBaseId\":\"$public_kb_id\",\"title\":\"公开星图\",\"path\":\"public-star-map\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"公开检索唯一信标 OrionNebula\"}]}}" \
  "$scratch/public-page.json")"
[[ "$public_page_status" == "201" ]]
public_page_id="$(json_value id < "$scratch/public-page.json")"

internal_before_publish_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"OrionNebula\",\"resourceTypes\":[\"PAGE\"],\"knowledgeBaseId\":\"$public_kb_id\"}" \
  "$scratch/internal-before-publish.json")"
[[ "$internal_before_publish_status" == "200" ]]
assert_page_status "$scratch/internal-before-publish.json" "公开星图" UNPUBLISHED "$admin_id"

before_publish="$(curl -sS -o "$scratch/public-before.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"OrionNebula\"}" \
  "$api_url/api/public/v1/search")"
[[ "$before_publish" == "200" ]]
assert_absent "$scratch/public-before.json" "公开星图"

publish_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/publish" \
  "{\"pageId\":\"$public_page_id\",\"idempotencyKey\":\"search-publication-v1\"}" \
  "$scratch/publication.json")"
[[ "$publish_status" == "201" ]]
internal_published_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"OrionNebula\",\"resourceTypes\":[\"PAGE\"]}" \
  "$scratch/internal-published.json")"
[[ "$internal_published_status" == "200" ]]
assert_page_status "$scratch/internal-published.json" "公开星图" PUBLISHED "$admin_id"
public_search_status="$(curl -sS -o "$scratch/public-after.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"OrionNebula\"}" \
  "$api_url/api/public/v1/search")"
[[ "$public_search_status" == "200" ]]
assert_result "$scratch/public-after.json" PAGE "公开星图"

edit_after_publish_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/update" \
  "{\"pageId\":\"$public_page_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"公开检索唯一信标 OrionNebula，草稿已经更新\"}]}}" \
  "$scratch/public-page-edit.json")"
[[ "$edit_after_publish_status" == "200" ]]
internal_changed_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"OrionNebula\",\"resourceTypes\":[\"PAGE\"]}" \
  "$scratch/internal-changed.json")"
[[ "$internal_changed_status" == "200" ]]
assert_page_status "$scratch/internal-changed.json" "公开星图" CHANGED "$admin_id"

unpublish_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/unpublish" "{\"pageId\":\"$public_page_id\"}" "$scratch/unpublish.json")"
[[ "$unpublish_status" == "204" ]]
internal_unpublished_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"OrionNebula\",\"resourceTypes\":[\"PAGE\"]}" \
  "$scratch/internal-unpublished.json")"
[[ "$internal_unpublished_status" == "200" ]]
assert_page_status "$scratch/internal-unpublished.json" "公开星图" UNPUBLISHED "$admin_id"
after_unpublish="$(curl -sS -o "$scratch/public-unpublished.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"OrionNebula\"}" \
  "$api_url/api/public/v1/search")"
[[ "$after_unpublish" == "200" ]]
assert_absent "$scratch/public-unpublished.json" "公开星图"

trash_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/trash" "{\"pageId\":\"$private_page_id\"}" "$scratch/trash.json")"
[[ "$trash_status" == "204" ]]
trashed_search="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"SearchRepository\",\"resourceTypes\":[\"PAGE\"]}" \
  "$scratch/trashed-search.json")"
[[ "$trashed_search" == "200" ]]
assert_absent "$scratch/trashed-search.json" "秘密架构手册"

restore_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/restore" "{\"pageId\":\"$private_page_id\"}" "$scratch/restore.json")"
[[ "$restore_status" == "200" ]]
restored_search="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"SearchRepository\",\"resourceTypes\":[\"PAGE\"]}" \
  "$scratch/restored-search.json")"
[[ "$restored_search" == "200" ]]
assert_result "$scratch/restored-search.json" PAGE "秘密架构手册"

note_delete_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/delete" "{\"quickNoteId\":\"$note_id\"}" "$scratch/note-delete.json")"
[[ "$note_delete_status" == "204" ]]
deleted_note_search="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/search" \
  "{\"workspaceId\":\"$workspace_id\",\"query\":\"索引回滚\",\"resourceTypes\":[\"QUICK_NOTE\"]}" \
  "$scratch/deleted-note-search.json")"
[[ "$deleted_note_search" == "200" ]]
assert_absent "$scratch/deleted-note-search.json" "星际发布清单"

echo SEARCH_E2E_COUNTS
docker exec "$database" psql -U knowledge -d knowledge -Atc \
  "select count(*), count(*) filter (where resource_type='PAGE'), count(*) filter (where resource_type='QUICK_NOTE') from search_documents;"
echo SEARCH_E2E_SUCCESS
