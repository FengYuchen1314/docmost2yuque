#!/usr/bin/env bash
set -Eeuo pipefail
trap 'status=$?; echo "User-group ACL E2E failed at line $LINENO" >&2; if [[ -n "${api:-}" ]]; then docker logs "$api" 2>&1 | sed -n "/ERROR/,$ p" >&2 || true; fi; exit "$status"' ERR

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}"
[[ -f "$jar" ]]
suffix="kp-user-group-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
api="$suffix-api"
scratch="$(mktemp -d /tmp/kp-user-group.XXXXXX)"
cleanup(){ docker rm -f "$api" "$database" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; case "$scratch" in /tmp/kp-user-group.*) rm -rf -- "$scratch";; esac; }
trap cleanup EXIT
wait_for(){ local label="$1"; shift; for _ in $(seq 1 90); do "$@" >/dev/null 2>&1 && return; sleep 1; done; echo "timeout $label" >&2; return 1; }
value(){ python3 -c 'import json,sys;print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
post(){ local session_cookie="$1" csrf_header="$2" csrf_token="$3" path="$4" body="$5" output="$6"; curl -sS -o "$output" -w '%{http_code}' -b "$session_cookie" -H "$csrf_header: $csrf_token" -H 'Content-Type: application/json' --data-binary "$body" "$url$path"; }

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null
wait_for database docker exec "$database" pg_isready -U knowledge -d knowledge
docker run -d --name "$api" --network "$network" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" -e COLLAB_INTERNAL_TOKEN="$(openssl rand -hex 32)" -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null
port="$(docker port "$api" 8080/tcp | sed -n 's/.*://p' | head -1)"
url="http://127.0.0.1:$port"
wait_for api curl -fsS "$url/actuator/health"

admin_cookie="$scratch/admin-cookie"
code="$(curl -sS -o "$scratch/setup" -w '%{http_code}' -c "$admin_cookie" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Group Workspace"}' "$url/api/v1/setup/initialize")"
[[ "$code" == 201 ]]
workspace_id="$(value workspaceId < "$scratch/setup")"
csrf="$(curl -fsS -b "$admin_cookie" "$url/api/v1/auth/csrf")"
admin_header="$(printf %s "$csrf" | value headerName)"
admin_token="$(printf %s "$csrf" | value token)"

code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/knowledge-bases/create "{\"workspaceId\":\"$workspace_id\",\"name\":\"Authorization Lab\",\"slug\":\"authorization-lab\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$workspace_id\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" "$scratch/kb")"
[[ "$code" == 201 ]]
knowledge_base_id="$(value id < "$scratch/kb")"
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/pages/create "{\"knowledgeBaseId\":\"$knowledge_base_id\",\"title\":\"Group protected page\",\"path\":\"group-protected\",\"contentType\":\"DOCUMENT\"}" "$scratch/page")"
[[ "$code" == 201 ]]
page_id="$(value id < "$scratch/page")"

member_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "
  with inserted as (
    insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at)
    select gen_random_uuid(),'member@example.com','member@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now()
    from users where email_normalized='admin@example.com' returning id
  ), membership as (
    insert into workspace_memberships(workspace_id,user_id,role,created_at)
    select '$workspace_id',id,'MEMBER',now() from inserted returning user_id
  ) select user_id from membership;")"
member_cookie="$scratch/member-cookie"
code="$(curl -sS -o "$scratch/member-login" -w '%{http_code}' -c "$member_cookie" -H 'Content-Type: application/json' --data-binary '{"email":"member@example.com","password":"Admin-Password-2026!"}' "$url/api/v1/auth/login/password")"
[[ "$code" == 204 ]]
member_csrf="$(curl -fsS -b "$member_cookie" "$url/api/v1/auth/csrf")"
member_header="$(printf %s "$member_csrf" | value headerName)"
member_token="$(printf %s "$member_csrf" | value token)"

code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/user-groups/create "{\"workspaceId\":\"$workspace_id\",\"name\":\"Reviewers\",\"description\":\"Release reviewers\"}" "$scratch/group")"
[[ "$code" == 201 ]]
group_id="$(value id < "$scratch/group")"
[[ "$(value memberCount < "$scratch/group")" == 0 ]]
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/user-groups/create "{\"workspaceId\":\"$workspace_id\",\"name\":\"reviewers\"}" "$scratch/group-duplicate")"
[[ "$code" == 409 ]]
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/user-groups/members/add "{\"groupId\":\"$group_id\",\"userId\":\"$member_id\"}" "$scratch/group-members")"
[[ "$code" == 200 ]]
[[ "$(python3 -c 'import json,sys;print(len(json.load(sys.stdin)))' < "$scratch/group-members")" == 1 ]]
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/authorization/grant "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page_id\",\"subjectType\":\"GROUP\",\"subjectId\":\"$group_id\",\"role\":\"EDITOR\",\"effect\":\"ALLOW\",\"capabilities\":[]}" "$scratch/group-acl")"
[[ "$code" == 201 ]]
code="$(post "$member_cookie" "$member_header" "$member_token" /api/v1/authorization/resolve "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page_id\"}" "$scratch/group-resolve")"
[[ "$code" == 200 ]]
python3 - "$scratch/group-resolve" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert 'READ' in r['capabilities'] and 'EDIT' in r['capabilities'],r
assert 'acl:allow' in r['sources'],r
PY

code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/user-groups/members/remove "{\"groupId\":\"$group_id\",\"userId\":\"$member_id\"}" "$scratch/group-member-removed")"
[[ "$code" == 200 ]]
code="$(post "$member_cookie" "$member_header" "$member_token" /api/v1/authorization/resolve "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page_id\"}" "$scratch/group-resolve-removed")"
[[ "$code" == 200 ]]
python3 - "$scratch/group-resolve-removed" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert 'EDIT' not in r['capabilities'] and 'acl:allow' not in r['sources'],r
PY
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/user-groups/members/add "{\"groupId\":\"$group_id\",\"userId\":\"$member_id\"}" "$scratch/group-member-readded")"
[[ "$code" == 200 ]]
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/user-groups/delete "{\"groupId\":\"$group_id\"}" "$scratch/group-deleted")"
[[ "$code" == 204 ]]
code="$(post "$member_cookie" "$member_header" "$member_token" /api/v1/authorization/resolve "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page_id\"}" "$scratch/group-resolve-deleted")"
[[ "$code" == 200 ]]
python3 - "$scratch/group-resolve-deleted" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert 'EDIT' not in r['capabilities'] and 'acl:allow' not in r['sources'],r
PY

# Team ACLs must also stop matching after the user leaves the workspace, even if a stale team row remains.
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/teams/create "{\"workspaceId\":\"$workspace_id\",\"name\":\"Legacy Team\",\"slug\":\"legacy-team\",\"visibility\":\"PRIVATE\"}" "$scratch/team")"
[[ "$code" == 201 ]]
team_id="$(value id < "$scratch/team")"
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/teams/members/add "{\"teamId\":\"$team_id\",\"userId\":\"$member_id\",\"role\":\"MEMBER\"}" "$scratch/team-member")"
[[ "$code" == 200 ]]
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/authorization/grant "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page_id\",\"subjectType\":\"TEAM\",\"subjectId\":\"$team_id\",\"role\":\"EDITOR\",\"effect\":\"ALLOW\",\"capabilities\":[]}" "$scratch/team-acl")"
[[ "$code" == 201 ]]
code="$(post "$member_cookie" "$member_header" "$member_token" /api/v1/authorization/resolve "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page_id\"}" "$scratch/team-resolve")"
[[ "$code" == 200 ]]
python3 - "$scratch/team-resolve" <<'PY'
import json,sys
assert 'EDIT' in json.load(open(sys.argv[1]))['capabilities']
PY
code="$(post "$admin_cookie" "$admin_header" "$admin_token" /api/v1/workspaces/members/remove "{\"workspaceId\":\"$workspace_id\",\"userId\":\"$member_id\"}" "$scratch/workspace-member-removed")"
[[ "$code" == 204 ]]
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select (select count(*) from workspace_user_group_members where user_id='$member_id')||'|'||(select count(*) from team_members where user_id='$member_id');")" == '0|1' ]]
code="$(post "$member_cookie" "$member_header" "$member_token" /api/v1/authorization/resolve "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page_id\"}" "$scratch/team-resolve-after-workspace-removal")"
[[ "$code" == 200 ]]
python3 - "$scratch/team-resolve-after-workspace-removal" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert 'READ' not in r['capabilities'] and 'EDIT' not in r['capabilities'],r
assert 'acl:allow' not in r['sources'],r
PY

echo USER_GROUP_ACL_E2E_SUCCESS
