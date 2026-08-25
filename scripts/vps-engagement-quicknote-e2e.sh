#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Engagement and quick note E2E failed at line $LINENO" >&2' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_jar="${API_JAR:-$project_root/backend/app-api/build/libs/knowledge-platform-api.jar}"
if [[ ! -f "$api_jar" ]]; then
  echo "Build the API jar before running this script." >&2
  exit 1
fi

suffix="kp-engagement-e2e-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
api="$suffix-api"
scratch="$(mktemp -d /tmp/kp-engagement-e2e.XXXXXX)"

cleanup() {
  docker rm -f "$api" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  case "$scratch" in
    /tmp/kp-engagement-e2e.*) rm -rf -- "$scratch" ;;
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
    "workspaceName":"Primary Workspace"
  }' "$api_url/api/v1/setup/initialize")"
[[ "$setup_status" == "201" ]]
admin_id="$(json_value userId < "$scratch/setup.json")"
workspace_id="$(json_value workspaceId < "$scratch/setup.json")"

csrf_json="$(curl -fsS -b "$admin_cookie" "$api_url/api/v1/auth/csrf")"
csrf_header="$(printf "%s" "$csrf_json" | json_value headerName)"
csrf_token="$(printf "%s" "$csrf_json" | json_value token)"

kb_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-bases/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Personal Notes\",\"slug\":\"personal-notes\",\"ownerType\":\"PERSONAL\",\"ownerId\":\"$admin_id\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" \
  "$scratch/kb.json")"
[[ "$kb_status" == "201" ]]
kb_id="$(json_value id < "$scratch/kb.json")"

kb2_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-bases/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Design Notes\",\"slug\":\"design-notes\",\"ownerType\":\"PERSONAL\",\"ownerId\":\"$admin_id\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" \
  "$scratch/kb2.json")"
[[ "$kb2_status" == "201" ]]
kb2_id="$(json_value id < "$scratch/kb2.json")"

group1_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-base-groups/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"工作\"}" "$scratch/group1.json")"
[[ "$group1_status" == "201" ]]
group1_id="$(json_value id < "$scratch/group1.json")"

group2_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-base-groups/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"个人\"}" "$scratch/group2.json")"
[[ "$group2_status" == "201" ]]
group2_id="$(json_value id < "$scratch/group2.json")"

move_group1_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-base-groups/items/move" \
  "{\"groupId\":\"$group1_id\",\"knowledgeBaseId\":\"$kb_id\"}" "$scratch/group1-moved.json")"
[[ "$move_group1_status" == "200" ]]

move_group2_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-base-groups/items/move" \
  "{\"groupId\":\"$group2_id\",\"knowledgeBaseId\":\"$kb_id\"}" "$scratch/group2-moved.json")"
[[ "$move_group2_status" == "200" ]]

move_kb2_group2_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-base-groups/items/move" \
  "{\"groupId\":\"$group2_id\",\"knowledgeBaseId\":\"$kb2_id\"}" "$scratch/group2-kb2.json")"
[[ "$move_kb2_group2_status" == "200" ]]

items_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-base-groups/items/reorder" \
  "{\"groupId\":\"$group2_id\",\"orderedKnowledgeBaseIds\":[\"$kb2_id\",\"$kb_id\"]}" "$scratch/group2-items.json")"
[[ "$items_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert [i["knowledgeBaseId"] for i in d["items"]] == [sys.argv[1],sys.argv[2]]' "$kb2_id" "$kb_id" < "$scratch/group2-items.json"

groups_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/knowledge-base-groups/reorder" \
  "{\"workspaceId\":\"$workspace_id\",\"orderedGroupIds\":[\"$group2_id\",\"$group1_id\"]}" "$scratch/groups.json")"
[[ "$groups_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert [g["id"] for g in d] == [sys.argv[1],sys.argv[2]]
assert [i["knowledgeBaseId"] for i in d[0]["items"]] == [sys.argv[3],sys.argv[4]]
assert len(d[1]["items"]) == 0' "$group2_id" "$group1_id" "$kb2_id" "$kb_id" < "$scratch/groups.json"

member_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "
  with inserted as (
    insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at)
    select gen_random_uuid(),'member@example.com','member@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now()
    from users where id='$admin_id' returning id
  ), membership as (
    insert into workspace_memberships(workspace_id,user_id,role,created_at)
    select '$workspace_id',id,'MEMBER',now() from inserted returning user_id
  ) select user_id from membership;")"

tag_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/tags/create" '{"name":"重点","color":"RED"}' "$scratch/tag.json")"
[[ "$tag_status" == "201" ]]
tag_id="$(json_value id < "$scratch/tag.json")"

temporary_tag_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/tags/create" '{"name":"临时标签","color":"GRAY"}' "$scratch/temporary-tag.json")"
[[ "$temporary_tag_status" == "201" ]]
temporary_tag_id="$(json_value id < "$scratch/temporary-tag.json")"
temporary_tag_update_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/tags/update" \
  "{\"tagId\":\"$temporary_tag_id\",\"name\":\"稍后阅读\",\"color\":\"BLUE\"}" "$scratch/temporary-tag-updated.json")"
[[ "$temporary_tag_update_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert d["id"]==sys.argv[1] and d["name"]=="稍后阅读" and d["color"]=="BLUE",d' "$temporary_tag_id" < "$scratch/temporary-tag-updated.json"
temporary_tag_delete_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/tags/delete" "{\"tagId\":\"$temporary_tag_id\"}" "$scratch/temporary-tag-deleted.json")"
[[ "$temporary_tag_delete_status" == "204" ]]

client_request_id="$(cat /proc/sys/kernel/random/uuid)"
note_payload="{\"workspaceId\":\"$workspace_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"taskList\",\"content\":[{\"type\":\"taskItem\",\"attrs\":{\"checked\":true},\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"第一条小记\"}]}]}]},{\"type\":\"image\",\"attrs\":{\"src\":\"https://cdn.example.com/note.png\",\"alt\":\"小记图片\",\"title\":null}},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"参考链接\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://example.com/note\"}}]}]}]},\"plainText\":\"第一条小记\\n- [x] 已完成\\n![小记图片](https://cdn.example.com/note.png)\\n[参考链接](https://example.com/note)\",\"source\":\"HOME\",\"clientRequestId\":\"$client_request_id\",\"tagIds\":[\"$tag_id\"]}"
note_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/create" "$note_payload" "$scratch/note.json")"
[[ "$note_status" == "201" ]]
note_id="$(json_value id < "$scratch/note.json")"
[[ "$(json_value revision < "$scratch/note.json")" == "1" ]]
python3 - "$scratch/note.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8')); nodes=d['content']['content']
assert nodes[0]['type']=='taskList' and nodes[0]['content'][0]['attrs']['checked'] is True,nodes
assert nodes[1]['type']=='image' and nodes[1]['attrs']['src']=='https://cdn.example.com/note.png',nodes
assert nodes[2]['content'][0]['marks'][0]['type']=='link',nodes
PY

retry_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/create" "$note_payload" "$scratch/note-retry.json")"
[[ "$retry_status" == "201" ]]
[[ "$(json_value id < "$scratch/note-retry.json")" == "$note_id" ]]

second_note_payload="{\"workspaceId\":\"$workspace_id\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"第二条小记\"}]},\"plainText\":\"第二条小记\",\"source\":\"QUICK_NOTE_PAGE\",\"clientRequestId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"tagIds\":[\"$tag_id\"]}"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/quick-notes/create "$second_note_payload" "$scratch/second-note.json")" == 201 ]];second_note_id="$(json_value id < "$scratch/second-note.json")"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/quick-notes/page "{\"status\":\"ACTIVE\",\"tagId\":\"$tag_id\",\"query\":\"小记\",\"offset\":0,\"limit\":1}" "$scratch/note-page-one.json")" == 200 ]];note_next="$(json_value nextOffset < "$scratch/note-page-one.json")"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/quick-notes/page "{\"status\":\"ACTIVE\",\"tagId\":\"$tag_id\",\"query\":\"小记\",\"offset\":$note_next,\"limit\":1}" "$scratch/note-page-two.json")" == 200 ]]
python3 - "$scratch/note-page-one.json" "$scratch/note-page-two.json" "$note_id" "$second_note_id" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]));expected={sys.argv[3],sys.argv[4]}
assert len(one['items'])==1 and one['hasMore'] is True and one['nextOffset']==1,one
assert len(two['items'])==1 and two['hasMore'] is False and two['nextOffset']==2,two
assert {one['items'][0]['id'],two['items'][0]['id']}==expected,(one,two)
PY
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/quick-notes/archive "{\"quickNoteId\":\"$second_note_id\",\"archived\":true}" "$scratch/second-note-archived.json")" == 200 ]]
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/quick-notes/page '{"status":"ACTIVE","query":"第二条小记","offset":0,"limit":10}' "$scratch/note-page-after-archive.json")" == 200 ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d=={"items":[],"nextOffset":0,"hasMore":False},d' < "$scratch/note-page-after-archive.json"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" /api/v1/quick-notes/archive "{\"quickNoteId\":\"$second_note_id\",\"archived\":false}" "$scratch/second-note-unarchived.json")" == 200 ]]

save_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/save" \
  "{\"quickNoteId\":\"$note_id\",\"expectedRevision\":1,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"自动保存后\"}]},\"plainText\":\"自动保存后\",\"kind\":\"AUTO_SAVE\"}" \
  "$scratch/note-save.json")"
[[ "$save_status" == "200" ]]
[[ "$(json_value revision < "$scratch/note-save.json")" == "2" ]]

stale_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/save" \
  "{\"quickNoteId\":\"$note_id\",\"expectedRevision\":1,\"content\":{\"type\":\"doc\",\"content\":[]},\"plainText\":\"stale\",\"kind\":\"COMMIT\"}" \
  "$scratch/note-stale.json")"
[[ "$stale_status" == "409" ]]
[[ "$(problem_code < "$scratch/note-stale.json")" == "QUICK_NOTE_REVISION_CONFLICT" ]]

history_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/history" "{\"quickNoteId\":\"$note_id\",\"limit\":20}" "$scratch/history.json")"
[[ "$history_status" == "200" ]]
[[ "$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' < "$scratch/history.json")" == "2" ]]

[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/history/page" \
  "{\"quickNoteId\":\"$note_id\",\"limit\":1,\"offset\":0}" \
  "$scratch/history-page-one.json")" == "200" ]]
history_next="$(json_value nextOffset < "$scratch/history-page-one.json")"
[[ "$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/history/page" \
  "{\"quickNoteId\":\"$note_id\",\"limit\":1,\"offset\":$history_next}" \
  "$scratch/history-page-two.json")" == "200" ]]
python3 - "$scratch/history-page-one.json" "$scratch/history-page-two.json" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))
assert one['hasMore'] is True and one['nextOffset']==1 and len(one['items'])==1,one
assert two['hasMore'] is False and two['nextOffset']==2 and len(two['items'])==1,two
assert [one['items'][0]['revision'],two['items'][0]['revision']]==[2,1],(one,two)
assert one['items'][0]['id']!=two['items'][0]['id'],(one,two)
PY

restore_revision_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/history/restore" \
  "{\"quickNoteId\":\"$note_id\",\"revision\":1}" "$scratch/note-restored-revision.json")"
[[ "$restore_revision_status" == "200" ]]
[[ "$(json_value revision < "$scratch/note-restored-revision.json")" == "3" ]]
python3 - "$scratch/note-restored-revision.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'));nodes=d['content']['content']
assert [node['type'] for node in nodes]==['taskList','image','paragraph'],nodes
PY

list_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/list" \
  "{\"status\":\"ACTIVE\",\"tagId\":\"$tag_id\",\"query\":\"第一条\"}" "$scratch/note-list.json")"
[[ "$list_status" == "200" ]]
[[ "$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' < "$scratch/note-list.json")" == "1" ]]

remove_tag_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/batch" \
  "{\"quickNoteIds\":[\"$note_id\"],\"operation\":\"REMOVE_TAG\",\"tagIds\":[\"$tag_id\"]}" "$scratch/note-tag-removed.json")"
[[ "$remove_tag_status" == "200" ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d)==1 and d[0]["tags"]==[],d' < "$scratch/note-tag-removed.json"

add_tag_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/batch" \
  "{\"quickNoteIds\":[\"$note_id\"],\"operation\":\"ADD_TAG\",\"tagIds\":[\"$tag_id\"]}" "$scratch/note-tag-added.json")"
[[ "$add_tag_status" == "200" ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d)==1 and [tag["id"] for tag in d[0]["tags"]]==[sys.argv[1]],d' "$tag_id" < "$scratch/note-tag-added.json"

convert_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/convert" \
  "{\"quickNoteIds\":[\"$note_id\"],\"knowledgeBaseId\":\"$kb_id\",\"title\":\"小记转文稿\",\"path\":\"note-conversion\"}" \
  "$scratch/converted-page.json")"
[[ "$convert_status" == "200" ]]
page_id="$(json_value id < "$scratch/converted-page.json")"
python3 - "$scratch/converted-page.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'));nodes=d['content']['content']
assert [node['type'] for node in nodes]==['taskList','image','paragraph'],nodes
assert nodes[0]['content'][0]['attrs']['checked'] is True,nodes
assert nodes[1]['attrs']['alt']=='小记图片',nodes
assert nodes[2]['content'][0]['marks'][0]['attrs']['href']=='https://example.com/note',nodes
PY

archived_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/quick-notes/list" '{"status":"ARCHIVED"}' "$scratch/archived.json")"
[[ "$archived_status" == "200" ]]
[[ "$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' < "$scratch/archived.json")" == "1" ]]

favorite_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/favorites/set" "{\"pageId\":\"$page_id\",\"favorite\":true}" "$scratch/favorite.json")"
[[ "$favorite_status" == "200" ]]

favorite_check_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/favorites/status" "{\"pageId\":\"$page_id\"}" "$scratch/favorite-check.json")"
[[ "$favorite_check_status" == "200" ]]
[[ "$(json_value favorite < "$scratch/favorite-check.json")" == "True" ]]

page_get_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/get" "{\"pageId\":\"$page_id\"}" "$scratch/page-get.json")"
[[ "$page_get_status" == "200" ]]

second_page_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/pages/create" \
  "{\"knowledgeBaseId\":\"$kb2_id\",\"title\":\"第二条浏览记录\",\"path\":\"second-viewed-page\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"分页浏览记录\"}]}}" \
  "$scratch/second-page.json")"
[[ "$second_page_status" == "201" ]]
second_page_id="$(json_value id < "$scratch/second-page.json")"

for index in 1 2; do
  page_view_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
    "/api/v1/activities/page-view" "{\"pageId\":\"$page_id\"}" "$scratch/page-view-$index.json")"
  [[ "$page_view_status" == "204" ]]
done
second_page_view_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/activities/page-view" "{\"pageId\":\"$second_page_id\"}" "$scratch/second-page-view.json")"
[[ "$second_page_view_status" == "204" ]]

workbench_viewed_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workbench/page" '{"reason":"VIEWED","offset":0,"limit":1}' "$scratch/workbench-viewed.json")"
[[ "$workbench_viewed_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d["items"])==1 and d["items"][0]["resourceId"]==sys.argv[1] and d["items"][0]["reason"]=="VIEWED",d
assert d["nextOffset"]==1 and d["hasMore"] is True,d' "$second_page_id" < "$scratch/workbench-viewed.json"
viewed_next_offset="$(json_value nextOffset < "$scratch/workbench-viewed.json")"
workbench_viewed_next_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workbench/page" "{\"reason\":\"VIEWED\",\"offset\":$viewed_next_offset,\"limit\":1}" "$scratch/workbench-viewed-next.json")"
[[ "$workbench_viewed_next_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d["items"])==1 and d["items"][0]["resourceId"]==sys.argv[1],d
assert d["nextOffset"]==2 and d["hasMore"] is False,d' "$page_id" < "$scratch/workbench-viewed-next.json"

view_counts="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from activity_events where resource_id='$page_id' and event_type='VIEW'),
  (select count(*) from content_events where resource_id='$page_id' and event_type='VIEW'),
  (select coalesce(sum(views),0) from daily_content_metrics where resource_id='$page_id'),
  (select coalesce(sum(unique_views),0) from daily_content_metrics where resource_id='$page_id');")"
[[ "$view_counts" == "1|1|1|1" ]]

clear_views_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/activities/page-views/clear" '{}' "$scratch/clear-views.json")"
[[ "$clear_views_status" == "200" ]]
[[ "$(json_value deleted < "$scratch/clear-views.json")" == "2" ]]
cleared_viewed_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workbench/page" '{"reason":"VIEWED","offset":0,"limit":25}' "$scratch/workbench-viewed-cleared.json")"
[[ "$cleared_viewed_status" == "200" ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d=={"items":[],"nextOffset":0,"hasMore":False},d' < "$scratch/workbench-viewed-cleared.json"
retained_metrics="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from activity_events where resource_id='$page_id' and event_type='VIEW'),
  (select count(*) from content_events where resource_id='$page_id' and event_type='VIEW'),
  (select coalesce(sum(views),0) from daily_content_metrics where resource_id='$page_id'),
  (select coalesce(sum(unique_views),0) from daily_content_metrics where resource_id='$page_id');")"
[[ "$retained_metrics" == "0|1|1|1" ]]

workbench_created_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workbench/list" '{"reason":"CREATED","limit":20}' "$scratch/workbench-created.json")"
[[ "$workbench_created_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d)==2 and all(i["reason"]=="CREATED" for i in d),d
by_id={i["resourceId"]:i for i in d}
converted=by_id[sys.argv[1]]; second=by_id[sys.argv[2]]
assert converted["knowledgeBaseName"]=="Personal Notes" and converted["path"]=="note-conversion",converted
assert second["knowledgeBaseName"]=="Design Notes" and second["path"]=="second-viewed-page",second
assert all(i["publicationStatus"]=="UNPUBLISHED" for i in d),d
assert any(c["userId"]==sys.argv[3] and c["email"]=="admin@example.com" for c in converted["collaborators"]),converted' "$page_id" "$second_page_id" "$admin_id" < "$scratch/workbench-created.json"

workbench_favorite_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/workbench/list" '{"reason":"FAVORITE","limit":20}' "$scratch/workbench-favorite.json")"
[[ "$workbench_favorite_status" == "200" ]]
python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d)==1 and d[0]["favorite"] is True' < "$scratch/workbench-favorite.json"

comment_payload="{\"pageId\":\"$page_id\",\"anchor\":{\"kind\":\"page\"},\"body\":{\"type\":\"doc\",\"content\":[]},\"plainText\":\"@member 请看\",\"mentionedUserIds\":[\"$member_id\"]}"
comment1_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/comments/create" "$comment_payload" "$scratch/comment1.json")"
if [[ "$comment1_status" != "201" ]]; then
  cat "$scratch/comment1.json" >&2
  docker logs "$api" >&2
fi
[[ "$comment1_status" == "201" ]]
comment_id="$(json_value id < "$scratch/comment1.json")"

comment_update_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/comments/update" \
  "{\"commentId\":\"$comment_id\",\"body\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"更新后的评论\"}]},\"plainText\":\"更新后的评论\"}" "$scratch/comment-updated.json")"
[[ "$comment_update_status" == "200" ]]
[[ "$(json_value plainText < "$scratch/comment-updated.json")" == "更新后的评论" ]]

comment2_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/comments/create" "$comment_payload" "$scratch/comment2.json")"
[[ "$comment2_status" == "201" ]]
comment2_id="$(json_value id < "$scratch/comment2.json")"

comments_page_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/comments/page" \
  "{\"pageId\":\"$page_id\",\"limit\":1,\"offset\":0}" "$scratch/comments-page-one.json")"
[[ "$comments_page_status" == "200" ]]
comments_next="$(json_value nextOffset < "$scratch/comments-page-one.json")"
comments_page_next_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/comments/page" \
  "{\"pageId\":\"$page_id\",\"limit\":1,\"offset\":$comments_next}" "$scratch/comments-page-two.json")"
[[ "$comments_page_next_status" == "200" ]]
python3 - "$scratch/comments-page-one.json" "$scratch/comments-page-two.json" "$comment_id" "$comment2_id" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))
assert one['hasMore'] is True and one['nextOffset']==1 and len(one['items'])==1,one
assert two['hasMore'] is False and two['nextOffset']==2 and len(two['items'])==1,two
assert [one['items'][0]['id'],two['items'][0]['id']]==sys.argv[3:5],(one,two)
PY

second_comment_payload="{\"pageId\":\"$second_page_id\",\"anchor\":{\"kind\":\"page\"},\"body\":{\"type\":\"doc\",\"content\":[]},\"plainText\":\"@member 分页消息\",\"mentionedUserIds\":[\"$member_id\"]}"
second_page_comment_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/comments/create" "$second_comment_payload" "$scratch/second-page-comment.json")"
[[ "$second_page_comment_status" == "201" ]]

resolve_status="$(post "$admin_cookie" "$csrf_header" "$csrf_token" \
  "/api/v1/comments/resolve" "{\"commentId\":\"$comment_id\",\"resolved\":true}" "$scratch/comment-resolved.json")"
[[ "$resolve_status" == "200" ]]
[[ "$(json_value status < "$scratch/comment-resolved.json")" == "RESOLVED" ]]

member_cookie="$scratch/member.cookies"
member_login_status="$(curl -sS -o "$scratch/member-login.json" -w "%{http_code}" -c "$member_cookie" \
  -H "Content-Type: application/json" --data-binary '{"email":"member@example.com","password":"Admin-Password-2026!"}' \
  "$api_url/api/v1/auth/login/password")"
[[ "$member_login_status" == "204" ]]
member_csrf_json="$(curl -fsS -b "$member_cookie" "$api_url/api/v1/auth/csrf")"
member_csrf_header="$(printf "%s" "$member_csrf_json" | json_value headerName)"
member_csrf_token="$(printf "%s" "$member_csrf_json" | json_value token)"

notifications_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/notifications/list" '{"unreadOnly":true,"limit":20}' "$scratch/notifications.json")"
[[ "$notifications_status" == "200" ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d)==2 and sorted(n["occurrenceCount"] for n in d)==[1,2],d' < "$scratch/notifications.json"

mention_page_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/notifications/page" '{"unreadOnly":true,"category":"MENTIONS","offset":0,"limit":1}' "$scratch/mention-page.json")"
[[ "$mention_page_status" == "200" ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d["items"])==1 and d["items"][0]["type"]=="COMMENT_MENTION",d;assert d["hasMore"] is True and d["nextOffset"]==1,d' < "$scratch/mention-page.json"
mention_next_offset="$(json_value nextOffset < "$scratch/mention-page.json")"
mention_page_next_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/notifications/page" "{\"unreadOnly\":true,\"category\":\"MENTIONS\",\"offset\":$mention_next_offset,\"limit\":1}" "$scratch/mention-page-next.json")"
[[ "$mention_page_next_status" == "200" ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d["items"])==1 and d["items"][0]["type"]=="COMMENT_MENTION",d;assert d["hasMore"] is False and d["nextOffset"]==2,d' < "$scratch/mention-page-next.json"
access_page_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/notifications/page" '{"unreadOnly":false,"category":"ACCESS","offset":0,"limit":25}' "$scratch/access-page.json")"
[[ "$access_page_status" == "200" ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d=={"items":[],"nextOffset":0,"hasMore":False},d' < "$scratch/access-page.json"
notification_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])' < "$scratch/notifications.json")"

read_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/notifications/read" "{\"notificationId\":\"$notification_id\"}" "$scratch/read.json")"
[[ "$read_status" == "204" ]]

forbidden_note_status="$(post "$member_cookie" "$member_csrf_header" "$member_csrf_token" \
  "/api/v1/quick-notes/save" \
  "{\"quickNoteId\":\"$note_id\",\"expectedRevision\":3,\"content\":{\"type\":\"doc\",\"content\":[]},\"plainText\":\"steal\"}" \
  "$scratch/forbidden-note.json")"
[[ "$forbidden_note_status" == "404" ]]

echo "ENGAGEMENT_QUICKNOTE_E2E_COUNTS"
docker exec "$database" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from quick_notes),
  (select count(*) from quick_note_revisions),
  (select count(*) from quick_note_tags),
  (select count(*) from quick_note_conversions),
  (select count(*) from activity_events),
  (select count(*) from favorites),
  (select count(*) from comments where deleted_at is null),
  (select count(*) from notifications),
  (select count(*) from knowledge_base_user_groups),
  (select count(*) from knowledge_base_user_group_items);"

echo "ENGAGEMENT_QUICKNOTE_E2E_SUCCESS"
