#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Template E2E failed at line $LINENO" >&2' ERR
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}"; [[ -f "$jar" ]]
suffix="kp-template-e2e-$(date +%s)-$$"; network="$suffix-net"; db="$suffix-db"; api="$suffix-api"; tmp="$(mktemp -d /tmp/kp-template-e2e.XXXXXX)"
cleanup(){ docker rm -f "$api" "$db" >/dev/null 2>&1||true; docker network rm "$network" >/dev/null 2>&1||true; case "$tmp" in /tmp/kp-template-e2e.*) rm -rf -- "$tmp";;esac;}; trap cleanup EXIT
wait_for(){ local n="$1";shift;for _ in $(seq 1 90);do "$@" >/dev/null 2>&1&&return;sleep 1;done;echo "timeout $n";docker logs "$api";return 1;}; val(){ python3 -c 'import json,sys;print(json.load(sys.stdin)[sys.argv[1]])' "$1";}; post(){ local c="$1" h="$2" t="$3" p="$4" d="$5" o="$6";curl -sS -o "$o" -w '%{http_code}' -b "$c" -H "$h: $t" -H 'Content-Type: application/json' --data-binary "$d" "$url$p";}
docker network create "$network" >/dev/null; docker run -d --name "$db" --network "$network" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null; wait_for db docker exec "$db" pg_isready -U knowledge -d knowledge
docker run -d --name "$api" --network "$network" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null
port="$(docker port "$api" 8080/tcp|sed -n 's/.*://p'|head -1)";url="http://127.0.0.1:$port";wait_for api curl -fsS "$url/actuator/health"
c="$tmp/c"; code="$(curl -sS -o "$tmp/setup" -w '%{http_code}' -c "$c" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Template Workspace"}' "$url/api/v1/setup/initialize")";[[ "$code" == 201 ]];admin="$(val userId < "$tmp/setup")";ws="$(val workspaceId < "$tmp/setup")";csrf="$(curl -fsS -b "$c" "$url/api/v1/auth/csrf")";h="$(printf %s "$csrf"|val headerName)";t="$(printf %s "$csrf"|val token)"
code="$(post "$c" "$h" "$t" /api/v1/knowledge-bases/create "{\"workspaceId\":\"$ws\",\"name\":\"Source KB\",\"slug\":\"source-kb\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$ws\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" "$tmp/kb")";[[ "$code" == 201 ]];kb="$(val id < "$tmp/kb")"
code="$(post "$c" "$h" "$t" /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"Target\",\"path\":\"target\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"target text\"}]}}" "$tmp/p2")";[[ "$code" == 201 ]];p2="$(val id < "$tmp/p2")"
code="$(post "$c" "$h" "$t" /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"Source\",\"path\":\"source\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"[[page:$p2|mode=card]] {{embed:$p2|mode=live}}\"}]}}" "$tmp/p1")";[[ "$code" == 201 ]];p1="$(val id < "$tmp/p1")"
code="$(post "$c" "$h" "$t" /api/v1/catalog/create "{\"knowledgeBaseId\":\"$kb\",\"nodeType\":\"GROUP\",\"titleOverride\":\"Guide\",\"expectedRevision\":0}" "$tmp/group-tree")";[[ "$code" == 201 ]];group="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["nodes"][0]["id"])' < "$tmp/group-tree")"
code="$(post "$c" "$h" "$t" /api/v1/catalog/create "{\"knowledgeBaseId\":\"$kb\",\"nodeType\":\"DOCUMENT\",\"pageId\":\"$p1\",\"parentId\":\"$group\",\"expectedRevision\":1}" "$tmp/doc1-tree")";[[ "$code" == 201 ]]
code="$(post "$c" "$h" "$t" /api/v1/catalog/create "{\"knowledgeBaseId\":\"$kb\",\"nodeType\":\"DOCUMENT\",\"pageId\":\"$p2\",\"parentId\":\"$group\",\"expectedRevision\":2}" "$tmp/doc2-tree")";[[ "$code" == 201 ]]

code="$(post "$c" "$h" "$t" /api/v1/templates/save-document "{\"pageId\":\"$p1\",\"name\":\"Architecture note\",\"description\":\"Document template\",\"category\":\"Engineering\",\"visibility\":\"WORKSPACE\"}" "$tmp/doc-template")";[[ "$code" == 201 ]];dt="$(val id < "$tmp/doc-template")"
code="$(post "$c" "$h" "$t" /api/v1/templates/instantiate-document "{\"templateId\":\"$dt\",\"knowledgeBaseId\":\"$kb\",\"title\":\"Instantiated note\",\"path\":\"instantiated-note\"}" "$tmp/doc-instance")";[[ "$code" == 201 ]];dp="$(val targetResourceId < "$tmp/doc-instance")"
code="$(post "$c" "$h" "$t" /api/v1/pages/get "{\"pageId\":\"$dp\"}" "$tmp/doc-page")";[[ "$code" == 200 ]]
python3 - "$tmp/doc-page" "$p1" "$dp" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); text=json.dumps(d['content'],ensure_ascii=False)
assert sys.argv[2] not in text
assert sys.argv[3] not in text  # source referenced another page, not itself
assert d['title']=='Instantiated note'
PY

code="$(post "$c" "$h" "$t" /api/v1/templates/save-knowledge-base "{\"knowledgeBaseId\":\"$kb\",\"name\":\"Engineering handbook\",\"description\":\"Full tree template\",\"category\":\"Handbook\",\"visibility\":\"PRIVATE\"}" "$tmp/kb-template")";[[ "$code" == 201 ]];kt="$(val id < "$tmp/kb-template")"
code="$(post "$c" "$h" "$t" /api/v1/templates/instantiate-knowledge-base "{\"templateId\":\"$kt\",\"workspaceId\":\"$ws\",\"name\":\"Copied KB\",\"slug\":\"copied-kb\"}" "$tmp/kb-instance")";[[ "$code" == 201 ]];newkb="$(val targetResourceId < "$tmp/kb-instance")"
code="$(post "$c" "$h" "$t" /api/v1/pages/list "{\"knowledgeBaseId\":\"$newkb\"}" "$tmp/new-pages")";[[ "$code" == 200 ]]
code="$(post "$c" "$h" "$t" /api/v1/catalog/list "{\"knowledgeBaseId\":\"$newkb\"}" "$tmp/new-catalog")";[[ "$code" == 200 ]]
python3 - "$tmp/new-pages" "$tmp/new-catalog" "$p1" "$p2" <<'PY'
import json,sys
pages=json.load(open(sys.argv[1])); tree=json.load(open(sys.argv[2]))
assert len(pages)==3, pages  # source template captured all three active pages, including the document instance
assert len(tree['nodes'])==3, tree
blob=json.dumps(pages,ensure_ascii=False)
assert sys.argv[3] not in blob and sys.argv[4] not in blob, blob
source=next(p for p in pages if p['title']=='Source')
target=next(p for p in pages if p['title']=='Target')
assert target['id'] in json.dumps(source,ensure_ascii=False)
group=next(n for n in tree['nodes'] if n['nodeType']=='GROUP')
assert sum(1 for n in tree['nodes'] if n['parentId']==group['id'])==2
PY

code="$(post "$c" "$h" "$t" /api/v1/templates/list "{\"workspaceId\":\"$ws\",\"query\":\"handbook\"}" "$tmp/list")";[[ "$code" == 200 ]];python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d)==1 and d[0]["useCount"]==1' < "$tmp/list"
code="$(post "$c" "$h" "$t" /api/v1/templates/page "{\"workspaceId\":\"$ws\",\"offset\":0,\"limit\":1}" "$tmp/template-page-one")";[[ "$code" == 200 ]];template_next="$(val nextOffset < "$tmp/template-page-one")"
code="$(post "$c" "$h" "$t" /api/v1/templates/page "{\"workspaceId\":\"$ws\",\"offset\":$template_next,\"limit\":1}" "$tmp/template-page-two")";[[ "$code" == 200 ]]
python3 - "$tmp/template-page-one" "$tmp/template-page-two" "$dt" "$kt" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]));expected={sys.argv[3],sys.argv[4]}
assert len(one['items'])==1 and one['hasMore'] is True and one['nextOffset']==1,one
assert len(two['items'])==1 and two['hasMore'] is False and two['nextOffset']==2,two
assert {one['items'][0]['id'],two['items'][0]['id']}==expected,(one,two)
PY
member="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "with u as(insert into users(id,email_original,email_normalized,display_name,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at) select gen_random_uuid(),'member@example.com','member@example.com','Member',password_hash,'ACTIVE',now(),'ADMIN',now(),now() from users where id='$admin' returning id),m as(insert into workspace_memberships(workspace_id,user_id,role,created_at) select '$ws',id,'MEMBER',now() from u)select id from u")"
mc="$tmp/member-c";[[ "$(curl -sS -o "$tmp/member-login" -w '%{http_code}' -c "$mc" -H 'Content-Type: application/json' --data-binary '{"email":"member@example.com","password":"Admin-Password-2026!"}' "$url/api/v1/auth/login/password")" == 204 ]];mcsrf="$(curl -fsS -b "$mc" "$url/api/v1/auth/csrf")";mh="$(printf %s "$mcsrf"|val headerName)";mt="$(printf %s "$mcsrf"|val token)"
code="$(post "$mc" "$mh" "$mt" /api/v1/templates/page "{\"workspaceId\":\"$ws\",\"offset\":0,\"limit\":1}" "$tmp/member-template-page")";[[ "$code" == 200 ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d["items"])==1 and d["items"][0]["id"]==sys.argv[1] and d["hasMore"] is False and d["nextOffset"]==1,d' "$dt" < "$tmp/member-template-page"
code="$(post "$c" "$h" "$t" /api/v1/templates/get "{\"templateId\":\"$dt\"}" "$tmp/get-template")";[[ "$code" == 200 ]];[[ "$(val name < "$tmp/get-template")" == "Architecture note" ]]
code="$(post "$c" "$h" "$t" /api/v1/search "{\"workspaceId\":\"$ws\",\"query\":\"Architecture note\",\"resourceTypes\":[\"TEMPLATE\"]}" "$tmp/search")";[[ "$code" == 200 ]];python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d["results"])==1 and d["results"][0]["resourceType"]=="TEMPLATE"' < "$tmp/search"
code="$(post "$c" "$h" "$t" /api/v1/templates/delete "{\"templateId\":\"$dt\"}" "$tmp/delete-template")";[[ "$code" == 204 ]]
code="$(post "$c" "$h" "$t" /api/v1/templates/list "{\"workspaceId\":\"$ws\",\"query\":\"Architecture note\"}" "$tmp/deleted-list")";[[ "$code" == 200 ]];python3 -c 'import json,sys;assert json.load(sys.stdin)==[]' < "$tmp/deleted-list"
echo TEMPLATE_E2E_COUNTS;docker exec "$db" psql -U knowledge -d knowledge -Atc "select (select count(*) from templates),(select count(*) from template_instances),(select count(*) from page_publications pp join pages p on p.id=pp.page_id where p.knowledge_base_id='$newkb'),(select count(*) from comments c join pages p on p.id=c.resource_id where p.knowledge_base_id='$newkb'),(select count(*) from shares s join pages p on p.id=s.resource_id where p.knowledge_base_id='$newkb')";echo TEMPLATE_E2E_SUCCESS
