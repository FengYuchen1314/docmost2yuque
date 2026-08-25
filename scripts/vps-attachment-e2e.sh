#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Attachment E2E failed at line $LINENO" >&2; [[ -n "${api:-}" ]] && docker logs "$api" >&2 || true' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_jar="${API_JAR:-$project_root/backend/app-api/build/libs/knowledge-platform-api.jar}"
[[ -f "$api_jar" ]] || { echo "Build the API jar before running this script." >&2; exit 1; }

suffix="kp-attachment-e2e-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
api="$suffix-api"
scratch="$(mktemp -d /tmp/kp-attachment-e2e.XXXXXX)"

cleanup() {
  docker rm -f "$api" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  case "$scratch" in /tmp/kp-attachment-e2e.*) rm -rf -- "$scratch" ;; esac
}
trap cleanup EXIT

wait_for() {
  local description="$1"; shift
  for _ in $(seq 1 90); do if "$@" >/dev/null 2>&1; then return 0; fi; sleep 1; done
  echo "Timed out waiting for $description" >&2; docker logs "$api" >&2 || true; return 1
}
json_value() { local field="$1"; python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$field"; }
problem_code() { python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])'; }
encode_data() { python3 -c 'import base64,sys; print(base64.urlsafe_b64encode(sys.stdin.buffer.read()).decode().rstrip("="))'; }
post() {
  local cookie="$1" header="$2" token="$3" path="$4" data="$5" output="$6"
  curl -sS -o "$output" -w "%{http_code}" -b "$cookie" -H "$header: $token" \
    -H "Content-Type: application/json" --data-binary "$data" "$api_url$path"
}

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias database \
  -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge \
  postgres:17.6-alpine >/dev/null
wait_for "PostgreSQL" docker exec "$database" pg_isready -U knowledge -d knowledge

docker run -d --name "$api" --network "$network" -p 127.0.0.1::8080 --entrypoint java \
  -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge \
  -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge \
  -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" \
  -e ATTACHMENT_STORAGE_ROOT=/tmp/knowledge-attachments \
  -v "$api_jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null
api_port="$(docker port "$api" 8080/tcp | sed -n 's/.*://p' | head -1)"
api_url="http://127.0.0.1:$api_port"
wait_for "API health" curl -fsS "$api_url/actuator/health"

admin_cookie="$scratch/admin.cookies"
setup_status="$(curl -sS -o "$scratch/setup.json" -w "%{http_code}" -c "$admin_cookie" \
  -H "Content-Type: application/json" --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Attachment Workspace"}' \
  "$api_url/api/v1/setup/initialize")"
[[ "$setup_status" == "201" ]]
admin_id="$(json_value userId < "$scratch/setup.json")"
workspace_id="$(json_value workspaceId < "$scratch/setup.json")"
csrf_json="$(curl -fsS -b "$admin_cookie" "$api_url/api/v1/auth/csrf")"
csrf_header="$(printf "%s" "$csrf_json" | json_value headerName)"
csrf_token="$(printf "%s" "$csrf_json" | json_value token)"

kb_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/knowledge-bases/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Media Book\",\"slug\":\"media-book\",\"ownerType\":\"PERSONAL\",\"ownerId\":\"$admin_id\",\"visibility\":\"PUBLIC\",\"publishMode\":\"MANUAL\"}" "$scratch/kb.json")"
[[ "$kb_status" == "201" ]]
kb_id="$(json_value id < "$scratch/kb.json")"
page_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/create" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"title\":\"Media Page\",\"path\":\"media\",\"contentType\":\"DOCUMENT\"}" "$scratch/page.json")"
[[ "$page_status" == "201" ]]
page_id="$(json_value id < "$scratch/page.json")"

printf '附件全文检索唯一词：青鸟校验七三一\n上线核对清单与回滚步骤。\n' > "$scratch/searchable-note.md"
search_upload_status="$(curl -sS -o "$scratch/search-upload.json" -w "%{http_code}" -b "$admin_cookie" \
  -H "$csrf_header: $csrf_token" -F "pageId=$page_id" \
  -F "file=@$scratch/searchable-note.md;type=text/markdown;filename=发布检查清单.md" \
  "$api_url/api/v1/attachments/upload")"
[[ "$search_upload_status" == "201" ]]
search_attachment_id="$(json_value id < "$scratch/search-upload.json")"
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["extractionStatus"]=="EXTRACTED" and d["extractedAt"],d' < "$scratch/search-upload.json"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/search "{\"workspaceId\":\"$workspace_id\",\"query\":\"青鸟校验七三一\",\"resourceTypes\":[\"ATTACHMENT\"],\"offset\":0,\"limit\":10}" "$scratch/search-attachment.json")" == 200 ]]
python3 - "$scratch/search-attachment.json" "$search_attachment_id" "$page_id" "$kb_id" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]));assert len(d['results'])==1,d
r=d['results'][0];assert r['resourceType']=='ATTACHMENT' and r['resourceId']==sys.argv[2],r
assert r['path']==sys.argv[3] and r['knowledgeBaseId']==sys.argv[4] and r['contentType']=='MD',r
assert '青鸟校验七三一' in r['snippet'],r
PY
docker exec "$database" psql -U knowledge -d knowledge -c "delete from search_documents where id='$search_attachment_id';" >/dev/null
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/search "{\"workspaceId\":\"$workspace_id\",\"query\":\"青鸟校验七三一\",\"resourceTypes\":[\"ATTACHMENT\"],\"offset\":0,\"limit\":10}" "$scratch/search-before-rebuild.json")" == 200 ]]
python3 -c 'import json,sys;assert json.load(sys.stdin)["results"]==[]' < "$scratch/search-before-rebuild.json"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/search/rebuild/start "{\"workspaceId\":\"$workspace_id\"}" "$scratch/rebuild.json")" == 200 ]];rebuild_id="$(json_value id < "$scratch/rebuild.json")"
for _ in $(seq 1 12);do [[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/search/rebuild/advance "{\"rebuildId\":\"$rebuild_id\",\"batchSize\":100}" "$scratch/rebuild-step.json")" == 200 ]];[[ "$(json_value status < "$scratch/rebuild-step.json")" == SUCCEEDED ]]&&break;done
[[ "$(json_value status < "$scratch/rebuild-step.json")" == SUCCEEDED ]]
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/search "{\"workspaceId\":\"$workspace_id\",\"query\":\"青鸟校验七三一\",\"resourceTypes\":[\"ATTACHMENT\"],\"offset\":0,\"limit\":10}" "$scratch/search-after-rebuild.json")" == 200 ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d["results"])==1 and d["results"][0]["resourceId"]==sys.argv[1],d' "$search_attachment_id" < "$scratch/search-after-rebuild.json"

private_kb_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/knowledge-bases/create "{\"workspaceId\":\"$workspace_id\",\"name\":\"Private Files\",\"slug\":\"private-files\",\"ownerType\":\"PERSONAL\",\"ownerId\":\"$admin_id\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" "$scratch/private-kb.json")";[[ "$private_kb_status" == 201 ]];private_kb_id="$(json_value id < "$scratch/private-kb.json")"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/pages/create "{\"knowledgeBaseId\":\"$private_kb_id\",\"title\":\"私密附件页\",\"path\":\"private-attachment\",\"contentType\":\"DOCUMENT\"}" "$scratch/private-page.json")" == 201 ]];private_page_id="$(json_value id < "$scratch/private-page.json")"
printf '私密检索唯一词：玄武隔离九二六\n' > "$scratch/private-note.txt"
[[ "$(curl -sS -o "$scratch/private-upload.json" -w "%{http_code}" -b "$admin_cookie" -H "$csrf_header: $csrf_token" -F "pageId=$private_page_id" -F "file=@$scratch/private-note.txt;type=text/plain;filename=私密资料.txt" "$api_url/api/v1/attachments/upload")" == 201 ]];private_attachment_id="$(json_value id < "$scratch/private-upload.json")"

printf '\211PNG\r\n\032\nknowledge-platform-attachment-e2e\000\001\002' > "$scratch/source.png"
source_sha="$(sha256sum "$scratch/source.png" | cut -d' ' -f1)"
upload_status="$(curl -sS -o "$scratch/upload.json" -w "%{http_code}" -b "$admin_cookie" \
  -H "$csrf_header: $csrf_token" -F "pageId=$page_id" \
  -F "file=@$scratch/source.png;type=image/png;filename=../../safe-image.png" \
  "$api_url/api/v1/attachments/upload")"
[[ "$upload_status" == "201" ]]
attachment_id="$(json_value id < "$scratch/upload.json")"
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["workspaceId"]==sys.argv[1] and d["pageId"]==sys.argv[2]
assert d["originalName"]=="safe-image.png" and d["mediaType"]=="image/png"
assert d["sizeBytes"]>8 and d["checksumSha256"]==sys.argv[3]
assert d["contentUrl"]=="/api/v1/attachments/{}/content".format(d["id"])' \
  "$workspace_id" "$page_id" "$source_sha" < "$scratch/upload.json"

gallery_upload_status="$(curl -sS -o "$scratch/gallery-upload.json" -w "%{http_code}" -b "$admin_cookie" \
  -H "$csrf_header: $csrf_token" -F "pageId=$page_id" \
  -F "file=@$scratch/source.png;type=image/png;filename=gallery-second.png" \
  "$api_url/api/v1/attachments/upload")"
[[ "$gallery_upload_status" == "201" ]]
gallery_attachment_id="$(json_value id < "$scratch/gallery-upload.json")"

card_data="$(python3 -c 'import json,sys; print(json.dumps({"url":"/api/v1/attachments/{}/content".format(sys.argv[1]),"alt":"安全架构图","attachmentId":sys.argv[1],"mediaType":"image/png","width":"FULL"},ensure_ascii=False,separators=(",",":")))' "$attachment_id")"
card_payload="$(printf '%s' "$card_data" | encode_data)"
card_id="$(cat /proc/sys/kernel/random/uuid)"
card_token="{{card:image|id=$card_id|v=1|data=$card_payload}}"
gallery_data="$(python3 -c 'import json,sys
items=[{"id":"first","url":f"/api/v1/attachments/{sys.argv[1]}/content","alt":"画廊第一张","attachmentId":sys.argv[1],"mediaType":"image/png"},{"id":"second","url":f"/api/v1/attachments/{sys.argv[2]}/content","alt":"画廊第二张","attachmentId":sys.argv[2],"mediaType":"image/png"}]
print(json.dumps({"items":items},ensure_ascii=False,separators=(",",":")))' "$attachment_id" "$gallery_attachment_id")"
gallery_payload="$(printf '%s' "$gallery_data" | encode_data)"
gallery_id="$(cat /proc/sys/kernel/random/uuid)"
gallery_token="{{card:gallery|id=$gallery_id|v=1|data=$gallery_payload}}"
page_update_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$card_token $gallery_token\"}]}}" "$scratch/page-updated.json")"
[[ "$page_update_status" == "200" ]]

other_page_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/create" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"title\":\"Other Page\",\"path\":\"other-media\",\"contentType\":\"DOCUMENT\"}" "$scratch/other-page.json")"
[[ "$other_page_status" == "201" ]]
other_page_id="$(json_value id < "$scratch/other-page.json")"
cross_card_id="$(cat /proc/sys/kernel/random/uuid)"
cross_token="{{card:image|id=$cross_card_id|v=1|data=$card_payload}}"
cross_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$other_page_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$cross_token\"}]}}" "$scratch/cross-page.json")"
[[ "$cross_status" == "404" ]]
cross_gallery_id="$(cat /proc/sys/kernel/random/uuid)"
cross_gallery_token="{{card:gallery|id=$cross_gallery_id|v=1|data=$gallery_payload}}"
cross_gallery_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$other_page_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$cross_gallery_token\"}]}}" "$scratch/cross-gallery.json")"
[[ "$cross_gallery_status" == "404" ]]

edited_card_data="$(python3 -c 'import json,sys; print(json.dumps({"url":"/api/v1/attachments/{}/content".format(sys.argv[1]),"alt":"更新后的架构图","attachmentId":sys.argv[1],"mediaType":"image/png","width":"SMALL"},ensure_ascii=False,separators=(",",":")))' "$attachment_id")"
edited_card_payload="$(printf '%s' "$edited_card_data" | encode_data)"
edited_card_token="{{card:image|id=$card_id|v=1|data=$edited_card_payload}}"
edit_card_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":1,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$edited_card_token $gallery_token\"}]}}" "$scratch/card-edited.json")"
[[ "$edit_card_status" == "200" ]]
stored_width="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select data_json->>'width' from page_card_instances where id='$card_id' and archived_at is null;")"
[[ "$stored_width" == "SMALL" ]]

invalid_width_data='{"url":"https://cdn.example.com/image.png","alt":"bad width","width":"CUSTOM"}'
invalid_width_payload="$(printf '%s' "$invalid_width_data" | encode_data)"
invalid_width_id="$(cat /proc/sys/kernel/random/uuid)"
invalid_width_token="{{card:image|id=$invalid_width_id|v=1|data=$invalid_width_payload}}"
invalid_width_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":2,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$invalid_width_token\"}]}}" "$scratch/invalid-width.json")"
[[ "$invalid_width_status" == "400" ]]
[[ "$(problem_code < "$scratch/invalid-width.json")" == "INVALID_REQUEST" ]]

content_status="$(curl -sS -D "$scratch/content.headers" -o "$scratch/download.png" -w "%{http_code}" \
  -b "$admin_cookie" "$api_url/api/v1/attachments/$attachment_id/content")"
[[ "$content_status" == "200" ]]
[[ "$(sha256sum "$scratch/download.png" | cut -d' ' -f1)" == "$source_sha" ]]
grep -qi '^content-type: image/png' "$scratch/content.headers"
grep -qi '^content-disposition: inline' "$scratch/content.headers"
grep -qi '^x-content-type-options: nosniff' "$scratch/content.headers"

download_status="$(curl -sS -D "$scratch/download.headers" -o /dev/null -w "%{http_code}" \
  -b "$admin_cookie" "$api_url/api/v1/attachments/$attachment_id/content?download=true")"
[[ "$download_status" == "200" ]]
grep -qi '^content-disposition: attachment' "$scratch/download.headers"

list_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/attachments/list" \
  "{\"pageId\":\"$page_id\"}" "$scratch/list.json")"
[[ "$list_status" == "200" ]]
python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d)==3 and {x["id"] for x in d}==set(sys.argv[1:])' \
  "$attachment_id" "$gallery_attachment_id" "$search_attachment_id" < "$scratch/list.json"

unreferenced_status="$(curl -sS -o "$scratch/unreferenced.json" -w "%{http_code}" -b "$admin_cookie" \
  -H "$csrf_header: $csrf_token" -F "pageId=$page_id" \
  -F "file=@$scratch/source.png;type=image/png;filename=private-draft-only.png" \
  "$api_url/api/v1/attachments/upload")"
[[ "$unreferenced_status" == "201" ]]
unreferenced_id="$(json_value id < "$scratch/unreferenced.json")"

anonymous_status="$(curl -sS -o "$scratch/anonymous.json" -w "%{http_code}" \
  "$api_url/api/v1/attachments/$attachment_id/content")"
[[ "$anonymous_status" == "404" ]]

publish_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/publish" \
  "{\"pageId\":\"$page_id\",\"idempotencyKey\":\"attachment-public-v1\"}" "$scratch/publication.json")"
[[ "$publish_status" == "201" ]]
public_status="$(curl -sS -o "$scratch/public-download.png" -w "%{http_code}" \
  "$api_url/api/v1/attachments/$attachment_id/content")"
[[ "$public_status" == "200" ]]
[[ "$(sha256sum "$scratch/public-download.png" | cut -d' ' -f1)" == "$source_sha" ]]
gallery_public_status="$(curl -sS -o /dev/null -w "%{http_code}" \
  "$api_url/api/v1/attachments/$gallery_attachment_id/content")"
[[ "$gallery_public_status" == "200" ]]
unreferenced_public_status="$(curl -sS -o /dev/null -w "%{http_code}" \
  "$api_url/api/v1/attachments/$unreferenced_id/content")"
[[ "$unreferenced_public_status" == "404" ]]
public_alias_status="$(curl -sS -o /dev/null -w "%{http_code}" \
  "$api_url/api/public/v1/attachments/$attachment_id/content")"
[[ "$public_alias_status" == "200" ]]
unpublish_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/unpublish" \
  "{\"pageId\":\"$page_id\"}" "$scratch/unpublished.json")"
[[ "$unpublish_status" == "204" ]]
public_after_unpublish="$(curl -sS -o /dev/null -w "%{http_code}" \
  "$api_url/api/v1/attachments/$attachment_id/content")"
[[ "$public_after_unpublish" == "404" ]]
gallery_after_unpublish="$(curl -sS -o /dev/null -w "%{http_code}" \
  "$api_url/api/v1/attachments/$gallery_attachment_id/content")"
[[ "$gallery_after_unpublish" == "404" ]]

member_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "
  with inserted as (
    insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at)
    select gen_random_uuid(),'viewer@example.com','viewer@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now()
    from users where id='$admin_id' returning id
  ), membership as (
    insert into workspace_memberships(workspace_id,user_id,role,created_at)
    select '$workspace_id',id,'MEMBER',now() from inserted returning user_id
  ) select user_id from membership;")"
viewer_cookie="$scratch/viewer.cookies"
viewer_login_status="$(curl -sS -o /dev/null -w "%{http_code}" -c "$viewer_cookie" \
  -H "Content-Type: application/json" --data-binary '{"email":"viewer@example.com","password":"Admin-Password-2026!"}' \
  "$api_url/api/v1/auth/login/password")"
[[ "$viewer_login_status" == "204" ]]
viewer_csrf_json="$(curl -fsS -b "$viewer_cookie" "$api_url/api/v1/auth/csrf")"
viewer_csrf_header="$(printf "%s" "$viewer_csrf_json" | json_value headerName)"
viewer_csrf_token="$(printf "%s" "$viewer_csrf_json" | json_value token)"
[[ "$(post "$viewer_cookie" "$viewer_csrf_header" "$viewer_csrf_token" /api/v1/search "{\"workspaceId\":\"$workspace_id\",\"query\":\"青鸟校验七三一\",\"resourceTypes\":[\"ATTACHMENT\"],\"offset\":0,\"limit\":10}" "$scratch/viewer-public-search.json")" == 200 ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d["results"])==1 and d["results"][0]["resourceId"]==sys.argv[1],d' "$search_attachment_id" < "$scratch/viewer-public-search.json"
[[ "$(post "$viewer_cookie" "$viewer_csrf_header" "$viewer_csrf_token" /api/v1/search "{\"workspaceId\":\"$workspace_id\",\"query\":\"玄武隔离九二六\",\"resourceTypes\":[\"ATTACHMENT\"],\"offset\":0,\"limit\":10}" "$scratch/viewer-private-search.json")" == 200 ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["results"]==[] and d["hasMore"] is False,d' < "$scratch/viewer-private-search.json"
viewer_content_status="$(curl -sS -o "$scratch/viewer-download.png" -w "%{http_code}" -b "$viewer_cookie" \
  "$api_url/api/v1/attachments/$attachment_id/content")"
[[ "$viewer_content_status" == "200" ]]
[[ "$(sha256sum "$scratch/viewer-download.png" | cut -d' ' -f1)" == "$source_sha" ]]
viewer_delete_status="$(post "$viewer_cookie" "$viewer_csrf_header" "$viewer_csrf_token" "/api/v1/attachments/delete" \
  "{\"attachmentId\":\"$attachment_id\"}" "$scratch/viewer-delete.json")"
[[ "$viewer_delete_status" == "403" ]]
[[ "$(problem_code < "$scratch/viewer-delete.json")" == "AUTHORIZATION_DENIED" ]]

fake_workspace="$(cat /proc/sys/kernel/random/uuid)"
mismatch_status="$(curl -sS -o "$scratch/mismatch.json" -w "%{http_code}" -b "$admin_cookie" \
  -H "$csrf_header: $csrf_token" -F "workspaceId=$fake_workspace" -F "pageId=$page_id" \
  -F "file=@$scratch/source.png;type=image/png" "$api_url/api/v1/attachments/upload")"
[[ "$mismatch_status" == "404" ]]

: > "$scratch/empty.bin"
empty_status="$(curl -sS -o "$scratch/empty.json" -w "%{http_code}" -b "$admin_cookie" \
  -H "$csrf_header: $csrf_token" -F "pageId=$page_id" -F "file=@$scratch/empty.bin" \
  "$api_url/api/v1/attachments/upload")"
[[ "$empty_status" == "400" ]]
[[ "$(problem_code < "$scratch/empty.json")" == "INVALID_REQUEST" ]]

delete_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/attachments/delete" \
  "{\"attachmentId\":\"$attachment_id\"}" "$scratch/deleted.json")"
[[ "$delete_status" == "204" ]]
gallery_delete_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/attachments/delete" \
  "{\"attachmentId\":\"$gallery_attachment_id\"}" "$scratch/gallery-deleted.json")"
[[ "$gallery_delete_status" == "204" ]]
unreferenced_delete_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" "/api/v1/attachments/delete" \
  "{\"attachmentId\":\"$unreferenced_id\"}" "$scratch/unreferenced-deleted.json")"
[[ "$unreferenced_delete_status" == "204" ]]
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/attachments/delete "{\"attachmentId\":\"$search_attachment_id\"}" "$scratch/search-attachment-deleted.json")" == 204 ]]
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/attachments/delete "{\"attachmentId\":\"$private_attachment_id\"}" "$scratch/private-attachment-deleted.json")" == 204 ]]
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/search "{\"workspaceId\":\"$workspace_id\",\"query\":\"青鸟校验七三一\",\"resourceTypes\":[\"ATTACHMENT\"],\"offset\":0,\"limit\":10}" "$scratch/search-after-delete.json")" == 200 ]]
python3 -c 'import json,sys;assert json.load(sys.stdin)["results"]==[]' < "$scratch/search-after-delete.json"
deleted_content_status="$(curl -sS -o "$scratch/deleted-content.json" -w "%{http_code}" -b "$admin_cookie" \
  "$api_url/api/v1/attachments/$attachment_id/content")"
[[ "$deleted_content_status" == "404" ]]

db_counts="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from attachments),
  (select count(*) from attachments where deleted_at is null),
  (select count(*) from audit_events where action in ('attachment.upload','attachment.delete')),
  (select count(*) from page_card_instances where archived_at is null),
  (select count(*) from publication_attachments);")"
[[ "$db_counts" == "5|0|10|2|2" ]]
object_count="$(docker exec "$api" sh -c 'find /tmp/knowledge-attachments -type f | wc -l')"
[[ "$object_count" == "0" ]]

echo "ATTACHMENT_E2E_COUNTS"
echo "$db_counts|$object_count"
echo "ATTACHMENT_E2E_SUCCESS"
