#!/usr/bin/env bash
set -Eeuo pipefail
trap 'status=$?; echo "Knowledge-base merge E2E failed at line $LINENO" >&2; if [[ -n "${tmp:-}" && -f "$tmp/result" ]]; then echo "--- result" >&2; cat "$tmp/result" >&2 || true; fi; if [[ -n "${api:-}" ]]; then echo "--- api errors" >&2; docker logs "$api" 2>&1 | sed -n "/ERROR/,$ p" >&2 || true; fi; exit "$status"' ERR
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."&&pwd)";jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}";[[ -f "$jar" ]];suffix="kp-kb-merge-$(date +%s)-$$";net="$suffix-net";db="$suffix-db";api="$suffix-api";tmp="$(mktemp -d /tmp/kp-kb-merge.XXXXXX)";internal="$(openssl rand -hex 32)"
cleanup(){ docker rm -f "$api" "$db" >/dev/null 2>&1||true;docker network rm "$net" >/dev/null 2>&1||true;case "$tmp" in /tmp/kp-kb-merge.*)rm -rf -- "$tmp";;esac;};trap cleanup EXIT
wait_for(){ local label="$1";shift;for _ in $(seq 1 90);do "$@" >/dev/null 2>&1&&return;sleep 1;done;echo "timeout $label";docker logs "$api";return 1;};val(){ python3 -c 'import json,sys;print(json.load(sys.stdin)[sys.argv[1]])' "$1";};problem(){ python3 -c 'import json,sys;print(json.load(sys.stdin).get("code",""))';};post(){ local path="$1" data="$2" out="$3";curl -sS -o "$out" -w '%{http_code}' -b "$cookie" -H "$header: $token" -H 'Content-Type: application/json' --data-binary "$data" "$url$path";}
docker network create "$net" >/dev/null;docker run -d --name "$db" --network "$net" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null;wait_for db docker exec "$db" pg_isready -U knowledge -d knowledge
docker run -d --name "$api" --network "$net" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" -e COLLAB_INTERNAL_TOKEN="$internal" -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null;port="$(docker port "$api" 8080/tcp|sed -n 's/.*://p'|head -1)";url="http://127.0.0.1:$port";wait_for api curl -fsS "$url/actuator/health"
cookie="$tmp/c";code="$(curl -sS -o "$tmp/setup" -w '%{http_code}' -c "$cookie" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Merge Workspace"}' "$url/api/v1/setup/initialize")";[[ "$code" == 201 ]];actor="$(val userId < "$tmp/setup")";ws="$(val workspaceId < "$tmp/setup")";csrf="$(curl -fsS -b "$cookie" "$url/api/v1/auth/csrf")";header="$(printf %s "$csrf"|val headerName)";token="$(printf %s "$csrf"|val token)"
code="$(post /api/v1/knowledge-bases/create "{\"workspaceId\":\"$ws\",\"name\":\"Merge Target\",\"slug\":\"merge-target\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$ws\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" "$tmp/target")";[[ "$code" == 201 ]];target="$(val id < "$tmp/target")"
code="$(post /api/v1/knowledge-bases/create "{\"workspaceId\":\"$ws\",\"name\":\"Source Knowledge\",\"slug\":\"source-kb\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$ws\",\"visibility\":\"WORKSPACE\",\"publishMode\":\"MANUAL\"}" "$tmp/source")";[[ "$code" == 201 ]];source="$(val id < "$tmp/source")"
create_page(){ local kb="$1" title="$2" path="$3" out="$4";local code;code="$(post /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"$title\",\"path\":\"$path\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"$title body\"}]}}" "$out")";[[ "$code" == 201 ]];}
create_page "$target" "Existing Guide" guide "$tmp/target-page";target_page="$(val id < "$tmp/target-page")"
create_page "$source" "Source Guide" guide "$tmp/source-guide";source_guide="$(val id < "$tmp/source-guide")"
create_page "$source" "Source Notes" notes "$tmp/source-notes";source_notes="$(val id < "$tmp/source-notes")"
code="$(post /api/v1/catalog/create "{\"knowledgeBaseId\":\"$source\",\"nodeType\":\"GROUP\",\"titleOverride\":\"Source Group\",\"expectedRevision\":0}" "$tmp/source-group")";[[ "$code" == 201 ]];source_group="$(python3 -c 'import json,sys;print(json.load(sys.stdin)["nodes"][0]["id"])' < "$tmp/source-group")"
code="$(post /api/v1/catalog/create "{\"knowledgeBaseId\":\"$source\",\"nodeType\":\"DOCUMENT\",\"pageId\":\"$source_guide\",\"parentId\":\"$source_group\",\"expectedRevision\":1}" "$tmp/source-guide-node")";[[ "$code" == 201 ]]
code="$(post /api/v1/catalog/create "{\"knowledgeBaseId\":\"$source\",\"nodeType\":\"DOCUMENT\",\"pageId\":\"$source_notes\",\"parentId\":\"$source_group\",\"expectedRevision\":2}" "$tmp/source-notes-node")";[[ "$code" == 201 ]]
code="$(post /api/v1/pages/publish "{\"pageId\":\"$source_guide\",\"idempotencyKey\":\"source-publication\"}" "$tmp/publication")";[[ "$code" == 201 ]];publication="$(val id < "$tmp/publication")"
member="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "with u as (insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at) select gen_random_uuid(),'member@example.com','member@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now() from users where id='$actor' returning id),w as(insert into workspace_memberships(workspace_id,user_id,role,created_at) select '$ws',id,'MEMBER',now() from u returning user_id) select user_id from w;")"
code="$(post /api/v1/knowledge-bases/members/upsert "{\"knowledgeBaseId\":\"$target\",\"userId\":\"$member\",\"role\":\"READER\"}" "$tmp/target-member")";[[ "$code" == 200 ]]
code="$(post /api/v1/knowledge-bases/members/upsert "{\"knowledgeBaseId\":\"$source\",\"userId\":\"$member\",\"role\":\"EDITOR\"}" "$tmp/source-member")";[[ "$code" == 200 ]]
docker exec "$db" psql -U knowledge -d knowledge -v ON_ERROR_STOP=1 -c "
insert into shares(id,workspace_id,resource_type,resource_id,share_type,token_hash,role,created_by,created_at,updated_at) values(gen_random_uuid(),'$ws','KNOWLEDGE_BASE','$source','PUBLIC',repeat('a',64),'READER','$actor',now(),now());
insert into shares(id,workspace_id,resource_type,resource_id,share_type,token_hash,role,created_by,created_at,updated_at) values(gen_random_uuid(),'$ws','PAGE','$source_guide','PUBLIC',repeat('b',64),'READER','$actor',now(),now());
insert into favorites(user_id,workspace_id,resource_type,resource_id,created_at) values('$actor','$ws','KNOWLEDGE_BASE','$source',now());
insert into activity_events(id,workspace_id,actor_id,resource_type,resource_id,event_type,metadata,occurred_at) values(gen_random_uuid(),'$ws','$actor','KNOWLEDGE_BASE','$source','VIEW','{}',now());
insert into knowledge_base_user_groups(id,workspace_id,user_id,name,position,created_at,updated_at) values(gen_random_uuid(),'$ws','$actor','Merged favorites',lpad('1',39,'0'),now(),now());
insert into knowledge_base_user_group_items(group_id,user_id,knowledge_base_id,position,created_at) select id,user_id,'$source',lpad('1',39,'0'),now() from knowledge_base_user_groups where user_id='$actor' and name='Merged favorites';
insert into social_follows(follower_id,target_type,target_id,notifications_enabled,created_at) values('$actor','KNOWLEDGE_BASE','$source',true,now());
insert into content_events(id,workspace_id,actor_id,resource_type,resource_id,knowledge_base_id,event_type,metadata,occurred_at) values(gen_random_uuid(),'$ws','$actor','KNOWLEDGE_BASE','$source','$source','VIEW','{}',now());
insert into daily_content_metrics(workspace_id,resource_type,resource_id,metric_date,views,unique_views,updated_at) values('$ws','KNOWLEDGE_BASE','$source',current_date,5,2,now());
insert into daily_metric_unique_visitors(workspace_id,resource_type,resource_id,metric_date,visitor_key,created_at) values('$ws','KNOWLEDGE_BASE','$source',current_date,'user:$actor',now());
insert into acl_entries(id,workspace_id,resource_type,resource_id,subject_type,subject_id,role,effect,capabilities,created_by,created_at,updated_at) values(gen_random_uuid(),'$ws','KNOWLEDGE_BASE','$source','USER','$member','EDITOR','ALLOW','[]','$actor',now(),now());" >/dev/null
code="$(post /api/v1/knowledge-bases/merge/plan "{\"sourceKnowledgeBaseId\":\"$source\",\"targetKnowledgeBaseId\":\"$target\"}" "$tmp/plan-1")";[[ "$code" == 200 ]];fingerprint_1="$(val fingerprint < "$tmp/plan-1")"
python3 - "$tmp/plan-1" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));assert p['pageCount']==2 and p['activePageCount']==2,p
assert p['catalogNodeCount']==3 and p['publicationCount']==1 and p['memberCount']==2,p
conflicts=[x for x in p['paths'] if x['renamed']];assert len(conflicts)==1 and conflicts[0]['originalPath']=='guide' and conflicts[0]['resolvedPath']=='guide-source-kb',conflicts
assert len(p['fingerprint'])==64,p
PY
code="$(post /api/v1/pages/update "{\"pageId\":\"$source_notes\",\"expectedRevision\":0,\"title\":\"Source Notes Updated\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"updated before merge\"}]},\"revisionKind\":\"MANUAL\"}" "$tmp/source-update")";[[ "$code" == 200 ]]
code="$(post /api/v1/knowledge-bases/merge/execute "{\"sourceKnowledgeBaseId\":\"$source\",\"targetKnowledgeBaseId\":\"$target\",\"planFingerprint\":\"$fingerprint_1\",\"idempotencyKey\":\"merge-operation-2026\"}" "$tmp/stale")";[[ "$code" == 409 ]];[[ "$(problem < "$tmp/stale")" == KNOWLEDGE_BASE_MERGE_PLAN_STALE ]]
code="$(post /api/v1/knowledge-bases/merge/plan "{\"sourceKnowledgeBaseId\":\"$source\",\"targetKnowledgeBaseId\":\"$target\"}" "$tmp/plan-2")";[[ "$code" == 200 ]];fingerprint_2="$(val fingerprint < "$tmp/plan-2")";[[ "$fingerprint_1" != "$fingerprint_2" ]]
code="$(post /api/v1/knowledge-bases/merge/execute "{\"sourceKnowledgeBaseId\":\"$source\",\"targetKnowledgeBaseId\":\"$target\",\"planFingerprint\":\"$fingerprint_2\",\"idempotencyKey\":\"merge-operation-2026\"}" "$tmp/result")";[[ "$code" == 200 ]]
python3 - "$tmp/result" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert r['movedPages']==2 and r['movedCatalogNodes']==3,r
assert r['mergedMembers']==2 and r['revokedKnowledgeBaseShares']==1 and r['targetCatalogRevision']==1 and not r['replayed'],r
PY
code="$(post /api/v1/knowledge-bases/merge/execute "{\"sourceKnowledgeBaseId\":\"$source\",\"targetKnowledgeBaseId\":\"$target\",\"planFingerprint\":\"$fingerprint_2\",\"idempotencyKey\":\"merge-operation-2026\"}" "$tmp/replay")";[[ "$code" == 200 ]];[[ "$(val replayed < "$tmp/replay")" == True ]];[[ "$(val mergeId < "$tmp/replay")" == "$(val mergeId < "$tmp/result")" ]]
code="$(post /api/v1/pages/get "{\"pageId\":\"$source_guide\"}" "$tmp/moved-page")";[[ "$code" == 200 ]];[[ "$(val knowledgeBaseId < "$tmp/moved-page")" == "$target" ]];[[ "$(val path < "$tmp/moved-page")" == guide-source-kb ]]
code="$(post /api/v1/knowledge-bases/list "{\"workspaceId\":\"$ws\"}" "$tmp/kb-list")";[[ "$code" == 200 ]]
python3 - "$tmp/kb-list" "$source" "$target" <<'PY'
import json,sys
ids={x['id'] for x in json.load(open(sys.argv[1]))};assert sys.argv[2] not in ids and sys.argv[3] in ids,ids
PY
counts="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select
(select count(*) from knowledge_bases where id='$source' and archived_at is not null),
(select count(*) from pages where knowledge_base_id='$target'),
(select count(*) from pages where knowledge_base_id='$target' and path='guide-source-kb'),
(select count(*) from page_publications where id='$publication' and knowledge_base_id='$target'),
(select count(*) from catalog_nodes where knowledge_base_id='$target' and deleted_at is null),
(select count(*) from catalog_revisions where knowledge_base_id='$target' and operation='MERGE_SOURCE'),
(select count(*) from knowledge_base_members where knowledge_base_id='$target' and user_id='$member' and role='EDITOR'),
(select count(*) from knowledge_base_members where knowledge_base_id='$source'),
(select count(*) from shares where resource_type='KNOWLEDGE_BASE' and resource_id='$source' and revoked_at is not null),
(select count(*) from shares where resource_type='PAGE' and resource_id='$source_guide' and revoked_at is null),
(select count(*) from favorites where resource_type='KNOWLEDGE_BASE' and resource_id='$target'),
(select count(*) from knowledge_base_user_group_items where knowledge_base_id='$target'),
(select count(*) from social_follows where target_type='KNOWLEDGE_BASE' and target_id='$target'),
(select count(*) from content_events where knowledge_base_id='$target' and resource_id='$target'),
(select views from daily_content_metrics where workspace_id='$ws' and resource_type='KNOWLEDGE_BASE' and resource_id='$target' and metric_date=current_date),
(select count(*) from acl_entries where resource_type='KNOWLEDGE_BASE' and resource_id='$target' and subject_id='$member' and deleted_at is null),
(select count(*) from search_documents where resource_type='PAGE' and metadata->>'knowledgeBaseId'='$source'),
(select count(*) from knowledge_base_merges where source_knowledge_base_id='$source' and target_knowledge_base_id='$target');")"
[[ "$counts" == "1|3|1|1|4|1|1|0|1|1|1|1|1|1|5|1|0|1" ]]
echo "KNOWLEDGE_BASE_MERGE_COUNTS"
echo "$counts"
echo "KNOWLEDGE_BASE_MERGE_E2E_SUCCESS"
