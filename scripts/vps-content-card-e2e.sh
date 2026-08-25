#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Content card E2E failed at line $LINENO" >&2' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_jar="${API_JAR:-$project_root/backend/app-api/build/libs/knowledge-platform-api.jar}"
[[ -f "$api_jar" ]] || { echo "Build the API jar before running this script." >&2; exit 1; }

suffix="kp-card-e2e-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
api="$suffix-api"
scratch="$(mktemp -d /tmp/kp-card-e2e.XXXXXX)"

cleanup() {
  docker rm -f "$api" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  case "$scratch" in /tmp/kp-card-e2e.*) rm -rf -- "$scratch" ;; esac
}
trap cleanup EXIT

wait_for() {
  local description="$1"; shift
  for _ in $(seq 1 90); do if "$@" >/dev/null 2>&1; then return 0; fi; sleep 1; done
  echo "Timed out waiting for $description" >&2; docker logs "$api" >&2 || true; return 1
}
json_value() { local field="$1"; python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$field"; }
problem_code() { python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])'; }
post() {
  local cookie="$1" header="$2" token="$3" path="$4" data="$5" output="$6"
  curl -sS -o "$output" -w "%{http_code}" -b "$cookie" -H "$header: $token" \
    -H "Content-Type: application/json" --data-binary "$data" "$api_url$path"
}
encode_data() {
  python3 -c 'import base64,sys; print(base64.urlsafe_b64encode(sys.argv[1].encode()).decode().rstrip("="))' "$1"
}

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias database \
  -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge \
  postgres:17.6-alpine >/dev/null
wait_for "PostgreSQL" docker exec "$database" pg_isready -U knowledge -d knowledge

settings_master_key="$(openssl rand -base64 32)"
docker run -d --name "$api" --network "$network" -p 127.0.0.1::8080 --entrypoint java \
  -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge \
  -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge \
  -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$settings_master_key" \
  -v "$api_jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null
api_port="$(docker port "$api" 8080/tcp | sed -n 's/.*://p' | head -1)"
api_url="http://127.0.0.1:$api_port"
wait_for "API health" curl -fsS "$api_url/actuator/health"

cookie="$scratch/admin.cookies"
setup_status="$(curl -sS -o "$scratch/setup.json" -w "%{http_code}" -c "$cookie" \
  -H "Content-Type: application/json" --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Card Workspace"}' \
  "$api_url/api/v1/setup/initialize")"
[[ "$setup_status" == "201" ]]
admin_id="$(json_value userId < "$scratch/setup.json")"
workspace_id="$(json_value workspaceId < "$scratch/setup.json")"
mentioned_user_id="$(cat /proc/sys/kernel/random/uuid)"
docker exec "$database" psql -v ON_ERROR_STOP=1 -U knowledge -d knowledge -c "insert into users(id,email_original,email_normalized,display_name,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at) values ('$mentioned_user_id','mentioned@example.com','mentioned@example.com','林静','unused','ACTIVE',now(),'ADMIN',now(),now()); insert into workspace_memberships(workspace_id,user_id,role,created_at) values ('$workspace_id','$mentioned_user_id','MEMBER',now());" >/dev/null
csrf_json="$(curl -fsS -b "$cookie" "$api_url/api/v1/auth/csrf")"
csrf_header="$(printf "%s" "$csrf_json" | json_value headerName)"
csrf_token="$(printf "%s" "$csrf_json" | json_value token)"

kb_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/knowledge-bases/create" \
  "{\"workspaceId\":\"$workspace_id\",\"name\":\"Card Book\",\"slug\":\"card-book\",\"ownerType\":\"PERSONAL\",\"ownerId\":\"$admin_id\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" "$scratch/kb.json")"
[[ "$kb_status" == "201" ]]
kb_id="$(json_value id < "$scratch/kb.json")"

create_page() {
  local title="$1" path="$2" output="$3"
  local status
  status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/create" \
    "{\"knowledgeBaseId\":\"$kb_id\",\"title\":\"$title\",\"path\":\"$path\",\"contentType\":\"DOCUMENT\"}" "$output")"
  [[ "$status" == "201" ]]
}
create_page "Cards" "cards" "$scratch/page.json"
create_page "Other" "other" "$scratch/other.json"
page_id="$(json_value id < "$scratch/page.json")"
other_id="$(json_value id < "$scratch/other.json")"

definitions_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/definitions" "{\"pageId\":\"$page_id\"}" "$scratch/definitions.json")"
[[ "$definitions_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin)
assert len(d)==37
assert all(x["version"]==1 and x["enabled"] for x in d)
assert {"基础","图形","数据","技术","布局","协作","安全","媒体","第三方"} == {x["category"] for x in d}' < "$scratch/definitions.json"

poll_id="$(cat /proc/sys/kernel/random/uuid)"
checkin_id="$(cat /proc/sys/kernel/random/uuid)"
status_id="$(cat /proc/sys/kernel/random/uuid)"
columns_id="$(cat /proc/sys/kernel/random/uuid)"
calendar_id="$(cat /proc/sys/kernel/random/uuid)"
quote_id="$(cat /proc/sys/kernel/random/uuid)"
table_id="$(cat /proc/sys/kernel/random/uuid)"
sensitive_id="$(cat /proc/sys/kernel/random/uuid)"
mention_id="$(cat /proc/sys/kernel/random/uuid)"
kanban_id="$(cat /proc/sys/kernel/random/uuid)"
database_card_id="$(cat /proc/sys/kernel/random/uuid)"
whiteboard_id="$(cat /proc/sys/kernel/random/uuid)"
drawio_id="$(cat /proc/sys/kernel/random/uuid)"
excalidraw_id="$(cat /proc/sys/kernel/random/uuid)"
mind_map_id="$(cat /proc/sys/kernel/random/uuid)"
poll_data='{"question":"午饭吃什么？","options":[{"id":"rice","label":"米饭"},{"id":"noodle","label":"面条"}],"multiple":false,"anonymous":false}'
checkin_data="$(python3 -c 'import datetime,json; d=datetime.date.today(); print(json.dumps({"title":"每日阅读","startDate":str(d),"endDate":str(d+datetime.timedelta(days=30)),"timezone":"Asia/Shanghai"},ensure_ascii=False,separators=(",",":")))')"
status_data='{"value":"IN_PROGRESS","label":"进行中"}'
columns_data='{"count":2,"columns":[{"content":"左栏正文"},{"content":"右栏正文"}],"ratios":[1,2]}'
calendar_data='{"timezone":"Asia/Shanghai","events":[{"id":"launch","title":"正式发布","start":"2026-08-24T10:00:00+08:00","end":"2026-08-24T11:00:00+08:00"}]}'
quote_data='{"text":"知识需要被连接","source":"项目手册"}'
table_data='{"rows":[["名称","状态"],["首页","完成"]]}'
sensitive_data='{"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA","salt":"AAAAAAAAAAAAAAAAAAAAAA","iv":"AAAAAAAAAAAAAAAA","kdf":"PBKDF2-SHA256","iterations":210000,"hint":"项目负责人知晓"}'
mention_data="{\"userId\":\"$mentioned_user_id\",\"label\":\"林静\"}"
kanban_data='{"columns":[{"id":"todo","title":"待处理","color":"#6f9c7e","cards":[{"id":"task-one","title":"完成首页","description":"今天完成"}]},{"id":"done","title":"已完成","color":"#5f7798","cards":[]}]}'
database_card_data='{"type":"database","view":"KANBAN","filter":"","sortFieldId":null,"fields":[{"id":"name","name":"名称","type":"TEXT"},{"id":"status","name":"状态","type":"SELECT","options":["待处理","已完成"]}],"rows":[{"id":"row-one","values":{"name":"首页改版","status":"待处理"},"createdAt":"2026-08-25T08:00:00Z"}]}'
whiteboard_data='{"type":"whiteboard","viewport":{"x":0,"y":0,"zoom":1},"elements":[{"id":"goal","kind":"RECT","x":20,"y":30,"width":180,"height":100,"text":"项目目标","color":"#ffffff"}]}'
drawio_data='{"type":"drawio","viewport":{"x":0,"y":0,"zoom":1},"nodes":[{"id":"start","kind":"ELLIPSE","x":20,"y":30,"width":160,"height":80,"text":"开始","color":"#ffffff"},{"id":"finish","kind":"RECT","x":260,"y":30,"width":160,"height":80,"text":"完成","color":"#dff3e6"}],"edges":[{"id":"edge-one","source":"start","target":"finish","label":"继续"}],"xml":"<mxfile><diagram name=\"Page-1\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel></diagram></mxfile>"}'
excalidraw_data='{"type":"excalidraw","viewport":{"x":0,"y":0,"zoom":1},"elements":[{"id":"decision","kind":"DIAMOND","x":20,"y":30,"width":180,"height":100,"text":"是否通过","color":"#fff1a8"}]}'
mind_map_data='{"root":"产品架构","nodes":[{"id":"frontend","parentId":null,"text":"前端"},{"id":"editor","parentId":"frontend","text":"编辑器"}]}'
poll_token="{{card:poll|id=$poll_id|v=1|data=$(encode_data "$poll_data")}}"
checkin_token="{{card:checkin|id=$checkin_id|v=1|data=$(encode_data "$checkin_data")}}"
status_token="{{card:status|id=$status_id|v=1|data=$(encode_data "$status_data")}}"
columns_token="{{card:columns|id=$columns_id|v=1|data=$(encode_data "$columns_data")}}"
calendar_token="{{card:calendar|id=$calendar_id|v=1|data=$(encode_data "$calendar_data")}}"
quote_token="{{card:quote|id=$quote_id|v=1|data=$(encode_data "$quote_data")}}"
table_token="{{card:table|id=$table_id|v=1|data=$(encode_data "$table_data")}}"
sensitive_token="{{card:sensitive-text|id=$sensitive_id|v=1|data=$(encode_data "$sensitive_data")}}"
mention_token="{{card:mention|id=$mention_id|v=1|data=$(encode_data "$mention_data")}}"
kanban_token="{{card:kanban|id=$kanban_id|v=1|data=$(encode_data "$kanban_data")}}"
database_card_token="{{card:database|id=$database_card_id|v=1|data=$(encode_data "$database_card_data")}}"
whiteboard_token="{{card:whiteboard|id=$whiteboard_id|v=1|data=$(encode_data "$whiteboard_data")}}"
drawio_token="{{card:drawio|id=$drawio_id|v=1|data=$(encode_data "$drawio_data")}}"
excalidraw_token="{{card:excalidraw|id=$excalidraw_id|v=1|data=$(encode_data "$excalidraw_data")}}"
mind_map_token="{{card:mind-map|id=$mind_map_id|v=1|data=$(encode_data "$mind_map_data")}}"
body="$poll_token $checkin_token $status_token $columns_token $calendar_token $quote_token $table_token $sensitive_token $mention_token $kanban_token $database_card_token $whiteboard_token $drawio_token $excalidraw_token $mind_map_token"

update_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$body\"}]}}" "$scratch/updated.json")"
[[ "$update_status" == "200" ]]

poll_state_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/poll/state" "{\"instanceId\":\"$poll_id\"}" "$scratch/poll-state.json")"
[[ "$poll_state_status" == "200" ]]
[[ "$(json_value totalVoters < "$scratch/poll-state.json")" == "0" ]]
vote_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/poll/vote" "{\"instanceId\":\"$poll_id\",\"optionIds\":[\"rice\"]}" "$scratch/voted.json")"
[[ "$vote_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin); assert d["totalVoters"]==1 and d["selectedOptionIds"]==["rice"]
assert next(x for x in d["options"] if x["id"]=="rice")["votes"]==1' < "$scratch/voted.json"

checkin_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/checkin" "{\"instanceId\":\"$checkin_id\"}" "$scratch/checkin.json")"
[[ "$checkin_status" == "200" ]]
[[ "$(json_value checkedIn < "$scratch/checkin.json")" == "True" ]]
checkin_retry_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/checkin" "{\"instanceId\":\"$checkin_id\"}" "$scratch/checkin-retry.json")"
[[ "$checkin_retry_status" == "200" ]]
[[ "$(json_value todayCount < "$scratch/checkin-retry.json")" == "1" ]]

for card_id in status poll; do
  usage_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/use" "{\"pageId\":\"$page_id\",\"cardId\":\"$card_id\"}" "$scratch/usage-$card_id.json")"
  if [[ "$usage_status" != "204" ]]; then
    echo "Unexpected card usage status: $usage_status" >&2
    cat "$scratch/usage-$card_id.json" >&2
    docker logs "$api" >&2
  fi
  [[ "$usage_status" == "204" ]]
done
recent_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/recent" "{\"pageId\":\"$page_id\"}" "$scratch/recent.json")"
[[ "$recent_status" == "200" ]]
python3 -c 'import json,sys; d=json.load(sys.stdin); assert [x["id"] for x in d]==["poll","status"]' < "$scratch/recent.json"

remove_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":1,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"cards removed\"}]}}" "$scratch/removed.json")"
[[ "$remove_status" == "200" ]]
archived_state_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/poll/state" "{\"instanceId\":\"$poll_id\"}" "$scratch/archived-state.json")"
[[ "$archived_state_status" == "404" ]]

readd_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":2,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$body\"}]}}" "$scratch/readded.json")"
[[ "$readd_status" == "200" ]]
restored_state_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/poll/state" "{\"instanceId\":\"$poll_id\"}" "$scratch/restored-state.json")"
[[ "$restored_state_status" == "200" ]]
[[ "$(json_value totalVoters < "$scratch/restored-state.json")" == "1" ]]

edited_poll_data='{"question":"今天吃什么？","options":[{"id":"rice","label":"盖饭"},{"id":"noodle","label":"水饺"}],"multiple":true,"anonymous":true}'
edited_poll_token="{{card:poll|id=$poll_id|v=1|data=$(encode_data "$edited_poll_data")}}"
edited_checkin_data="$(python3 -c 'import datetime,json; d=datetime.date.today(); print(json.dumps({"title":"晨间阅读","startDate":str(d),"endDate":str(d+datetime.timedelta(days=60)),"timezone":"Asia/Tokyo"},ensure_ascii=False,separators=(",",":")))')"
edited_checkin_token="{{card:checkin|id=$checkin_id|v=1|data=$(encode_data "$edited_checkin_data")}}"
edited_body="$edited_poll_token $edited_checkin_token $status_token $columns_token $calendar_token $quote_token $table_token $sensitive_token $mention_token $kanban_token $database_card_token $whiteboard_token $drawio_token $excalidraw_token $mind_map_token"
edit_poll_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":3,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$edited_body\"}]}}" "$scratch/poll-edited.json")"
[[ "$edit_poll_status" == "200" ]]
edited_poll_state_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/content-cards/poll/state" "{\"instanceId\":\"$poll_id\"}" "$scratch/edited-poll-state.json")"
[[ "$edited_poll_state_status" == "200" ]]
python3 -c 'import json,sys
d=json.load(sys.stdin); assert d["totalVoters"]==1 and d["selectedOptionIds"]==["rice"]
assert next(x for x in d["options"] if x["id"]=="rice")["label"]=="盖饭"' < "$scratch/edited-poll-state.json"
edited_checkin_title="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select data_json->>'title' from page_card_instances where id='$checkin_id' and archived_at is null;")"
[[ "$edited_checkin_title" == "晨间阅读" ]]

reuse_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$other_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$edited_poll_token\"}]}}" "$scratch/reuse.json")"
[[ "$reuse_status" == "409" ]]
[[ "$(problem_code < "$scratch/reuse.json")" == "CARD_INSTANCE_REUSED" ]]

evil_id="$(cat /proc/sys/kernel/random/uuid)"
evil_data='{"url":"https://attacker.example/embed"}'
evil_token="{{card:youtube|id=$evil_id|v=1|data=$(encode_data "$evil_data")}}"
evil_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$evil_token\"}]}}" "$scratch/evil.json")"
[[ "$evil_status" == "400" ]]
[[ "$(problem_code < "$scratch/evil.json")" == "INVALID_REQUEST" ]]

bad_columns_id="$(cat /proc/sys/kernel/random/uuid)"
bad_columns_data='{"count":3,"columns":[{"content":"A"},{"content":"B"}],"ratios":[1,1]}'
bad_columns_token="{{card:columns|id=$bad_columns_id|v=1|data=$(encode_data "$bad_columns_data")}}"
bad_columns_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$bad_columns_token\"}]}}" "$scratch/bad-columns.json")"
[[ "$bad_columns_status" == "400" ]]
[[ "$(problem_code < "$scratch/bad-columns.json")" == "INVALID_REQUEST" ]]

bad_calendar_id="$(cat /proc/sys/kernel/random/uuid)"
bad_calendar_data='{"timezone":"Asia/Shanghai","events":[{"id":"bad-range","title":"倒序日程","start":"2026-08-24T11:00:00+08:00","end":"2026-08-24T10:00:00+08:00"}]}'
bad_calendar_token="{{card:calendar|id=$bad_calendar_id|v=1|data=$(encode_data "$bad_calendar_data")}}"
bad_calendar_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$bad_calendar_token\"}]}}" "$scratch/bad-calendar.json")"
[[ "$bad_calendar_status" == "400" ]]
[[ "$(problem_code < "$scratch/bad-calendar.json")" == "INVALID_REQUEST" ]]

bad_table_id="$(cat /proc/sys/kernel/random/uuid)"
bad_table_data='{"rows":[["A","B"],["C"]]}'
bad_table_token="{{card:table|id=$bad_table_id|v=1|data=$(encode_data "$bad_table_data")}}"
bad_table_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$bad_table_token\"}]}}" "$scratch/bad-table.json")"
[[ "$bad_table_status" == "400" ]]
[[ "$(problem_code < "$scratch/bad-table.json")" == "INVALID_REQUEST" ]]

bad_sensitive_id="$(cat /proc/sys/kernel/random/uuid)"
bad_sensitive_data='{"ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA","salt":"too-short","iv":"AAAAAAAAAAAAAAAA","kdf":"PBKDF2-SHA256","iterations":210000}'
bad_sensitive_token="{{card:sensitive-text|id=$bad_sensitive_id|v=1|data=$(encode_data "$bad_sensitive_data")}}"
bad_sensitive_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$bad_sensitive_token\"}]}}" "$scratch/bad-sensitive.json")"
[[ "$bad_sensitive_status" == "400" ]]
[[ "$(problem_code < "$scratch/bad-sensitive.json")" == "INVALID_REQUEST" ]]

outsider_id="$(cat /proc/sys/kernel/random/uuid)"
bad_mention_id="$(cat /proc/sys/kernel/random/uuid)"
bad_mention_data="{\"userId\":\"$outsider_id\",\"label\":\"外部用户\"}"
bad_mention_token="{{card:mention|id=$bad_mention_id|v=1|data=$(encode_data "$bad_mention_data")}}"
bad_mention_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$bad_mention_token\"}]}}" "$scratch/bad-mention.json")"
[[ "$bad_mention_status" == "400" ]]
[[ "$(problem_code < "$scratch/bad-mention.json")" == "INVALID_REQUEST" ]]

bad_kanban_id="$(cat /proc/sys/kernel/random/uuid)"
bad_kanban_data='{"columns":[{"id":"duplicate","title":"第一列","cards":[{"id":"duplicate","title":"重复 ID"}]}]}'
bad_kanban_token="{{card:kanban|id=$bad_kanban_id|v=1|data=$(encode_data "$bad_kanban_data")}}"
bad_kanban_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$bad_kanban_token\"}]}}" "$scratch/bad-kanban.json")"
[[ "$bad_kanban_status" == "400" ]]
[[ "$(problem_code < "$scratch/bad-kanban.json")" == "INVALID_REQUEST" ]]

bad_database_id="$(cat /proc/sys/kernel/random/uuid)"
bad_database_data='{"type":"database","view":"TABLE","filter":"","sortFieldId":null,"fields":[{"id":"name","name":"名称","type":"TEXT"}],"rows":[{"id":"row-one","values":{"unknown":"越界字段"}}]}'
bad_database_token="{{card:database|id=$bad_database_id|v=1|data=$(encode_data "$bad_database_data")}}"
bad_database_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$bad_database_token\"}]}}" "$scratch/bad-database.json")"
[[ "$bad_database_status" == "400" ]]
[[ "$(problem_code < "$scratch/bad-database.json")" == "INVALID_REQUEST" ]]

bad_drawio_id="$(cat /proc/sys/kernel/random/uuid)"
bad_drawio_data='{"type":"drawio","viewport":{"x":0,"y":0,"zoom":1},"nodes":[],"edges":[],"xml":"<!DOCTYPE x [<!ENTITY e SYSTEM file:///etc/passwd>]><mxfile/>"}'
bad_drawio_token="{{card:drawio|id=$bad_drawio_id|v=1|data=$(encode_data "$bad_drawio_data")}}"
bad_drawio_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$bad_drawio_token\"}]}}" "$scratch/bad-drawio.json")"
[[ "$bad_drawio_status" == "400" ]]
[[ "$(problem_code < "$scratch/bad-drawio.json")" == "INVALID_REQUEST" ]]

bad_mind_map_id="$(cat /proc/sys/kernel/random/uuid)"
bad_mind_map_data='{"root":"循环结构","nodes":[{"id":"one","parentId":"two","text":"一"},{"id":"two","parentId":"one","text":"二"}]}'
bad_mind_map_token="{{card:mind-map|id=$bad_mind_map_id|v=1|data=$(encode_data "$bad_mind_map_data")}}"
bad_mind_map_status="$(post "$cookie" "$csrf_header" "$csrf_token" "/api/v1/pages/update" \
  "{\"pageId\":\"$page_id\",\"expectedRevision\":4,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$bad_mind_map_token\"}]}}" "$scratch/bad-mind-map.json")"
[[ "$bad_mind_map_status" == "400" ]]
[[ "$(problem_code < "$scratch/bad-mind-map.json")" == "INVALID_REQUEST" ]]

mention_notification_count="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*) from notifications where recipient_id='$mentioned_user_id' and notification_type='PAGE_MENTION' and payload->>'preview'='@林静';")"
mention_occurrences="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select occurrence_count from notifications where recipient_id='$mentioned_user_id' and notification_type='PAGE_MENTION';")"
[[ "$mention_notification_count" == "1" ]]
[[ "$mention_occurrences" == "2" ]]

echo "CONTENT_CARD_E2E_COUNTS"
docker exec "$database" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from page_card_instances where archived_at is null),
  (select count(*) from card_poll_votes),
  (select count(*) from card_checkins),
  (select count(*) from user_card_usage),
  (select count(*) from notifications where notification_type='PAGE_MENTION');"
echo "CONTENT_CARD_E2E_SUCCESS"
