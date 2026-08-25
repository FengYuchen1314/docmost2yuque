#!/usr/bin/env bash
set -Eeuo pipefail
trap 'status=$?; echo "Quick-note share E2E failed at line $LINENO" >&2; if [[ -n "${api:-}" ]]; then docker logs "$api" 2>&1 | tail -160 >&2 || true; fi; exit "$status"' ERR

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}"
[[ -f "$jar" ]]
suffix="kp-quick-note-share-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
api="$suffix-api"
scratch="$(mktemp -d /tmp/kp-quick-note-share.XXXXXX)"

cleanup() {
  docker rm -f "$api" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  case "$scratch" in /tmp/kp-quick-note-share.*) rm -rf -- "$scratch" ;; esac
}
trap cleanup EXIT

wait_for() {
  local label="$1"
  shift
  for _ in $(seq 1 90); do
    "$@" >/dev/null 2>&1 && return
    sleep 1
  done
  echo "Timed out waiting for $label" >&2
  docker logs "$api" >&2 || true
  return 1
}

value() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"
}

post() {
  local path="$1" payload="$2" output="$3"
  curl -sS -o "$output" -w '%{http_code}' -b "$cookie" \
    -H "$csrf_header: $csrf_token" -H 'Content-Type: application/json' \
    --data-binary "$payload" "$api_url$path"
}

anonymous_post() {
  local path="$1" payload="$2" output="$3"
  curl -sS -o "$output" -w '%{http_code}' -H 'Content-Type: application/json' \
    --data-binary "$payload" "$api_url$path"
}

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias database \
  -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge \
  postgres:17.6-alpine >/dev/null
wait_for PostgreSQL docker exec "$database" pg_isready -U knowledge -d knowledge

docker run -d --name "$api" --network "$network" -p 127.0.0.1::8080 \
  --entrypoint java \
  -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge \
  -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge \
  -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" \
  -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null
api_port="$(docker port "$api" 8080/tcp | sed -n 's/.*://p' | head -1)"
api_url="http://127.0.0.1:$api_port"
wait_for API curl -fsS "$api_url/actuator/health"

cookie="$scratch/admin.cookies"
status="$(curl -sS -o "$scratch/setup.json" -w '%{http_code}' -c "$cookie" \
  -H 'Content-Type: application/json' --data-binary '{
    "email":"admin@example.com",
    "password":"Admin-Password-2026!",
    "passwordConfirmation":"Admin-Password-2026!",
    "workspaceName":"Quick-note Share Workspace"
  }' "$api_url/api/v1/setup/initialize")"
[[ "$status" == 201 ]]
workspace_id="$(value workspaceId < "$scratch/setup.json")"
csrf="$(curl -fsS -b "$cookie" "$api_url/api/v1/auth/csrf")"
csrf_header="$(printf %s "$csrf" | value headerName)"
csrf_token="$(printf %s "$csrf" | value token)"

client_request_id="$(cat /proc/sys/kernel/random/uuid)"
status="$(post /api/v1/quick-notes/create "{
  \"workspaceId\":\"$workspace_id\",
  \"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"快照第一版，不能被后续草稿覆盖\"}]},
  \"plainText\":\"快照第一版，不能被后续草稿覆盖\",
  \"source\":\"QUICK_NOTE_PAGE\",
  \"clientRequestId\":\"$client_request_id\",
  \"tagIds\":[]
}" "$scratch/note.json")"
[[ "$status" == 201 ]]
note_id="$(value id < "$scratch/note.json")"
[[ "$(value revision < "$scratch/note.json")" == 1 ]]

# Organization administrators do not inherit access to another member's private quick note.
other_note_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "
  with inserted_user as (
    insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at)
    select gen_random_uuid(),'member@example.com','member@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now()
    from users where email_normalized='admin@example.com' returning id
  ), membership as (
    insert into workspace_memberships(workspace_id,user_id,role,created_at)
    select '$workspace_id',id,'MEMBER',now() from inserted_user returning user_id
  ), inserted_note as (
    insert into quick_notes(id,workspace_id,user_id,content_json,plain_text,status,source,revision_no,client_request_id,created_at,updated_at)
    select gen_random_uuid(),'$workspace_id',user_id,
      jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','text','member private note'))),
      'member private note','ACTIVE','QUICK_NOTE_PAGE',1,gen_random_uuid(),now(),now()
    from membership returning id
  ) select id from inserted_note;")"
status="$(post /api/v1/shares/create "{\"resourceType\":\"QUICK_NOTE\",\"resourceId\":\"$other_note_id\",\"shareType\":\"PUBLIC\",\"role\":\"READER\"}" "$scratch/admin-private-note-denied.json")"
if [[ "$status" != 403 ]]; then cat "$scratch/admin-private-note-denied.json" >&2; fi
[[ "$status" == 403 ]]
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*) from shares where resource_type='QUICK_NOTE' and resource_id='$other_note_id';")" == 0 ]]

status="$(post /api/v1/shares/create "{
  \"resourceType\":\"QUICK_NOTE\",
  \"resourceId\":\"$note_id\",
  \"shareType\":\"PUBLIC\",
  \"password\":\"Snapshot-Password-2026!\",
  \"role\":\"READER\",
  \"allowCopy\":false,
  \"allowDownload\":true,
  \"allowExport\":true,
  \"allowComment\":true,
  \"allowSearchIndex\":true
}" "$scratch/share.json")"
if [[ "$status" != 201 ]]; then cat "$scratch/share.json" >&2; fi
[[ "$status" == 201 ]]
share_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["share"]["id"])' < "$scratch/share.json")"
share_token="$(value token < "$scratch/share.json")"
python3 - "$scratch/share.json" "$note_id" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))['share']
assert s['resourceType']=='QUICK_NOTE' and s['resourceId']==sys.argv[2],s
assert s['shareType']=='PUBLIC' and s['role']=='READER',s
assert s['allowComment'] is False and s['allowSearchIndex'] is False,s
assert s['allowCopy'] is False and s['allowDownload'] is True and s['allowExport'] is True,s
PY

# Server-side invariants reject collaboration roles and invitation semantics even if a caller bypasses the web UI.
status="$(post /api/v1/shares/create "{\"resourceType\":\"QUICK_NOTE\",\"resourceId\":\"$note_id\",\"shareType\":\"PUBLIC\",\"role\":\"COMMENTER\"}" "$scratch/commenter-invalid.json")"
[[ "$status" == 400 ]]
status="$(post /api/v1/shares/create "{\"resourceType\":\"QUICK_NOTE\",\"resourceId\":\"$note_id\",\"shareType\":\"INVITE_LINK\",\"role\":\"READER\"}" "$scratch/invite-invalid.json")"
[[ "$status" == 400 ]]

status="$(post /api/v1/shares/list "{\"resourceType\":\"QUICK_NOTE\",\"resourceId\":\"$note_id\"}" "$scratch/list.json")"
[[ "$status" == 200 ]]
python3 - "$scratch/list.json" "$share_id" <<'PY'
import json,sys
values=json.load(open(sys.argv[1]))
assert len(values)==1 and values[0]['id']==sys.argv[2],values
PY

status="$(anonymous_post /api/v1/shares/resolve "{\"token\":\"$share_token\"}" "$scratch/locked.json")"
[[ "$status" == 200 ]]
[[ "$(value passwordRequired < "$scratch/locked.json")" == True ]]
status="$(anonymous_post /api/v1/shares/verify-password "{\"token\":\"$share_token\",\"password\":\"Snapshot-Password-2026!\"}" "$scratch/access.json")"
[[ "$status" == 200 ]]
access_token="$(value accessToken < "$scratch/access.json")"

status="$(anonymous_post /api/v1/shares/resolve "{\"token\":\"$share_token\",\"accessToken\":\"$access_token\"}" "$scratch/reader-v1.json")"
[[ "$status" == 200 ]]
python3 - "$scratch/reader-v1.json" "$note_id" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); note=r['quickNote']
assert r['publication'] is None and r['knowledgeBase'] is None,r
assert note['id']==sys.argv[2] and note['sourceRevision']==1,note
assert note['plainText']=='快照第一版，不能被后续草稿覆盖',note
assert note['content']['content'][0]['text']=='快照第一版，不能被后续草稿覆盖',note
PY

# Auto-save advances the private note, while the already-issued link stays pinned to revision 1.
status="$(post /api/v1/quick-notes/save "{
  \"quickNoteId\":\"$note_id\",
  \"expectedRevision\":1,
  \"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"私密草稿第二版，不应泄露\"}]},
  \"plainText\":\"私密草稿第二版，不应泄露\",
  \"kind\":\"AUTO_SAVE\"
}" "$scratch/note-v2.json")"
[[ "$status" == 200 ]]
[[ "$(value revision < "$scratch/note-v2.json")" == 2 ]]
status="$(anonymous_post /api/v1/shares/resolve "{\"token\":\"$share_token\",\"accessToken\":\"$access_token\"}" "$scratch/reader-after-save.json")"
[[ "$status" == 200 ]]
python3 - "$scratch/reader-after-save.json" <<'PY'
import json,sys
note=json.load(open(sys.argv[1]))['quickNote']
assert note['sourceRevision']==1 and note['plainText']=='快照第一版，不能被后续草稿覆盖',note
assert '第二版' not in json.dumps(note,ensure_ascii=False),note
PY

status="$(curl -sS -o "$scratch/download.txt" -w '%{http_code}' -H 'Content-Type: application/json' \
  --data-binary "{\"token\":\"$share_token\",\"accessToken\":\"$access_token\"}" "$api_url/api/v1/shares/download")"
[[ "$status" == 200 ]]
grep -q '快照第一版' "$scratch/download.txt"
! grep -q '第二版' "$scratch/download.txt"
status="$(curl -sS -o "$scratch/export.json" -w '%{http_code}' -H 'Content-Type: application/json' \
  --data-binary "{\"token\":\"$share_token\",\"accessToken\":\"$access_token\"}" "$api_url/api/v1/shares/export")"
[[ "$status" == 200 ]]
python3 - "$scratch/export.json" "$note_id" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]))
assert v['id']==sys.argv[2] and v['sourceRevision']==1,v
assert v['plainText']=='快照第一版，不能被后续草稿覆盖',v
PY

# Archiving is organizational and keeps an intentional link readable.
status="$(post /api/v1/quick-notes/archive "{\"quickNoteId\":\"$note_id\",\"archived\":true}" "$scratch/archive.json")"
[[ "$status" == 200 ]]
status="$(anonymous_post /api/v1/shares/resolve "{\"token\":\"$share_token\",\"accessToken\":\"$access_token\"}" "$scratch/reader-archived.json")"
[[ "$status" == 200 ]]
[[ "$(python3 -c 'import json,sys; print(json.load(sys.stdin)["quickNote"]["sourceRevision"])' < "$scratch/reader-archived.json")" == 1 ]]

# Reset invalidates the old URL and its short-lived password session, but not the immutable snapshot.
status="$(post /api/v1/shares/reset-token "{\"shareId\":\"$share_id\"}" "$scratch/reset.json")"
[[ "$status" == 200 ]]
new_token="$(value token < "$scratch/reset.json")"
[[ "$new_token" != "$share_token" ]]
status="$(anonymous_post /api/v1/shares/resolve "{\"token\":\"$share_token\"}" "$scratch/old-token.json")"
[[ "$status" == 410 ]]
status="$(anonymous_post /api/v1/shares/resolve "{\"token\":\"$new_token\"}" "$scratch/new-locked.json")"
[[ "$status" == 200 ]]
[[ "$(value passwordRequired < "$scratch/new-locked.json")" == True ]]
status="$(anonymous_post /api/v1/shares/verify-password "{\"token\":\"$new_token\",\"password\":\"Snapshot-Password-2026!\"}" "$scratch/new-access.json")"
[[ "$status" == 200 ]]
new_access_token="$(value accessToken < "$scratch/new-access.json")"
status="$(anonymous_post /api/v1/shares/resolve "{\"token\":\"$new_token\",\"accessToken\":\"$new_access_token\"}" "$scratch/new-reader.json")"
[[ "$status" == 200 ]]
[[ "$(python3 -c 'import json,sys; print(json.load(sys.stdin)["quickNote"]["sourceRevision"])' < "$scratch/new-reader.json")" == 1 ]]

snapshot_rows="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*)||'|'||min(source_revision)||'|'||min(plain_text) from quick_note_share_snapshots where share_id='$share_id';")"
[[ "$snapshot_rows" == '1|1|快照第一版，不能被后续草稿覆盖' ]]
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*) from content_events where resource_type='QUICK_NOTE' and resource_id='$note_id' and event_type='SHARE';")" == 1 ]]
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select shares||'|'||exports from daily_content_metrics where resource_type='QUICK_NOTE' and resource_id='$note_id';")" == '1|2' ]]

# Moving the note to the recycle bin immediately removes public readability.
status="$(post /api/v1/quick-notes/delete "{\"quickNoteId\":\"$note_id\"}" "$scratch/delete.json")"
[[ "$status" == 204 ]]
status="$(anonymous_post /api/v1/shares/resolve "{\"token\":\"$new_token\",\"accessToken\":\"$new_access_token\"}" "$scratch/deleted-reader.json")"
[[ "$status" == 404 ]]

echo 'QUICK_NOTE_SHARE_SNAPSHOT_REVISION 1'
echo 'QUICK_NOTE_SHARE_E2E_SUCCESS'
