#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Search rebuild E2E failed at line $LINENO" >&2' ERR
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."&&pwd)";jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}";[[ -f "$jar" ]];suffix="kp-reindex-e2e-$(date +%s)-$$";net="$suffix-net";db="$suffix-db";api="$suffix-api";tmp="$(mktemp -d /tmp/kp-reindex-e2e.XXXXXX)"
cleanup(){ docker rm -f "$api" "$db" >/dev/null 2>&1||true;docker network rm "$net" >/dev/null 2>&1||true;case "$tmp" in /tmp/kp-reindex-e2e.*)rm -rf -- "$tmp";;esac;};trap cleanup EXIT
wait_for(){ local label="$1";shift;for _ in $(seq 1 90);do "$@" >/dev/null 2>&1&&return;sleep 1;done;echo "timeout $label";docker logs "$api";return 1;};val(){ python3 -c 'import json,sys;print(json.load(sys.stdin)[sys.argv[1]])' "$1";};post(){ local path="$1" data="$2" out="$3";curl -sS -o "$out" -w '%{http_code}' -b "$cookie" -H "$header: $token" -H 'Content-Type: application/json' --data-binary "$data" "$url$path";}
docker network create "$net" >/dev/null;docker run -d --name "$db" --network "$net" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null;wait_for db docker exec "$db" pg_isready -U knowledge -d knowledge
docker run -d --name "$api" --network "$net" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null;port="$(docker port "$api" 8080/tcp|sed -n 's/.*://p'|head -1)";url="http://127.0.0.1:$port";wait_for api curl -fsS "$url/actuator/health"
cookie="$tmp/c";[[ "$(curl -sS -o "$tmp/setup" -w '%{http_code}' -c "$cookie" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Reindex Workspace"}' "$url/api/v1/setup/initialize")" == 201 ]];actor="$(val userId < "$tmp/setup")";ws="$(val workspaceId < "$tmp/setup")";csrf="$(curl -fsS -b "$cookie" "$url/api/v1/auth/csrf")";header="$(printf %s "$csrf"|val headerName)";token="$(printf %s "$csrf"|val token)"
[[ "$(post /api/v1/teams/create "{\"workspaceId\":\"$ws\",\"name\":\"Reindex Team\",\"slug\":\"reindex-team\",\"description\":\"team searchable token\",\"visibility\":\"WORKSPACE\"}" "$tmp/team")" == 201 ]]
[[ "$(post /api/v1/knowledge-bases/create "{\"workspaceId\":\"$ws\",\"name\":\"Reindex Knowledge\",\"slug\":\"reindex-knowledge\",\"description\":\"knowledge searchable token\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$ws\",\"visibility\":\"PUBLIC\",\"publishMode\":\"MANUAL\"}" "$tmp/kb")" == 201 ]];kb="$(val id < "$tmp/kb")"
[[ "$(post /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"Reindex Document\",\"path\":\"reindex-document\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"page searchable token\"}]}}" "$tmp/page")" == 201 ]];page="$(val id < "$tmp/page")"
[[ "$(post /api/v1/pages/labels/update "{\"pageId\":\"$page\",\"expectedRevision\":0,\"labels\":[{\"name\":\"重建后标签仍可搜索\",\"color\":\"#5A8F6B\"}]}" "$tmp/page-labels")" == 200 ]]
[[ "$(post /api/v1/pages/publish "{\"pageId\":\"$page\",\"idempotencyKey\":\"reindex-publish\"}" "$tmp/publication")" == 201 ]]
[[ "$(post /api/v1/quick-notes/create "{\"workspaceId\":\"$ws\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"note searchable token\"}]},\"plainText\":\"note searchable token\",\"source\":\"API\",\"clientRequestId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"tagIds\":[]}" "$tmp/note")" == 201 ]]
[[ "$(post /api/v1/templates/save-document "{\"pageId\":\"$page\",\"name\":\"Reindex Template\",\"description\":\"template searchable token\",\"category\":\"Ops\",\"visibility\":\"WORKSPACE\"}" "$tmp/template")" == 201 ]]
docker exec "$db" psql -U knowledge -d knowledge -c "delete from search_documents where workspace_id='$ws'" >/dev/null
[[ "$(post /api/v1/search/rebuild/start "{\"workspaceId\":\"$ws\"}" "$tmp/start")" == 200 ]];job="$(val id < "$tmp/start")";[[ "$(val status < "$tmp/start")" == RUNNING ]]
[[ "$(post /api/v1/search/rebuild/pause "{\"rebuildId\":\"$job\"}" "$tmp/pause")" == 200 ]];[[ "$(val status < "$tmp/pause")" == PAUSED ]]
[[ "$(post /api/v1/search/rebuild/advance "{\"rebuildId\":\"$job\",\"batchSize\":1}" "$tmp/paused-advance")" == 200 ]];[[ "$(val processedCount < "$tmp/paused-advance")" == 0 ]]
[[ "$(post /api/v1/search/rebuild/resume "{\"rebuildId\":\"$job\"}" "$tmp/resume")" == 200 ]];[[ "$(val status < "$tmp/resume")" == RUNNING ]]
for step in $(seq 1 40);do [[ "$(post /api/v1/search/rebuild/advance "{\"rebuildId\":\"$job\",\"batchSize\":1}" "$tmp/advance")" == 200 ]];status="$(val status < "$tmp/advance")";[[ "$status" != FAILED ]]||{ cat "$tmp/advance";docker logs "$api" 2>&1|tail -220;exit 1;};[[ "$status" == SUCCEEDED ]]&&break;done;[[ "$status" == SUCCEEDED ]]
[[ "$(post /api/v1/search "{\"workspaceId\":\"$ws\",\"query\":\"searchable token\",\"limit\":20}" "$tmp/search")" == 200 ]]
python3 - "$tmp/search" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]));types={x['resourceType'] for x in d['results']};assert {'PAGE','KNOWLEDGE_BASE','QUICK_NOTE','TEMPLATE','TEAM'}<=types,(types,d)
PY
[[ "$(post /api/v1/search "{\"workspaceId\":\"$ws\",\"query\":\"重建后标签仍可搜索\",\"limit\":20}" "$tmp/label-search")" == 200 ]]
[[ "$(post /api/public/v1/search "{\"workspaceId\":\"$ws\",\"query\":\"重建后标签仍可搜索\",\"limit\":20}" "$tmp/public-label-search")" == 200 ]]
python3 - "$tmp/label-search" "$tmp/public-label-search" <<'PY'
import json,sys
internal,public=[json.load(open(path)) for path in sys.argv[1:]]
assert [x['sourceScope'] for x in internal['results']]==['DRAFT'],internal
assert [x['sourceScope'] for x in public['results']]==['PUBLISHED'],public
PY
docker exec "$db" psql -U knowledge -d knowledge -v ON_ERROR_STOP=1 -c "
  insert into search_rebuilds(
    id,workspace_id,status,cursor_type,processed_count,error_count,requested_by,
    started_at,updated_at,completed_at)
  select gen_random_uuid(),'$ws'::uuid,'SUCCEEDED','DONE',g,0,'$actor'::uuid,
    now()-(g||' minutes')::interval,now()-(g||' minutes')::interval,
    now()-(g||' minutes')::interval
  from generate_series(1,22) g;" >/dev/null
docker exec "$db" psql -U knowledge -d knowledge -Atc \
  "select id from search_rebuilds where workspace_id='$ws'::uuid order by updated_at desc,id desc;" \
  > "$tmp/rebuild-ids.txt"
[[ "$(post /api/v1/search/rebuild/page \
  "{\"workspaceId\":\"$ws\",\"limit\":20,\"offset\":0}" "$tmp/rebuild-page-one")" == 200 ]]
next="$(val nextOffset < "$tmp/rebuild-page-one")"
[[ "$(post /api/v1/search/rebuild/page \
  "{\"workspaceId\":\"$ws\",\"limit\":20,\"offset\":$next}" "$tmp/rebuild-page-two")" == 200 ]]
python3 - "$tmp/rebuild-page-one" "$tmp/rebuild-page-two" "$tmp/rebuild-ids.txt" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))
expected=[line.strip() for line in open(sys.argv[3]) if line.strip()]
actual=[item['id'] for item in one['items']+two['items']]
assert len(one['items'])==20 and one['hasMore'] is True and one['nextOffset']==20,one
assert len(two['items'])==3 and two['hasMore'] is False and two['nextOffset']==23,two
assert actual==expected and len(actual)==len(set(actual))==23,(actual,expected)
PY
echo SEARCH_REBUILD_E2E_COUNTS;docker exec "$db" psql -U knowledge -d knowledge -Atc "select status,processed_count,error_count,(select count(*) from search_documents where workspace_id='$ws') from search_rebuilds where id='$job'";echo SEARCH_REBUILD_E2E_SUCCESS
