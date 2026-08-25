#!/usr/bin/env bash
set -Eeuo pipefail
trap 'status=$?; echo "Knowledge-base share E2E failed at line $LINENO" >&2; if [[ -n "${api:-}" ]]; then docker logs "$api" 2>&1 | sed -n "/ERROR/,$ p" >&2 || true; fi; exit "$status"' ERR
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."&&pwd)";jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}";[[ -f "$jar" ]];suffix="kp-kb-share-$(date +%s)-$$";net="$suffix-net";db="$suffix-db";api="$suffix-api";tmp="$(mktemp -d /tmp/kp-kb-share.XXXXXX)";internal="$(openssl rand -hex 32)"
cleanup(){ docker rm -f "$api" "$db" >/dev/null 2>&1||true;docker network rm "$net" >/dev/null 2>&1||true;case "$tmp" in /tmp/kp-kb-share.*)rm -rf -- "$tmp";;esac;};trap cleanup EXIT
wait_for(){ local label="$1";shift;for _ in $(seq 1 90);do "$@" >/dev/null 2>&1&&return;sleep 1;done;echo "timeout $label";docker logs "$api";return 1;};val(){ python3 -c 'import json,sys;print(json.load(sys.stdin)[sys.argv[1]])' "$1";};post(){ local path="$1" data="$2" out="$3";curl -sS -o "$out" -w '%{http_code}' -b "$cookie" -H "$header: $token" -H 'Content-Type: application/json' --data-binary "$data" "$url$path";};session_post(){ local session_cookie="$1" session_header="$2" session_token="$3" path="$4" data="$5" out="$6";curl -sS -o "$out" -w '%{http_code}' -b "$session_cookie" -H "$session_header: $session_token" -H 'Content-Type: application/json' --data-binary "$data" "$url$path";};anon(){ local path="$1" data="$2" out="$3";curl -sS -o "$out" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "$data" "$url$path";}
docker network create "$net" >/dev/null;docker run -d --name "$db" --network "$net" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null;wait_for db docker exec "$db" pg_isready -U knowledge -d knowledge
docker run -d --name "$api" --network "$net" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" -e COLLAB_INTERNAL_TOKEN="$internal" -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null;port="$(docker port "$api" 8080/tcp|sed -n 's/.*://p'|head -1)";url="http://127.0.0.1:$port";wait_for api curl -fsS "$url/actuator/health"
cookie="$tmp/c";code="$(curl -sS -o "$tmp/setup" -w '%{http_code}' -c "$cookie" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Share Workspace"}' "$url/api/v1/setup/initialize")";[[ "$code" == 201 ]];ws="$(val workspaceId < "$tmp/setup")";csrf="$(curl -fsS -b "$cookie" "$url/api/v1/auth/csrf")";header="$(printf %s "$csrf"|val headerName)";token="$(printf %s "$csrf"|val token)"
code="$(post /api/v1/knowledge-bases/create "{\"workspaceId\":\"$ws\",\"name\":\"Engineering Handbook\",\"slug\":\"engineering\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$ws\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" "$tmp/kb")";[[ "$code" == 201 ]];kb="$(val id < "$tmp/kb")"
create_page(){ local title="$1" path="$2" visibility="$3" out="$4";local code;code="$(post /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"$title\",\"path\":\"$path\",\"contentType\":\"DOCUMENT\",\"visibilityOverride\":\"$visibility\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$title body\"}]}}" "$out")";[[ "$code" == 201 ]];}
create_page "Getting Started" start INHERIT "$tmp/start";page_start="$(val id < "$tmp/start")"
create_page "Deployment" deploy PUBLIC "$tmp/deploy";page_deploy="$(val id < "$tmp/deploy")"
create_page "Unlisted Secret" unlisted INHERIT "$tmp/unlisted";page_unlisted="$(val id < "$tmp/unlisted")"
create_page "Private Override" private PRIVATE "$tmp/private";page_private="$(val id < "$tmp/private")"
create_page "Workspace Override" workspace WORKSPACE "$tmp/workspace";page_workspace="$(val id < "$tmp/workspace")"
code="$(post /api/v1/catalog/create "{\"knowledgeBaseId\":\"$kb\",\"nodeType\":\"GROUP\",\"titleOverride\":\"Operations\",\"expectedRevision\":0}" "$tmp/group")";[[ "$code" == 201 ]];group="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["nodes"][0]["id"])' < "$tmp/group")"
revision=1
for page in "$page_start" "$page_deploy" "$page_private" "$page_workspace";do code="$(post /api/v1/catalog/create "{\"knowledgeBaseId\":\"$kb\",\"nodeType\":\"DOCUMENT\",\"pageId\":\"$page\",\"parentId\":\"$group\",\"expectedRevision\":$revision}" "$tmp/node-$revision")";[[ "$code" == 201 ]];revision=$((revision+1));done
for page in "$page_start" "$page_deploy" "$page_unlisted" "$page_private" "$page_workspace";do code="$(post /api/v1/pages/publish "{\"pageId\":\"$page\",\"idempotencyKey\":\"publish-$page\"}" "$tmp/pub-$page")";[[ "$code" == 201 ]];done
code="$(post /api/v1/shares/create "{\"resourceType\":\"KNOWLEDGE_BASE\",\"resourceId\":\"$kb\",\"shareType\":\"PUBLIC\",\"password\":\"Reader-Password-2026!\",\"role\":\"COMMENTER\",\"allowCopy\":false,\"allowDownload\":true,\"allowExport\":true,\"allowComment\":true,\"allowSearchIndex\":false}" "$tmp/share")";[[ "$code" == 201 ]];share_id="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["share"]["id"])' < "$tmp/share")";share_token="$(val token < "$tmp/share")"
code="$(post /api/v1/shares/list "{\"resourceType\":\"KNOWLEDGE_BASE\",\"resourceId\":\"$kb\"}" "$tmp/list")";[[ "$code" == 200 ]];python3 - "$tmp/list" "$kb" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]));assert len(v)==1 and v[0]['resourceType']=='KNOWLEDGE_BASE' and v[0]['resourceId']==sys.argv[2],v
PY
code="$(anon /api/v1/shares/resolve "{\"token\":\"$share_token\"}" "$tmp/locked")";[[ "$code" == 200 ]];[[ "$(val passwordRequired < "$tmp/locked")" == True ]]
code="$(anon /api/v1/shares/verify-password "{\"token\":\"$share_token\",\"password\":\"Reader-Password-2026!\"}" "$tmp/access")";[[ "$code" == 200 ]];access="$(val accessToken < "$tmp/access")"
code="$(anon /api/v1/shares/resolve "{\"token\":\"$share_token\",\"accessToken\":\"$access\",\"pageId\":\"$page_deploy\"}" "$tmp/reader")";[[ "$code" == 200 ]]
python3 - "$tmp/reader" "$kb" "$page_deploy" "$page_unlisted" "$page_private" "$page_workspace" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));kb=r['knowledgeBase'];assert kb['id']==sys.argv[2] and kb['selectedPageId']==sys.argv[3],r
ids={p['pageId'] for p in kb['pages']};assert ids=={r['publication']['pageId'], next(p['pageId'] for p in kb['pages'] if p['pageId']!=r['publication']['pageId'])},ids
assert len(ids)==2 and not ids.intersection(sys.argv[4:]),ids
assert len(kb['catalog'])==3 and r['publication']['title']=='Deployment',r
PY
code="$(anon /api/v1/shares/resolve "{\"token\":\"$share_token\",\"accessToken\":\"$access\",\"pageId\":\"$page_unlisted\"}" "$tmp/unlisted-reader")";[[ "$code" == 200 ]];[[ "$(python3 -c 'import json,sys;print(json.load(sys.stdin)["knowledgeBase"]["selectedPageId"])' < "$tmp/unlisted-reader")" != "$page_unlisted" ]]
code="$(curl -sS -o "$tmp/download.txt" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"token\":\"$share_token\",\"accessToken\":\"$access\"}" "$url/api/v1/shares/download")";[[ "$code" == 200 ]];grep -q 'Getting Started body' "$tmp/download.txt";grep -q 'Deployment body' "$tmp/download.txt";! grep -q 'Unlisted Secret' "$tmp/download.txt";! grep -q 'Private Override' "$tmp/download.txt"
code="$(curl -sS -o "$tmp/export.json" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"token\":\"$share_token\",\"accessToken\":\"$access\"}" "$url/api/v1/shares/export")";[[ "$code" == 200 ]];python3 - "$tmp/export.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]));assert v['knowledgeBase']['name']=='Engineering Handbook' and len(v['publications'])==2,v
PY
code="$(post /api/v1/shares/comments/create "{\"token\":\"$share_token\",\"accessToken\":\"$access\",\"pageId\":\"$page_deploy\",\"anchor\":{\"kind\":\"SHARED_PAGE\"},\"body\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"Shared KB comment\"}]},\"plainText\":\"Shared KB comment\"}" "$tmp/comment")";[[ "$code" == 201 ]]
code="$(anon /api/v1/shares/comments/list "{\"token\":\"$share_token\",\"accessToken\":\"$access\",\"pageId\":\"$page_deploy\"}" "$tmp/comments")";[[ "$code" == 200 ]];[[ "$(python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["plainText"])' < "$tmp/comments")" == 'Shared KB comment' ]]

# An editor invitation is a gated, authenticated grant rather than a public reader.
invitee_id="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "
  with inserted as (
    insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at)
    select gen_random_uuid(),'invitee@example.com','invitee@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now()
    from users where email_normalized='admin@example.com' returning id
  ) select id from inserted;")"
invitee_cookie="$tmp/invitee-cookie"
code="$(curl -sS -o "$tmp/invitee-login" -w '%{http_code}' -c "$invitee_cookie" -H 'Content-Type: application/json' --data-binary '{"email":"invitee@example.com","password":"Admin-Password-2026!"}' "$url/api/v1/auth/login/password")";[[ "$code" == 204 ]]
invitee_csrf="$(curl -fsS -b "$invitee_cookie" "$url/api/v1/auth/csrf")";invitee_header="$(printf %s "$invitee_csrf"|val headerName)";invitee_token="$(printf %s "$invitee_csrf"|val token)"
code="$(post /api/v1/shares/create "{\"resourceType\":\"KNOWLEDGE_BASE\",\"resourceId\":\"$kb\",\"shareType\":\"INVITE_LINK\",\"role\":\"EDITOR\",\"requireApproval\":true,\"allowDownload\":true,\"allowSearchIndex\":true}" "$tmp/kb-invite")";[[ "$code" == 201 ]];kb_invite_id="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["share"]["id"])' < "$tmp/kb-invite")";kb_invite_token="$(val token < "$tmp/kb-invite")"
python3 - "$tmp/kb-invite" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))['share']
assert s['shareType']=='INVITE_LINK' and s['role']=='EDITOR' and s['allowSearchIndex'] is False,s
PY
code="$(anon /api/v1/shares/resolve "{\"token\":\"$kb_invite_token\"}" "$tmp/kb-invite-anon")";[[ "$code" == 200 ]];python3 - "$tmp/kb-invite-anon" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert r['approvalRequired'] is True and r['approvalStatus']=='AUTHENTICATION_REQUIRED',r
assert r['publication'] is None and r['knowledgeBase'] is None,r
PY
code="$(session_post "$invitee_cookie" "$invitee_header" "$invitee_token" /api/v1/shares/resolve "{\"token\":\"$kb_invite_token\"}" "$tmp/kb-invite-not-requested")";[[ "$code" == 200 ]];[[ "$(val approvalStatus < "$tmp/kb-invite-not-requested")" == NOT_REQUESTED ]]
code="$(session_post "$invitee_cookie" "$invitee_header" "$invitee_token" /api/v1/shares/request-join "{\"token\":\"$kb_invite_token\",\"message\":\"Joining the handbook team\"}" "$tmp/kb-invite-request")";[[ "$code" == 200 ]];kb_request_id="$(val id < "$tmp/kb-invite-request")";[[ "$(val status < "$tmp/kb-invite-request")" == PENDING ]]
code="$(post /api/v1/shares/review-request "{\"requestId\":\"$kb_request_id\",\"decision\":\"APPROVE\"}" "$tmp/kb-invite-approved")";[[ "$code" == 200 ]];[[ "$(val status < "$tmp/kb-invite-approved")" == APPROVED ]]
code="$(session_post "$invitee_cookie" "$invitee_header" "$invitee_token" /api/v1/shares/resolve "{\"token\":\"$kb_invite_token\"}" "$tmp/kb-invite-pending")";[[ "$code" == 200 ]];python3 - "$tmp/kb-invite-pending" "$kb" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert r['acceptanceRequired'] is True and r['destinationKnowledgeBaseId']==sys.argv[2],r
assert r['publication'] is None and r['knowledgeBase'] is None,r
PY
code="$(session_post "$invitee_cookie" "$invitee_header" "$invitee_token" /api/v1/shares/download "{\"token\":\"$kb_invite_token\"}" "$tmp/kb-invite-download-before")";[[ "$code" == 403 ]]
code="$(session_post "$invitee_cookie" "$invitee_header" "$invitee_token" /api/v1/shares/accept-invite "{\"token\":\"$kb_invite_token\"}" "$tmp/kb-invite-accept")";[[ "$code" == 200 ]];python3 - "$tmp/kb-invite-accept" "$kb" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert r['resourceType']=='KNOWLEDGE_BASE' and r['resourceId']==sys.argv[2] and r['knowledgeBaseId']==sys.argv[2],r
assert r['role']=='EDITOR' and r['alreadyAccepted'] is False,r
PY
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select wm.role||'|'||km.role from workspace_memberships wm join knowledge_base_members km on km.user_id=wm.user_id and km.knowledge_base_id='$kb' where wm.workspace_id='$ws' and wm.user_id='$invitee_id';")" == 'MEMBER|EDITOR' ]]
code="$(session_post "$invitee_cookie" "$invitee_header" "$invitee_token" /api/v1/shares/resolve "{\"token\":\"$kb_invite_token\"}" "$tmp/kb-invite-accepted")";[[ "$code" == 200 ]];[[ "$(val acceptanceRequired < "$tmp/kb-invite-accepted")" == False ]]
code="$(session_post "$invitee_cookie" "$invitee_header" "$invitee_token" /api/v1/shares/accept-invite "{\"token\":\"$kb_invite_token\"}" "$tmp/kb-invite-idempotent")";[[ "$code" == 200 ]];[[ "$(val alreadyAccepted < "$tmp/kb-invite-idempotent")" == True ]]
code="$(post /api/v1/shares/reset-token "{\"shareId\":\"$kb_invite_id\"}" "$tmp/kb-invite-reset")";[[ "$code" == 200 ]];code="$(anon /api/v1/shares/resolve "{\"token\":\"$kb_invite_token\"}" "$tmp/kb-invite-old")";[[ "$code" == 410 ]]
code="$(session_post "$invitee_cookie" "$invitee_header" "$invitee_token" /api/v1/authorization/resolve "{\"resourceType\":\"KNOWLEDGE_BASE\",\"resourceId\":\"$kb\"}" "$tmp/kb-invite-permission")";[[ "$code" == 200 ]];python3 - "$tmp/kb-invite-permission" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert 'READ' in r['capabilities'] and 'EDIT' in r['capabilities'],r
PY

# A read-only page invitation creates an EXTERNAL workspace member and an exact READ ACL.
page_reader_id="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "
  with inserted as (
    insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at)
    select gen_random_uuid(),'page-reader@example.com','page-reader@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now()
    from users where email_normalized='admin@example.com' returning id
  ) select id from inserted;")"
page_reader_cookie="$tmp/page-reader-cookie"
code="$(curl -sS -o "$tmp/page-reader-login" -w '%{http_code}' -c "$page_reader_cookie" -H 'Content-Type: application/json' --data-binary '{"email":"page-reader@example.com","password":"Admin-Password-2026!"}' "$url/api/v1/auth/login/password")";[[ "$code" == 204 ]]
page_reader_csrf="$(curl -fsS -b "$page_reader_cookie" "$url/api/v1/auth/csrf")";page_reader_header="$(printf %s "$page_reader_csrf"|val headerName)";page_reader_token="$(printf %s "$page_reader_csrf"|val token)"
code="$(post /api/v1/shares/create "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page_deploy\",\"shareType\":\"INVITE_LINK\",\"role\":\"READER\"}" "$tmp/page-invite")";[[ "$code" == 201 ]];page_invite_id="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["share"]["id"])' < "$tmp/page-invite")";page_invite_token="$(val token < "$tmp/page-invite")"
code="$(session_post "$page_reader_cookie" "$page_reader_header" "$page_reader_token" /api/v1/shares/resolve "{\"token\":\"$page_invite_token\"}" "$tmp/page-invite-pending")";[[ "$code" == 200 ]];[[ "$(val acceptanceRequired < "$tmp/page-invite-pending")" == True ]]
code="$(session_post "$page_reader_cookie" "$page_reader_header" "$page_reader_token" /api/v1/shares/accept-invite "{\"token\":\"$page_invite_token\"}" "$tmp/page-invite-accept")";[[ "$code" == 200 ]];[[ "$(val alreadyAccepted < "$tmp/page-invite-accept")" == False ]]
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select wm.role||'|'||coalesce(a.role,'NULL')||'|'||(a.capabilities::text) from workspace_memberships wm join acl_entries a on a.workspace_id=wm.workspace_id and a.subject_id=wm.user_id and a.resource_type='PAGE' and a.resource_id='$page_deploy' and a.deleted_at is null where wm.workspace_id='$ws' and wm.user_id='$page_reader_id';")" == 'EXTERNAL|NULL|["READ"]' ]]
code="$(session_post "$page_reader_cookie" "$page_reader_header" "$page_reader_token" /api/v1/authorization/resolve "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page_deploy\"}" "$tmp/page-invite-permission")";[[ "$code" == 200 ]];python3 - "$tmp/page-invite-permission" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert 'READ' in r['capabilities'] and 'COMMENT' not in r['capabilities'] and 'EDIT' not in r['capabilities'],r
PY
code="$(post /api/v1/shares/revoke "{\"shareId\":\"$page_invite_id\"}" "$tmp/page-invite-revoke")";[[ "$code" == 204 ]]
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select count(*) from acl_entries where resource_type='PAGE' and resource_id='$page_deploy' and subject_id='$page_reader_id' and deleted_at is null;")" == 1 ]]

code="$(post /api/v1/shares/reset-token "{\"shareId\":\"$share_id\"}" "$tmp/reset")";[[ "$code" == 200 ]];new_token="$(val token < "$tmp/reset")";[[ "$new_token" != "$share_token" ]]
code="$(anon /api/v1/shares/resolve "{\"token\":\"$share_token\"}" "$tmp/old")";[[ "$code" == 410 ]];code="$(anon /api/v1/shares/resolve "{\"token\":\"$new_token\"}" "$tmp/new")";[[ "$code" == 200 ]];[[ "$(val passwordRequired < "$tmp/new")" == True ]]
echo "KNOWLEDGE_BASE_SHARE_PAGES"
python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["knowledgeBase"]["pages"]))' "$tmp/reader"
echo "KNOWLEDGE_BASE_SHARE_E2E_SUCCESS"
