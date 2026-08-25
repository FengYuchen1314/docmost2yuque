#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Core domain E2E failed at line $LINENO" >&2' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_jar="${API_JAR:-$project_root/backend/app-api/build/libs/knowledge-platform-api.jar}"
if [[ ! -f "$api_jar" ]]; then
  echo "Build the API jar before running this script." >&2
  exit 1
fi

suffix="kp-core-e2e-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
api="$suffix-api"
scratch="$(mktemp -d /tmp/kp-core-e2e.XXXXXX)"

cleanup() {
  docker rm -f "$api" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  case "$scratch" in
    /tmp/kp-core-e2e.*) rm -rf -- "$scratch" ;;
  esac
}
trap cleanup EXIT

wait_for() {
  local description="$1"
  shift
  for _ in $(seq 1 90); do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
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

encode_data() {
  python3 -c 'import base64,sys; print(base64.urlsafe_b64encode(sys.stdin.buffer.read()).decode().rstrip("="))'
}

post() {
  local cookie="$1"
  local csrf_header="$2"
  local csrf_token="$3"
  local path="$4"
  local data="$5"
  local output="$6"
  curl -sS -o "$output" -w "%{http_code}" -b "$cookie" \
    -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" \
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
    "workspaceName":"Primary Workspace"
  }' "$api_url/api/v1/setup/initialize")"
[[ "$setup_status" == "201" ]]
admin_id="$(json_value userId < "$scratch/setup.json")"
workspace_id="$(json_value workspaceId < "$scratch/setup.json")"

csrf_json="$(curl -fsS -b "$admin_cookie" "$api_url/api/v1/auth/csrf")"
csrf_header="$(printf "%s" "$csrf_json" | json_value headerName)"
csrf_token="$(printf "%s" "$csrf_json" | json_value token)"

team_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/teams/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Platform Team\",\"slug\":\"platform-team\",\"visibility\":\"WORKSPACE\"}" \
  "$scratch/team.json")"
[[ "$team_status" == "201" ]]
team_id="$(json_value id < "$scratch/team.json")"

last_manager_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/teams/members/update" \
  "{\"teamId\":\"$team_id\",\"userId\":\"$admin_id\",\"role\":\"MEMBER\"}" \
  "$scratch/last-manager.json")"
[[ "$last_manager_status" == "409" ]]
[[ "$(problem_code < "$scratch/last-manager.json")" == "TEAM_LAST_MANAGER" ]]

last_manager_leave_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/teams/members/leave" \
  "{\"teamId\":\"$team_id\"}" \
  "$scratch/last-manager-leave.json")"
[[ "$last_manager_leave_status" == "409" ]]
[[ "$(problem_code < "$scratch/last-manager-leave.json")" == "TEAM_LAST_MANAGER" ]]

kb_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-bases/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Engineering Handbook\",\"slug\":\"engineering-handbook\",\"ownerType\":\"TEAM\",\"ownerId\":\"$team_id\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" \
  "$scratch/kb.json")"
[[ "$kb_status" == "201" ]]
kb_id="$(json_value id < "$scratch/kb.json")"

page1_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/create" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"title\":\"Getting Started\",\"path\":\"getting-started\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"hello knowledge\"}]}}" \
  "$scratch/page1.json")"
[[ "$page1_status" == "201" ]]
page1_id="$(json_value id < "$scratch/page1.json")"

page2_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/create" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"title\":\"Architecture\",\"path\":\"architecture\",\"contentType\":\"WHITEBOARD\"}" \
  "$scratch/page2.json")"
[[ "$page2_status" == "201" ]]
page2_id="$(json_value id < "$scratch/page2.json")"

page_update_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/update" \
  "{\"pageId\":\"$page1_id\",\"expectedRevision\":0,\"title\":\"Getting Started Now\",\"content\":{\"type\":\"doc\",\"content\":[{\"text\":\"updated body\"}]},\"revisionKind\":\"MANUAL\",\"revisionDescription\":\"first manual save\"}" \
  "$scratch/page-update.json")"
[[ "$page_update_status" == "200" ]]
[[ "$(json_value draftRevision < "$scratch/page-update.json")" == "1" ]]

page_update_two_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/update" \
  "{\"pageId\":\"$page1_id\",\"expectedRevision\":1,\"title\":\"Getting Started Now\",\"content\":{\"type\":\"doc\",\"content\":[{\"text\":\"updated body\"}]},\"revisionKind\":\"AUTO\",\"revisionDescription\":\"second save for pagination\"}" \
  "$scratch/page-update-two.json")"
[[ "$page_update_two_status" == "200" ]]
[[ "$(json_value draftRevision < "$scratch/page-update-two.json")" == "2" ]]

[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/history/page" \
  "{\"pageId\":\"$page1_id\",\"limit\":1,\"offset\":0}" \
  "$scratch/page-history-one.json")" == "200" ]]
page_history_next="$(json_value nextOffset < "$scratch/page-history-one.json")"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/history/page" \
  "{\"pageId\":\"$page1_id\",\"limit\":1,\"offset\":$page_history_next}" \
  "$scratch/page-history-two.json")" == "200" ]]
python3 - "$scratch/page-history-one.json" "$scratch/page-history-two.json" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))
assert one['hasMore'] is True and one['nextOffset']==1 and len(one['items'])==1,one
assert two['hasMore'] is False and two['nextOffset']==2 and len(two['items'])==1,two
assert [one['items'][0]['revisionNo'],two['items'][0]['revisionNo']]==[2,1],(one,two)
assert one['items'][0]['id']!=two['items'][0]['id'],(one,two)
PY

history_copy_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/history/copy" \
  "{\"pageId\":\"$page1_id\",\"revisionNo\":1,\"title\":\"Getting Started Historical Copy\",\"path\":\"getting-started-history-copy\"}" \
  "$scratch/page-history-copy.json")"
[[ "$history_copy_status" == "201" ]]
history_copy_id="$(json_value id < "$scratch/page-history-copy.json")"
python3 - "$scratch/page-history-copy.json" "$page1_id" <<'PY'
import json,sys
copy=json.load(open(sys.argv[1]))
assert copy['id']!=sys.argv[2],copy
assert copy['title']=='Getting Started Historical Copy',copy
assert copy['path']=='getting-started-history-copy',copy
assert copy['draftRevision']==1,copy
assert copy['plainText']=='updated body',copy
assert copy['publishedRevisionId'] is None and copy['publishedAt'] is None,copy
PY
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/history/page" \
  "{\"pageId\":\"$history_copy_id\",\"limit\":30,\"offset\":0}" \
  "$scratch/page-history-copy-history.json")" == "200" ]]
python3 - "$scratch/page-history-copy-history.json" <<'PY'
import json,sys
history=json.load(open(sys.argv[1]))
assert len(history['items'])==1 and history['items'][0]['revisionNo']==1,history
assert history['items'][0]['plainText']=='updated body',history
assert 'revision 1' in (history['items'][0]['description'] or ''),history
PY

[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/labels/update" \
  "{\"pageId\":\"$page1_id\",\"expectedRevision\":0,\"labels\":[{\"name\":\"正式稿\",\"color\":\"#4F7F60\"}]}" \
  "$scratch/page-labels-before-copy.json")" == "200" ]]

current_copy_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/copy" \
  "{\"pageId\":\"$page1_id\",\"targetKnowledgeBaseId\":\"$kb_id\",\"title\":\"Getting Started Draft Copy\",\"path\":\"getting-started-draft-copy\"}" \
  "$scratch/page-current-copy.json")"
[[ "$current_copy_status" == "201" ]]
current_copy_id="$(json_value id < "$scratch/page-current-copy.json")"
python3 - "$scratch/page-current-copy.json" "$page1_id" <<'PY'
import json,sys
copy=json.load(open(sys.argv[1]))
assert copy['id']!=sys.argv[2],copy
assert copy['title']=='Getting Started Draft Copy' and copy['path']=='getting-started-draft-copy',copy
assert copy['draftRevision']==1 and copy['plainText']=='updated body',copy
assert copy['publishedRevisionId'] is None and copy['publishedAt'] is None,copy
PY
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/labels" "{\"pageId\":\"$current_copy_id\"}" \
  "$scratch/page-current-copy-labels.json")" == "200" ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["revision"]==1 and [(i["name"],i["color"]) for i in d["labels"]]==[("正式稿","#4F7F60")],d' < "$scratch/page-current-copy-labels.json"
copy_policy_counts="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from page_publications where page_id='$current_copy_id'),
  (select count(*) from shares where resource_type='PAGE' and resource_id='$current_copy_id'),
  (select count(*) from acl_entries where resource_type='PAGE' and resource_id='$current_copy_id');")"
[[ "$copy_policy_counts" == "0|0|0" ]]

stale_page_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/update" \
  "{\"pageId\":\"$page1_id\",\"expectedRevision\":0,\"title\":\"stale overwrite\"}" \
  "$scratch/stale-page.json")"
[[ "$stale_page_status" == "409" ]]
[[ "$(problem_code < "$scratch/stale-page.json")" == "PAGE_REVISION_CONFLICT" ]]

catalog_group_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/create" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"nodeType\":\"GROUP\",\"titleOverride\":\"Basics\",\"expectedRevision\":0}" \
  "$scratch/catalog-group.json")"
[[ "$catalog_group_status" == "201" ]]
group_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["nodes"][0]["id"])' < "$scratch/catalog-group.json")"

catalog_doc_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/create" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"nodeType\":\"DOCUMENT\",\"pageId\":\"$page1_id\",\"parentId\":\"$group_id\",\"expectedRevision\":1}" \
  "$scratch/catalog-doc.json")"
[[ "$catalog_doc_status" == "201" ]]
doc_node_id="$(python3 -c 'import json,sys; data=json.load(sys.stdin); print(next(n["id"] for n in data["nodes"] if n["nodeType"]=="DOCUMENT"))' < "$scratch/catalog-doc.json")"

catalog_doc2_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/create" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"nodeType\":\"DOCUMENT\",\"pageId\":\"$page2_id\",\"afterNodeId\":\"$group_id\",\"expectedRevision\":2}" \
  "$scratch/catalog-doc2.json")"
[[ "$catalog_doc2_status" == "201" ]]

cycle_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/move" \
  "{\"nodeId\":\"$group_id\",\"targetParentId\":\"$doc_node_id\",\"expectedRevision\":3}" \
  "$scratch/catalog-cycle.json")"
[[ "$cycle_status" == "409" ]]
[[ "$(problem_code < "$scratch/catalog-cycle.json")" == "CATALOG_CYCLE" ]]

stale_catalog_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/rename" \
  "{\"nodeId\":\"$group_id\",\"title\":\"Stale Rename\",\"expectedRevision\":1}" \
  "$scratch/catalog-stale.json")"
[[ "$stale_catalog_status" == "409" ]]
[[ "$(problem_code < "$scratch/catalog-stale.json")" == "CATALOG_REVISION_CONFLICT" ]]

catalog_rename_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/rename" \
  "{\"nodeId\":\"$group_id\",\"title\":\"Renamed Basics\",\"expectedRevision\":3}" \
  "$scratch/catalog-renamed.json")"
[[ "$catalog_rename_status" == "200" ]]
[[ "$(json_value revision < "$scratch/catalog-renamed.json")" == "4" ]]

catalog_restore_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/restore" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"revisionNo\":3,\"expectedRevision\":4}" \
  "$scratch/catalog-restored.json")"
[[ "$catalog_restore_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["revision"]==5
group=next(n for n in d["nodes"] if n["id"]==sys.argv[1])
assert group["titleOverride"]=="Basics"' "$group_id" < "$scratch/catalog-restored.json"

catalog_history_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/history" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"limit\":10}" \
  "$scratch/catalog-history.json")"
[[ "$catalog_history_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d[0]["revisionNo"]==5
assert d[0]["operation"]=="RESTORE"
assert len(d[0]["snapshot"])==3' < "$scratch/catalog-history.json"

catalog_batch_move_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/batch" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"nodeIds\":[\"$group_id\",\"$doc_node_id\"],\"operation\":\"MOVE\",\"targetParentId\":null,\"expectedRevision\":5}" \
  "$scratch/catalog-batch-move.json")"
[[ "$catalog_batch_move_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["revision"]==6,d
group=next(n for n in d["nodes"] if n["id"]==sys.argv[1])
child=next(n for n in d["nodes"] if n["id"]==sys.argv[2])
assert group["parentId"] is None and child["parentId"]==group["id"],(group,child)' "$group_id" "$doc_node_id" < "$scratch/catalog-batch-move.json"

for index in 1 2; do
  code="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
    "/api/v1/catalog/create" \
    "{\"knowledgeBaseId\":\"$kb_id\",\"nodeType\":\"LINK\",\"titleOverride\":\"Temporary $index\",\"url\":\"https://example.com/$index\",\"expectedRevision\":$((5 + index))}" \
    "$scratch/catalog-temp-$index.json")"
  [[ "$code" == "201" ]]
done
temp_link_1="$(python3 -c 'import json,sys;print(next(n["id"] for n in json.load(sys.stdin)["nodes"] if n.get("titleOverride")=="Temporary 1"))' < "$scratch/catalog-temp-2.json")"
temp_link_2="$(python3 -c 'import json,sys;print(next(n["id"] for n in json.load(sys.stdin)["nodes"] if n.get("titleOverride")=="Temporary 2"))' < "$scratch/catalog-temp-2.json")"
catalog_batch_remove_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/batch" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"nodeIds\":[\"$temp_link_1\",\"$temp_link_2\"],\"operation\":\"REMOVE\",\"targetParentId\":null,\"expectedRevision\":8}" \
  "$scratch/catalog-batch-remove.json")"
[[ "$catalog_batch_remove_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["revision"]==9 and len(d["nodes"])==3,d
assert not ({sys.argv[1],sys.argv[2]} & {n["id"] for n in d["nodes"]}),d' "$temp_link_1" "$temp_link_2" < "$scratch/catalog-batch-remove.json"
code="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/history" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"limit\":4}" \
  "$scratch/catalog-batch-history.json")"
[[ "$code" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d[0]["revisionNo"]==9 and d[0]["operation"]=="BATCH_REMOVE",d
assert sum(1 for item in d if item["operation"]=="BATCH_MOVE")==1,d' < "$scratch/catalog-batch-history.json"

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
  "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page1_id\",\"subjectType\":\"USER\",\"subjectId\":\"$member_id\",\"role\":\"EDITOR\",\"effect\":\"ALLOW\",\"capabilities\":[]}" \
  "$scratch/acl.json")"
[[ "$acl_status" == "201" ]]

member_cookie="$scratch/member.cookies"
member_login_status="$(curl -sS -o "$scratch/member-login.json" -w "%{http_code}" -c "$member_cookie" \
  -H "Content-Type: application/json" --data-binary '{"email":"member@example.com","password":"Admin-Password-2026!"}' \
  "$api_url/api/v1/auth/login/password")"
[[ "$member_login_status" == "204" ]]
member_csrf_json="$(curl -fsS -b "$member_cookie" "$api_url/api/v1/auth/csrf")"
member_csrf_header="$(printf "%s" "$member_csrf_json" | json_value headerName)"
member_csrf_token="$(printf "%s" "$member_csrf_json" | json_value token)"

review_team_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/teams/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Review Team\",\"slug\":\"review-team\",\"visibility\":\"PRIVATE\"}" \
  "$scratch/review-team.json")"
[[ "$review_team_status" == "201" ]]
review_team_id="$(json_value id < "$scratch/review-team.json")"

review_member_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/teams/members/add" \
  "{\"teamId\":\"$review_team_id\",\"userId\":\"$member_id\",\"role\":\"MEMBER\"}" \
  "$scratch/review-member.json")"
[[ "$review_member_status" == "200" ]]

team_acl_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/authorization/grant" \
  "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page2_id\",\"subjectType\":\"TEAM\",\"subjectId\":\"$review_team_id\",\"role\":\"READER\",\"effect\":\"ALLOW\",\"capabilities\":[]}" \
  "$scratch/team-acl.json")"
[[ "$team_acl_status" == "201" ]]
team_acl_id="$(json_value id < "$scratch/team-acl.json")"

team_acl_resolve_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/authorization/resolve" \
  "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page2_id\"}" \
  "$scratch/team-acl-resolve.json")"
[[ "$team_acl_resolve_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert "READ" in d["capabilities"]
assert "EDIT" not in d["capabilities"]
assert "acl:allow" in d["sources"]' < "$scratch/team-acl-resolve.json"

team_acl_revoke_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/authorization/revoke" \
  "{\"aclEntryId\":\"$team_acl_id\"}" \
  "$scratch/team-acl-revoke.json")"
[[ "$team_acl_revoke_status" == "204" ]]

team_activity_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/teams/activity/page" \
  "{\"teamId\":\"$review_team_id\",\"limit\":1,\"offset\":0}" \
  "$scratch/team-activity-member.json")"
[[ "$team_activity_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d["items"])==1 and d["hasMore"] is True and d["nextOffset"]==1,d' < "$scratch/team-activity-member.json"

team_leave_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/teams/members/leave" \
  "{\"teamId\":\"$review_team_id\"}" \
  "$scratch/team-leave.json")"
[[ "$team_leave_status" == "204" ]]
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/teams/members" \
  "{\"teamId\":\"$review_team_id\"}" \
  "$scratch/team-members-after-leave.json")" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d)==1 and d[0]["userId"]==sys.argv[1] and d[0]["role"]=="MANAGER",d' "$admin_id" < "$scratch/team-members-after-leave.json"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/teams/activity/page" \
  "{\"teamId\":\"$review_team_id\",\"limit\":25,\"offset\":0}" \
  "$scratch/team-activity-after-leave.json")" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert any(item["action"]=="team.member.leave" and item["actorId"]==sys.argv[1] for item in d["items"]),d' "$member_id" < "$scratch/team-activity-after-leave.json"

other_workspace_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workspaces/create" '{"name":"Other Workspace"}' "$scratch/other-workspace.json")"
[[ "$other_workspace_status" == "201" ]]
other_workspace_id="$(json_value id < "$scratch/other-workspace.json")"
other_team_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/teams/create" \
  "{\"workspaceId\":\"$other_workspace_id\",\"name\":\"Other Team\",\"slug\":\"other-team\",\"visibility\":\"PRIVATE\"}" \
  "$scratch/other-team.json")"
[[ "$other_team_status" == "201" ]]
other_team_id="$(json_value id < "$scratch/other-team.json")"
cross_workspace_acl_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/authorization/grant" \
  "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page1_id\",\"subjectType\":\"TEAM\",\"subjectId\":\"$other_team_id\",\"role\":\"READER\",\"effect\":\"ALLOW\",\"capabilities\":[]}" \
  "$scratch/cross-workspace-acl.json")"
[[ "$cross_workspace_acl_status" == "400" ]]

docker exec "$database" psql -U knowledge -d knowledge -v ON_ERROR_STOP=1 -c \
  "insert into workspace_memberships(workspace_id,user_id,role,created_at,updated_at) values ('$other_workspace_id','$member_id','MEMBER',now(),now());" >/dev/null

ownership_confirmation_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workspaces/ownership/transfer" \
  "{\"workspaceId\":\"$other_workspace_id\",\"targetUserId\":\"$member_id\",\"confirmationName\":\"Wrong Workspace\"}" \
  "$scratch/ownership-confirmation.json")"
[[ "$ownership_confirmation_status" == "409" ]]
[[ "$(problem_code < "$scratch/ownership-confirmation.json")" == "WORKSPACE_CONFIRMATION_MISMATCH" ]]

ownership_transfer_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workspaces/ownership/transfer" \
  "{\"workspaceId\":\"$other_workspace_id\",\"targetUserId\":\"$member_id\",\"confirmationName\":\"Other Workspace\"}" \
  "$scratch/ownership-transfer.json")"
[[ "$ownership_transfer_status" == "200" ]]
python3 -c 'import json,sys
members={item["userId"]:item["role"] for item in json.load(sys.stdin)}
assert members[sys.argv[1]]=="ADMIN",members
assert members[sys.argv[2]]=="OWNER",members' "$admin_id" "$member_id" < "$scratch/ownership-transfer.json"

former_owner_transfer_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workspaces/ownership/transfer" \
  "{\"workspaceId\":\"$other_workspace_id\",\"targetUserId\":\"$member_id\",\"confirmationName\":\"Other Workspace\"}" \
  "$scratch/former-owner-transfer.json")"
[[ "$former_owner_transfer_status" == "409" ]]
[[ "$(problem_code < "$scratch/former-owner-transfer.json")" == "WORKSPACE_OWNER_REQUIRED" ]]

member_resolve_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/authorization/resolve" \
  "{\"resourceType\":\"PAGE\",\"resourceId\":\"$page1_id\"}" \
  "$scratch/member-resolve.json")"
[[ "$member_resolve_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert "READ" in d["capabilities"]
assert "EDIT" in d["capabilities"]
assert "MANAGE_PERMISSIONS" not in d["capabilities"]' < "$scratch/member-resolve.json"

printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' \
  | base64 -d > "$scratch/shared-private.png"
shared_attachment_sha="$(sha256sum "$scratch/shared-private.png" | cut -d' ' -f1)"
shared_attachment_upload_status="$(curl -sS -o "$scratch/shared-attachment.json" -w "%{http_code}" \
  -b "$admin_cookie" -H "$csrf_header: $csrf_token" -F "pageId=$page1_id" \
  -F "file=@$scratch/shared-private.png;type=image/png;filename=shared-private.png" \
  "$api_url/api/v1/attachments/upload")"
[[ "$shared_attachment_upload_status" == "201" ]]
shared_attachment_id="$(json_value id < "$scratch/shared-attachment.json")"
shared_card_data="$(python3 -c 'import json,sys;print(json.dumps({"url":f"/api/v1/attachments/{sys.argv[1]}/content","attachmentId":sys.argv[1],"mediaType":"image/png","alt":"private shared image","width":"LARGE"},separators=(",",":")))' "$shared_attachment_id")"
shared_card_payload="$(printf '%s' "$shared_card_data" | encode_data)"
shared_card_instance="$(cat /proc/sys/kernel/random/uuid)"
shared_card_token="{{card:image|id=$shared_card_instance|v=1|data=$shared_card_payload}}"
shared_attachment_page_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/update" \
  "{\"pageId\":\"$page1_id\",\"expectedRevision\":2,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$shared_card_token\"}]},\"revisionKind\":\"MANUAL\",\"revisionDescription\":\"private share attachment\"}" \
  "$scratch/shared-attachment-page.json")"
[[ "$shared_attachment_page_status" == "200" ]]

publish_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/publish" \
  "{\"pageId\":\"$page1_id\",\"idempotencyKey\":\"publish-getting-started-v1\"}" \
  "$scratch/publication.json")"
[[ "$publish_status" == "201" ]]
publication_id="$(json_value id < "$scratch/publication.json")"

publish_retry_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/publish" \
  "{\"pageId\":\"$page1_id\",\"idempotencyKey\":\"publish-getting-started-v1\"}" \
  "$scratch/publication-retry.json")"
[[ "$publish_retry_status" == "201" ]]
[[ "$(json_value id < "$scratch/publication-retry.json")" == "$publication_id" ]]

share_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/shares/create" \
  "{\"pageId\":\"$page1_id\",\"password\":\"Reader-Password-2026!\",\"role\":\"READER\",\"allowCopy\":false,\"allowDownload\":false}" \
  "$scratch/share.json")"
[[ "$share_status" == "201" ]]
share_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["share"]["id"])' < "$scratch/share.json")"
share_token="$(json_value token < "$scratch/share.json")"

resolve_locked_status="$(curl -sS -o "$scratch/share-locked.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary "{\"token\":\"$share_token\"}" \
  "$api_url/api/v1/shares/resolve")"
[[ "$resolve_locked_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["passwordRequired"] is True
assert d["publication"] is None' < "$scratch/share-locked.json"

wrong_password_status="$(curl -sS -o "$scratch/share-wrong-password.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary "{\"token\":\"$share_token\",\"password\":\"incorrect-password\"}" \
  "$api_url/api/v1/shares/verify-password")"
[[ "$wrong_password_status" == "401" ]]
[[ "$(problem_code < "$scratch/share-wrong-password.json")" == "SHARE_PASSWORD_INVALID" ]]

verify_password_status="$(curl -sS -o "$scratch/share-access.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary "{\"token\":\"$share_token\",\"password\":\"Reader-Password-2026!\"}" \
  "$api_url/api/v1/shares/verify-password")"
[[ "$verify_password_status" == "200" ]]
share_access_token="$(json_value accessToken < "$scratch/share-access.json")"

resolve_granted_status="$(curl -sS -o "$scratch/share-granted.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary "{\"token\":\"$share_token\",\"accessToken\":\"$share_access_token\"}" \
  "$api_url/api/v1/shares/resolve")"
[[ "$resolve_granted_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["passwordRequired"] is False
assert d["publication"]["title"] == "Getting Started Now"
assert d["share"]["allowCopy"] is False' < "$scratch/share-granted.json"

private_direct_attachment_status="$(curl -sS -o "$scratch/shared-attachment-direct.json" -w "%{http_code}" \
  "$api_url/api/v1/attachments/$shared_attachment_id/content")"
[[ "$private_direct_attachment_status" == "404" ]]

missing_share_access_status="$(curl -sS -o "$scratch/shared-attachment-locked.json" -w "%{http_code}" --get \
  --data-urlencode "shareToken=$share_token" --data-urlencode "sharePageId=$page1_id" \
  "$api_url/api/v1/attachments/$shared_attachment_id/shared-content")"
[[ "$missing_share_access_status" == "401" ]]
[[ "$(problem_code < "$scratch/shared-attachment-locked.json")" == "SHARE_PASSWORD_INVALID" ]]

shared_attachment_status="$(curl -sS -D "$scratch/shared-attachment.headers" -o "$scratch/shared-attachment-download.png" -w "%{http_code}" --get \
  --data-urlencode "shareToken=$share_token" --data-urlencode "shareAccessToken=$share_access_token" \
  --data-urlencode "sharePageId=$page1_id" \
  "$api_url/api/v1/attachments/$shared_attachment_id/shared-content")"
[[ "$shared_attachment_status" == "200" ]]
[[ "$(sha256sum "$scratch/shared-attachment-download.png" | cut -d' ' -f1)" == "$shared_attachment_sha" ]]
grep -qi '^Cache-Control: no-store' "$scratch/shared-attachment.headers"

wrong_shared_page_status="$(curl -sS -o "$scratch/shared-attachment-wrong-page.json" -w "%{http_code}" --get \
  --data-urlencode "shareToken=$share_token" --data-urlencode "shareAccessToken=$share_access_token" \
  --data-urlencode "sharePageId=$page2_id" \
  "$api_url/api/v1/attachments/$shared_attachment_id/shared-content")"
[[ "$wrong_shared_page_status" == "404" ]]

disabled_download_status="$(curl -sS -o "$scratch/share-download-disabled.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$share_token\",\"accessToken\":\"$share_access_token\"}" \
  "$api_url/api/v1/shares/download")"
[[ "$disabled_download_status" == "409" ]]
[[ "$(problem_code < "$scratch/share-download-disabled.json")" == "SHARE_DOWNLOAD_DISABLED" ]]

disabled_export_status="$(curl -sS -o "$scratch/share-export-disabled.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$share_token\",\"accessToken\":\"$share_access_token\"}" \
  "$api_url/api/v1/shares/export")"
[[ "$disabled_export_status" == "409" ]]
[[ "$(problem_code < "$scratch/share-export-disabled.json")" == "SHARE_EXPORT_DISABLED" ]]

reader_comment_status="$(curl -sS -o "$scratch/reader-comment-disabled.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$share_token\",\"accessToken\":\"$share_access_token\"}" \
  "$api_url/api/v1/shares/comments/list")"
[[ "$reader_comment_status" == "409" ]]
[[ "$(problem_code < "$scratch/reader-comment-disabled.json")" == "SHARE_COMMENTS_DISABLED" ]]

reader_comment_page_status="$(curl -sS -o "$scratch/reader-comment-page-disabled.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$share_token\",\"accessToken\":\"$share_access_token\",\"limit\":1,\"offset\":0}" \
  "$api_url/api/v1/shares/comments/page")"
[[ "$reader_comment_page_status" == "409" ]]
[[ "$(problem_code < "$scratch/reader-comment-page-disabled.json")" == "SHARE_COMMENTS_DISABLED" ]]

comment_share_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/shares/create" \
  "{\"pageId\":\"$page1_id\",\"role\":\"COMMENTER\",\"allowComment\":true}" \
  "$scratch/comment-share.json")"
[[ "$comment_share_status" == "201" ]]
comment_share_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["share"]["id"])' < "$scratch/comment-share.json")"
comment_share_token="$(json_value token < "$scratch/comment-share.json")"

empty_comments_status="$(curl -sS -o "$scratch/share-comments-empty.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$comment_share_token\"}" \
  "$api_url/api/v1/shares/comments/list")"
[[ "$empty_comments_status" == "200" ]]
[[ "$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' < "$scratch/share-comments-empty.json")" == "0" ]]

anonymous_comment_status="$(curl -sS -o "$scratch/share-comment-anonymous.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$comment_share_token\",\"plainText\":\"anonymous\",\"body\":{\"type\":\"doc\"}}" \
  "$api_url/api/v1/shares/comments/create")"
[[ "$anonymous_comment_status" == "403" ]]

create_share_comment_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/shares/comments/create" \
  "{\"token\":\"$comment_share_token\",\"anchor\":{\"kind\":\"SHARED_PAGE\"},\"body\":{\"type\":\"doc\",\"content\":[]},\"plainText\":\"Review note from shared reader\"}" \
  "$scratch/share-comment-created.json")"
[[ "$create_share_comment_status" == "201" ]]
share_comment_id="$(json_value id < "$scratch/share-comment-created.json")"
[[ "$(json_value creatorEmail < "$scratch/share-comment-created.json")" == "你" ]]

create_share_reply_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/shares/comments/create" \
  "{\"token\":\"$comment_share_token\",\"parentId\":\"$share_comment_id\",\"anchor\":{\"kind\":\"SHARED_PAGE\"},\"body\":{\"type\":\"doc\",\"content\":[]},\"plainText\":\"Follow-up from shared reader\"}" \
  "$scratch/share-comment-reply.json")"
[[ "$create_share_reply_status" == "201" ]]
share_reply_id="$(json_value id < "$scratch/share-comment-reply.json")"

public_comments_status="$(curl -sS -o "$scratch/share-comments-public.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$comment_share_token\"}" \
  "$api_url/api/v1/shares/comments/list")"
[[ "$public_comments_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d)==2
assert d[0]["plainText"]=="Review note from shared reader"
assert d[1]["plainText"]=="Follow-up from shared reader"
assert all(item["creatorEmail"]=="m***@example.com" for item in d)' < "$scratch/share-comments-public.json"

public_comments_page_status="$(curl -sS -o "$scratch/share-comments-page-one.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$comment_share_token\",\"limit\":1,\"offset\":0}" \
  "$api_url/api/v1/shares/comments/page")"
[[ "$public_comments_page_status" == "200" ]]
share_comments_next="$(json_value nextOffset < "$scratch/share-comments-page-one.json")"
public_comments_page_next_status="$(curl -sS -o "$scratch/share-comments-page-two.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$comment_share_token\",\"limit\":1,\"offset\":$share_comments_next}" \
  "$api_url/api/v1/shares/comments/page")"
[[ "$public_comments_page_next_status" == "200" ]]
python3 - "$scratch/share-comments-page-one.json" "$scratch/share-comments-page-two.json" "$share_comment_id" "$share_reply_id" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))
assert one['hasMore'] is True and one['nextOffset']==1 and len(one['items'])==1,one
assert two['hasMore'] is False and two['nextOffset']==2 and len(two['items'])==1,two
assert [one['items'][0]['id'],two['items'][0]['id']]==sys.argv[3:5],(one,two)
assert all(item['creatorEmail']=='m***@example.com' for item in one['items']+two['items']),(one,two)
PY

owner_comments_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/comments/list" "{\"pageId\":\"$page1_id\"}" \
  "$scratch/share-comments-owner.json")"
[[ "$owner_comments_status" == "200" ]]
[[ "$(python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["creatorEmail"])' < "$scratch/share-comments-owner.json")" == "member@example.com" ]]

delete_share_comment_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/shares/comments/delete" \
  "{\"token\":\"$comment_share_token\",\"commentId\":\"$share_comment_id\"}" \
  "$scratch/share-comment-delete.json")"
[[ "$delete_share_comment_status" == "204" ]]

delete_share_reply_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/shares/comments/delete" \
  "{\"token\":\"$comment_share_token\",\"commentId\":\"$share_reply_id\"}" \
  "$scratch/share-reply-delete.json")"
[[ "$delete_share_reply_status" == "204" ]]

revoke_comment_share_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/shares/revoke" "{\"shareId\":\"$comment_share_id\"}" \
  "$scratch/comment-share-revoke.json")"
[[ "$revoke_comment_share_status" == "204" ]]

approval_share_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/shares/create" \
  "{\"pageId\":\"$page1_id\",\"role\":\"READER\",\"requireApproval\":true}" \
  "$scratch/approval-share.json")"
[[ "$approval_share_status" == "201" ]]
approval_share_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["share"]["id"])' < "$scratch/approval-share.json")"
approval_share_token="$(json_value token < "$scratch/approval-share.json")"

anonymous_approval_status="$(curl -sS -o "$scratch/approval-anonymous.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary "{\"token\":\"$approval_share_token\"}" \
  "$api_url/api/v1/shares/resolve")"
[[ "$anonymous_approval_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["approvalRequired"] is True
assert d["approvalStatus"] == "AUTHENTICATION_REQUIRED"' < "$scratch/approval-anonymous.json"

member_approval_status="$(curl -sS -o "$scratch/approval-member.json" -w "%{http_code}" \
  -b "$member_cookie" -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$approval_share_token\"}" \
  "$api_url/api/v1/shares/resolve")"
[[ "$member_approval_status" == "200" ]]
[[ "$(json_value approvalStatus < "$scratch/approval-member.json")" == "NOT_REQUESTED" ]]

request_join_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/shares/request-join" \
  "{\"token\":\"$approval_share_token\",\"message\":\"Please approve this review\"}" \
  "$scratch/approval-request.json")"
[[ "$request_join_status" == "200" ]]
approval_request_id="$(json_value id < "$scratch/approval-request.json")"
[[ "$(json_value status < "$scratch/approval-request.json")" == "PENDING" ]]

list_requests_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/shares/requests" "{\"shareId\":\"$approval_share_id\"}" \
  "$scratch/approval-requests.json")"
[[ "$list_requests_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d)==1
assert d[0]["status"]=="PENDING"
assert d[0]["requesterEmail"]=="member@example.com"' < "$scratch/approval-requests.json"

review_request_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/shares/review-request" \
  "{\"requestId\":\"$approval_request_id\",\"decision\":\"APPROVE\"}" \
  "$scratch/approval-reviewed.json")"
[[ "$review_request_status" == "200" ]]
[[ "$(json_value status < "$scratch/approval-reviewed.json")" == "APPROVED" ]]

approved_resolve_status="$(curl -sS -o "$scratch/approval-granted.json" -w "%{http_code}" \
  -b "$member_cookie" -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$approval_share_token\"}" \
  "$api_url/api/v1/shares/resolve")"
[[ "$approved_resolve_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["approvalRequired"] is False
assert d["approvalStatus"] == "APPROVED"
assert d["publication"]["id"]' < "$scratch/approval-granted.json"

approval_reset_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/shares/reset-token" "{\"shareId\":\"$approval_share_id\"}" \
  "$scratch/approval-reset.json")"
[[ "$approval_reset_status" == "200" ]]
new_approval_token="$(json_value token < "$scratch/approval-reset.json")"
reset_approval_status="$(curl -sS -o "$scratch/approval-reset-resolve.json" -w "%{http_code}" \
  -b "$member_cookie" -H "Content-Type: application/json" \
  --data-binary "{\"token\":\"$new_approval_token\"}" \
  "$api_url/api/v1/shares/resolve")"
[[ "$reset_approval_status" == "200" ]]
[[ "$(json_value approvalStatus < "$scratch/approval-reset-resolve.json")" == "NOT_REQUESTED" ]]

approval_revoke_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/shares/revoke" "{\"shareId\":\"$approval_share_id\"}" \
  "$scratch/approval-revoke.json")"
[[ "$approval_revoke_status" == "204" ]]

reset_share_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/shares/reset-token" \
  "{\"shareId\":\"$share_id\"}" \
  "$scratch/share-reset.json")"
[[ "$reset_share_status" == "200" ]]
new_share_token="$(json_value token < "$scratch/share-reset.json")"

old_token_status="$(curl -sS -o "$scratch/share-old-token.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary "{\"token\":\"$share_token\"}" \
  "$api_url/api/v1/shares/resolve")"
[[ "$old_token_status" == "410" ]]

old_token_attachment_status="$(curl -sS -o "$scratch/share-old-token-attachment.json" -w "%{http_code}" --get \
  --data-urlencode "shareToken=$share_token" --data-urlencode "shareAccessToken=$share_access_token" \
  --data-urlencode "sharePageId=$page1_id" \
  "$api_url/api/v1/attachments/$shared_attachment_id/shared-content")"
[[ "$old_token_attachment_status" == "410" ]]

unpublish_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/unpublish" \
  "{\"pageId\":\"$page1_id\"}" \
  "$scratch/unpublish.json")"
[[ "$unpublish_status" == "204" ]]

new_verify_status="$(curl -sS -o "$scratch/share-new-access.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary "{\"token\":\"$new_share_token\",\"password\":\"Reader-Password-2026!\"}" \
  "$api_url/api/v1/shares/verify-password")"
[[ "$new_verify_status" == "200" ]]
new_access_token="$(json_value accessToken < "$scratch/share-new-access.json")"

unpublished_share_status="$(curl -sS -o "$scratch/share-unpublished.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary "{\"token\":\"$new_share_token\",\"accessToken\":\"$new_access_token\"}" \
  "$api_url/api/v1/shares/resolve")"
[[ "$unpublished_share_status" == "404" ]]
[[ "$(problem_code < "$scratch/share-unpublished.json")" == "RESOURCE_NOT_FOUND" ]]

unpublished_attachment_status="$(curl -sS -o "$scratch/share-unpublished-attachment.json" -w "%{http_code}" --get \
  --data-urlencode "shareToken=$new_share_token" --data-urlencode "shareAccessToken=$new_access_token" \
  --data-urlencode "sharePageId=$page1_id" \
  "$api_url/api/v1/attachments/$shared_attachment_id/shared-content")"
[[ "$unpublished_attachment_status" == "404" ]]

catalog_revision_count="$(docker exec "$database" psql -U knowledge -d knowledge -Atc \
  "select count(*) from catalog_revisions where knowledge_base_id='$kb_id'::uuid;")"
(( catalog_revision_count > 1 && catalog_revision_count <= 50 ))
catalog_page_limit=$((catalog_revision_count - 1))
docker exec "$database" psql -U knowledge -d knowledge -Atc \
  "select id from catalog_revisions where knowledge_base_id='$kb_id'::uuid order by revision_no desc;" \
  > "$scratch/catalog-revision-ids.txt"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/history/page" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"limit\":$catalog_page_limit,\"offset\":0}" \
  "$scratch/catalog-history-page-one.json")" == "200" ]]
catalog_history_next="$(json_value nextOffset < "$scratch/catalog-history-page-one.json")"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/catalog/history/page" \
  "{\"knowledgeBaseId\":\"$kb_id\",\"limit\":$catalog_page_limit,\"offset\":$catalog_history_next}" \
  "$scratch/catalog-history-page-two.json")" == "200" ]]
python3 - "$scratch/catalog-history-page-one.json" "$scratch/catalog-history-page-two.json" \
  "$scratch/catalog-revision-ids.txt" "$catalog_revision_count" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))
expected=[line.strip() for line in open(sys.argv[3]) if line.strip()]
count=int(sys.argv[4])
actual=[item['id'] for item in one['items']+two['items']]
assert one['hasMore'] is True and one['nextOffset']==count-1,one
assert two['hasMore'] is False and two['nextOffset']==count,two
assert len(one['items'])==count-1 and len(two['items'])==1,(one,two)
assert actual==expected,(actual,expected)
assert len(actual)==len(set(actual))==count,actual
PY

audit_event_count="$(docker exec "$database" psql -U knowledge -d knowledge -Atc \
  "select count(*) from audit_events where workspace_id='$workspace_id'::uuid;")"
(( audit_event_count > 1 && audit_event_count <= 50 ))
audit_page_limit=$((audit_event_count - 1))
docker exec "$database" psql -U knowledge -d knowledge -Atc \
  "select id from audit_events where workspace_id='$workspace_id'::uuid order by occurred_at desc,id desc;" \
  > "$scratch/audit-event-ids.txt"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/audit/page" \
  "{\"workspaceId\":\"$workspace_id\",\"limit\":$audit_page_limit,\"offset\":0}" \
  "$scratch/audit-page-one.json")" == "200" ]]
audit_next="$(json_value nextOffset < "$scratch/audit-page-one.json")"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/audit/page" \
  "{\"workspaceId\":\"$workspace_id\",\"limit\":$audit_page_limit,\"offset\":$audit_next}" \
  "$scratch/audit-page-two.json")" == "200" ]]
python3 - "$scratch/audit-page-one.json" "$scratch/audit-page-two.json" \
  "$scratch/audit-event-ids.txt" "$audit_event_count" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))
expected=[line.strip() for line in open(sys.argv[3]) if line.strip()]
count=int(sys.argv[4])
actual=[item['id'] for item in one['items']+two['items']]
assert one['hasMore'] is True and one['nextOffset']==count-1,one
assert two['hasMore'] is False and two['nextOffset']==count,two
assert len(one['items'])==count-1 and len(two['items'])==1,(one,two)
assert actual==expected,(actual,expected)
assert len(actual)==len(set(actual))==count,actual
PY

workspace_delete_mismatch_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workspaces/delete" \
  "{\"workspaceId\":\"$workspace_id\",\"confirmationName\":\"Wrong Workspace\"}" \
  "$scratch/workspace-delete-mismatch.json")"
[[ "$workspace_delete_mismatch_status" == "409" ]]

workspace_delete_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workspaces/delete" \
  "{\"workspaceId\":\"$workspace_id\",\"confirmationName\":\"Primary Workspace\"}" \
  "$scratch/workspace-delete.json")"
[[ "$workspace_delete_status" == "204" ]]

curl -fsS -b "$admin_cookie" "$api_url/api/v1/workspaces" |
  python3 -c 'import json,sys
workspaces=json.load(sys.stdin)
assert all(workspace["id"] != sys.argv[1] for workspace in workspaces)' "$workspace_id"

archived_page_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/get" "{\"pageId\":\"$page1_id\"}" \
  "$scratch/archived-page.json")"
[[ "$archived_page_status" == "404" ]]

archived_share_status="$(curl -sS -o "$scratch/archived-share.json" -w "%{http_code}" \
  -H "Content-Type: application/json" --data-binary "{\"token\":\"$new_share_token\",\"accessToken\":\"$new_access_token\"}" \
  "$api_url/api/v1/shares/resolve")"
[[ "$archived_share_status" == "410" ]]

docker exec "$database" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from workspaces where id='$workspace_id'::uuid and deleted_at is not null),
  (select count(*) from page_publications where workspace_id='$workspace_id'::uuid and superseded_at is null),
  (select count(*) from shares where workspace_id='$workspace_id'::uuid and revoked_at is null),
  (select count(*) from search_documents where workspace_id='$workspace_id'::uuid);" |
  python3 -c 'import sys; assert sys.stdin.read().strip()=="1|0|0|0"'

echo "CORE_E2E_COUNTS"
docker exec "$database" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from teams),
  (select count(*) from knowledge_bases),
  (select count(*) from pages),
  (select count(*) from page_histories),
  (select count(*) from catalog_nodes where deleted_at is null),
  (select count(*) from catalog_revisions),
  (select count(*) from acl_entries where deleted_at is null),
  (select count(*) from page_publications),
  (select count(*) from shares where revoked_at is null),
  (select count(*) from share_visits),
  (select count(*) from outbox_events),
  (select count(*) from audit_events);"

echo "CORE_E2E_UUID_VERSIONS"
docker exec "$database" psql -U knowledge -d knowledge -Atc "select distinct substring(id::text,15,1) from pages order by 1;"

echo "CORE_DOMAIN_E2E_SUCCESS"
