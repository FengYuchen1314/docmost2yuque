#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Social garden E2E failed at line $LINENO" >&2' ERR
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."&&pwd)";jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}";[[ -f "$jar" ]];suffix="kp-social-e2e-$(date +%s)-$$";net="$suffix-net";db="$suffix-db";api="$suffix-api";tmp="$(mktemp -d /tmp/kp-social-e2e.XXXXXX)"
cleanup(){ docker rm -f "$api" "$db" >/dev/null 2>&1||true;docker network rm "$net" >/dev/null 2>&1||true;case "$tmp" in /tmp/kp-social-e2e.*)rm -rf -- "$tmp";;esac;};trap cleanup EXIT
wait_for(){ local label="$1";shift;for _ in $(seq 1 90);do "$@" >/dev/null 2>&1&&return;sleep 1;done;echo "timeout $label";docker logs "$api";return 1;};val(){ python3 -c 'import json,sys;print(json.load(sys.stdin)[sys.argv[1]])' "$1";};post(){ local cookie="$1" header="$2" token="$3" path="$4" data="$5" out="$6";curl -sS -o "$out" -w '%{http_code}' -b "$cookie" -H "$header: $token" -H 'Content-Type: application/json' --data-binary "$data" "$url$path";}
docker network create "$net" >/dev/null;docker run -d --name "$db" --network "$net" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null;wait_for db docker exec "$db" pg_isready -U knowledge -d knowledge
docker run -d --name "$api" --network "$net" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" -e PUBLIC_BASE_URL=https://knowledge.example -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null;port="$(docker port "$api" 8080/tcp|sed -n 's/.*://p'|head -1)";url="http://127.0.0.1:$port";wait_for api curl -fsS "$url/actuator/health"
admin_cookie="$tmp/admin-c";[[ "$(curl -sS -o "$tmp/setup" -w '%{http_code}' -c "$admin_cookie" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Social Workspace"}' "$url/api/v1/setup/initialize")" == 201 ]];admin="$(val userId < "$tmp/setup")";ws="$(val workspaceId < "$tmp/setup")";csrf="$(curl -fsS -b "$admin_cookie" "$url/api/v1/auth/csrf")";ah="$(printf %s "$csrf"|val headerName)";at="$(printf %s "$csrf"|val token)"
member="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "with u as (insert into users(id,email_original,email_normalized,display_name,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at) select gen_random_uuid(),'member@example.com','member@example.com','Member',password_hash,'ACTIVE',now(),'ADMIN',now(),now() from users where id='$admin' returning id),m as(insert into workspace_memberships(workspace_id,user_id,role,created_at) select '$ws',id,'MEMBER',now() from u) select id from u")"
member_cookie="$tmp/member-c";[[ "$(curl -sS -o "$tmp/member-login" -w '%{http_code}' -c "$member_cookie" -H 'Content-Type: application/json' --data-binary '{"email":"member@example.com","password":"Admin-Password-2026!"}' "$url/api/v1/auth/login/password")" == 204 ]];csrf="$(curl -fsS -b "$member_cookie" "$url/api/v1/auth/csrf")";mh="$(printf %s "$csrf"|val headerName)";mt="$(printf %s "$csrf"|val token)"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/social/profile/save '{"slug":"admin-writer","displayName":"Admin Writer","bio":"构建开放知识花园","theme":"MAGAZINE","navigation":[{"label":"首页","url":"/u/admin-writer"}],"discoverable":true,"rssEnabled":true}' "$tmp/admin-profile")" == 200 ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/profile/save '{"slug":"member-reader","displayName":"Member Reader","bio":"知识阅读者","theme":"PAPER","navigation":[],"discoverable":true,"rssEnabled":true}' "$tmp/member-profile")" == 200 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/knowledge-bases/create "{\"workspaceId\":\"$ws\",\"name\":\"Open Garden KB\",\"slug\":\"open-garden-kb\",\"description\":\"公共知识内容\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$ws\",\"visibility\":\"PUBLIC\",\"publishMode\":\"MANUAL\",\"allowPublicIndex\":true}" "$tmp/kb")" == 201 ]];kb="$(val id < "$tmp/kb")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/knowledge-bases/update "{\"knowledgeBaseId\":\"$kb\",\"name\":\"Open Garden KB\",\"slug\":\"open-garden-kb\",\"description\":\"公共知识内容\",\"visibility\":\"PUBLIC\",\"allowPublicIndex\":true,\"publishMode\":\"MANUAL\",\"watermarkConfig\":\"{\\\"enabled\\\":true,\\\"text\\\":\\\"{{email}} · 内部资料\\\",\\\"position\\\":\\\"TILED\\\",\\\"opacity\\\":0.12}\",\"appearanceConfig\":\"{\\\"theme\\\":\\\"MAGAZINE\\\",\\\"coverUrl\\\":\\\"https://cdn.example.com/cover.jpg\\\",\\\"backgroundColor\\\":\\\"#f7f8f6\\\",\\\"accentColor\\\":\\\"#3f8f61\\\",\\\"contentWidth\\\":\\\"WIDE\\\"}\",\"catalogConfig\":\"{\\\"defaultExpandDepth\\\":2,\\\"showPath\\\":true,\\\"showUpdatedAt\\\":true}\"}" "$tmp/kb-appearance")" == 200 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"公开知识文章\",\"path\":\"public-knowledge\",\"contentType\":\"DOCUMENT\",\"icon\":\"🧭\",\"cover\":\"https://cdn.example.com/page-cover.jpg\",\"documentSettings\":{\"pageWidth\":\"wide\",\"fontFamily\":\"sans\",\"fontSize\":\"large\",\"paragraphSpacing\":\"relaxed\",\"untrustedCss\":\"position:fixed\"},\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"数字花园公开正文\"}]}}" "$tmp/page")" == 201 ]];page="$(val id < "$tmp/page")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/publish "{\"pageId\":\"$page\",\"idempotencyKey\":\"social-publish\"}" "$tmp/publication")" == 201 ]];publication="$(val id < "$tmp/publication")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/shares/create "{\"pageId\":\"$page\",\"role\":\"READER\",\"allowCopy\":true,\"allowDownload\":true,\"allowExport\":true,\"allowComment\":false}" "$tmp/share")" == 201 ]];share_token="$(val token < "$tmp/share")"
[[ "$(curl -sS -o "$tmp/share-reader" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"token\":\"$share_token\"}" "$url/api/v1/shares/resolve")" == 200 ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["publication"]["title"]=="公开知识文章";assert d["publication"]["metadata"]["icon"]=="🧭";assert d["publication"]["metadata"]["cover"].endswith("page-cover.jpg");assert d["appearanceConfig"]["theme"]=="MAGAZINE";assert d["watermarkConfig"]["enabled"] is True' < "$tmp/share-reader"
[[ "$(curl -sS -o "$tmp/share-download.txt" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"token\":\"$share_token\"}" "$url/api/v1/shares/download")" == 200 ]];grep -q '公开访客 · 内部资料' "$tmp/share-download.txt"
[[ "$(curl -sS -o "$tmp/share-export.json" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"token\":\"$share_token\"}" "$url/api/v1/shares/export")" == 200 ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["title"]=="公开知识文章";assert d["content"]["type"]=="doc";assert d["watermark"]["text"]=="公开访客 · 内部资料";assert d["watermark"]["position"]=="TILED"' < "$tmp/share-export.json"
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select (select count(*) from content_events where event_type='EXPORT' and resource_id='$page'),(select count(*) from audit_events where action in ('share.download','share.export'))")" == '2|2' ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/update "{\"pageId\":\"$page\",\"expectedRevision\":0,\"documentSettings\":{\"pageWidth\":\"STANDARD\",\"fontFamily\":\"SERIF\",\"fontSize\":\"SMALL\",\"paragraphSpacing\":\"COMPACT\",\"showOutline\":false}}" "$tmp/page-settings-update")" == 200 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/social/gardens/create "{\"slug\":\"open-garden\",\"title\":\"开放花园\",\"description\":\"精选公共知识\",\"theme\":\"MINIMAL\",\"navigation\":[],\"discoverable\":true,\"rssEnabled\":true,\"knowledgeBaseIds\":[\"$kb\"]}" "$tmp/garden")" == 200 ]];garden="$(val id < "$tmp/garden")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/social/gardens/create '{"slug":"temporary-garden","title":"临时花园","description":"删除流程验证","theme":"PAPER","navigation":[],"discoverable":true,"rssEnabled":false,"knowledgeBaseIds":[]}' "$tmp/temporary-garden")" == 200 ]];temporary_garden="$(val id < "$tmp/temporary-garden")"
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/follow "{\"targetType\":\"USER\",\"targetId\":\"$admin\",\"notificationsEnabled\":true}" "$tmp/follow-user")" == 200 ]];[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/follow "{\"targetType\":\"GARDEN\",\"targetId\":\"$garden\",\"notificationsEnabled\":true}" "$tmp/follow-garden")" == 200 ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/follow "{\"targetType\":\"GARDEN\",\"targetId\":\"$temporary_garden\",\"notificationsEnabled\":true}" "$tmp/follow-temporary-garden")" == 200 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/social/gardens/delete "{\"gardenId\":\"$temporary_garden\"}" "$tmp/delete-temporary-garden")" == 204 ]]
[[ "$(curl -sS -o "$tmp/deleted-garden" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary '{"slug":"temporary-garden"}' "$url/api/public/v1/social/garden")" == 404 ]]
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select (select count(*) from public_gardens where id='$temporary_garden'),(select count(*) from social_follows where target_type='GARDEN' and target_id='$temporary_garden');")" == '0|0' ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/follow "{\"targetType\":\"KNOWLEDGE_BASE\",\"targetId\":\"$kb\",\"notificationsEnabled\":false}" "$tmp/follow-kb-muted")" == 200 ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/follow/status "{\"targetType\":\"KNOWLEDGE_BASE\",\"targetId\":\"$kb\"}" "$tmp/follow-kb-status-muted")" == 200 ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d=={"followed":True,"notificationsEnabled":False},d' < "$tmp/follow-kb-status-muted"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/republish "{\"pageId\":\"$page\",\"idempotencyKey\":\"social-deduplicated-publication\"}" "$tmp/deduplicated-publication")" == 201 ]];deduplicated_publication="$(val id < "$tmp/deduplicated-publication")"
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select count(*),coalesce(max(occurrence_count),0) from notifications where recipient_id='$member' and notification_type='PUBLICATION';")" == '1|1' ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/follow "{\"targetType\":\"USER\",\"targetId\":\"$admin\",\"notificationsEnabled\":false}" "$tmp/mute-user")" == 200 ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/follow "{\"targetType\":\"GARDEN\",\"targetId\":\"$garden\",\"notificationsEnabled\":false}" "$tmp/mute-garden")" == 200 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/republish "{\"pageId\":\"$page\",\"idempotencyKey\":\"social-muted-publication\"}" "$tmp/muted-publication")" == 201 ]]
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select count(*) from notifications where recipient_id='$member' and notification_type='PUBLICATION';")" == 1 ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/follow "{\"targetType\":\"KNOWLEDGE_BASE\",\"targetId\":\"$kb\",\"notificationsEnabled\":true}" "$tmp/unmute-kb")" == 200 ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/follow/status "{\"targetType\":\"KNOWLEDGE_BASE\",\"targetId\":\"$kb\"}" "$tmp/follow-kb-status-live")" == 200 ]]
python3 -c 'import json,sys;d=json.load(sys.stdin);assert d=={"followed":True,"notificationsEnabled":True},d' < "$tmp/follow-kb-status-live"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/republish "{\"pageId\":\"$page\",\"idempotencyKey\":\"social-kb-follow-publication\"}" "$tmp/final-publication")" == 201 ]];publication="$(val id < "$tmp/final-publication")"
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/notifications/page '{"unreadOnly":true,"category":"UPDATES","offset":0,"limit":10}' "$tmp/publication-notifications")" == 200 ]]
python3 - "$tmp/publication-notifications" "$publication" "$deduplicated_publication" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); expected={sys.argv[2],sys.argv[3]}
assert d['hasMore'] is False and d['nextOffset']==2,d
assert len(d['items'])==2 and {item['payload']['publicationId'] for item in d['items']}==expected,d
assert all(item['type']=='PUBLICATION' and item['occurrenceCount']==1 for item in d['items']),d
assert d['items'][0]['payload']['publicationId']==sys.argv[2] and d['items'][0]['payload']['title']=='公开知识文章',d
PY
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/reactions/toggle "{\"publicationId\":\"$publication\",\"reactionType\":\"HEART\"}" "$tmp/reaction")" == 200 ]];grep -q '"HEART"' "$tmp/reaction"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"公开分页文章\",\"path\":\"public-page-two\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"第二篇公开正文\"}]}}" "$tmp/public-page-two")" == 201 ]];public_page_two="$(val id < "$tmp/public-page-two")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/publish "{\"pageId\":\"$public_page_two\",\"idempotencyKey\":\"social-page-two\"}" "$tmp/publication-two")" == 201 ]];publication_two="$(val id < "$tmp/publication-two")"
[[ "$(curl -sS -o "$tmp/profile-content-one" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary '{"slug":"admin-writer","offset":0,"limit":1}' "$url/api/public/v1/social/profile/content/page")" == 200 ]];profile_next="$(val nextOffset < "$tmp/profile-content-one")"
[[ "$(curl -sS -o "$tmp/profile-content-two" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"slug\":\"admin-writer\",\"offset\":$profile_next,\"limit\":1}" "$url/api/public/v1/social/profile/content/page")" == 200 ]]
[[ "$(curl -sS -o "$tmp/garden-content-one" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"slug\":\"open-garden\",\"knowledgeBaseId\":\"$kb\",\"offset\":0,\"limit\":1}" "$url/api/public/v1/social/garden/content/page")" == 200 ]];garden_next="$(val nextOffset < "$tmp/garden-content-one")"
[[ "$(curl -sS -o "$tmp/garden-content-two" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"slug\":\"open-garden\",\"knowledgeBaseId\":\"$kb\",\"offset\":$garden_next,\"limit\":1}" "$url/api/public/v1/social/garden/content/page")" == 200 ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/feed/page '{"offset":0,"limit":1}' "$tmp/feed-page-one")" == 200 ]];feed_next="$(val nextOffset < "$tmp/feed-page-one")"
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/feed/page "{\"offset\":$feed_next,\"limit\":1}" "$tmp/feed-page-two")" == 200 ]]
python3 - "$tmp/profile-content-one" "$tmp/profile-content-two" "$tmp/garden-content-one" "$tmp/garden-content-two" "$tmp/feed-page-one" "$tmp/feed-page-two" "$publication" "$publication_two" <<'PY'
import json,sys
pages=[json.load(open(path)) for path in sys.argv[1:7]]; expected={sys.argv[7],sys.argv[8]}
for first,second in ((pages[0],pages[1]),(pages[2],pages[3]),(pages[4],pages[5])):
    assert len(first['items'])==1 and first['hasMore'] is True and first['nextOffset']==1,first
    assert len(second['items'])==1 and second['hasMore'] is False and second['nextOffset']==2,second
    ids={item.get('publicationId',item['content']['publicationId']) if 'content' in item else item['publicationId'] for item in first['items']+second['items']}
    assert ids==expected,(ids,expected)
PY
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/feed '{"limit":20}' "$tmp/feed")" == 200 ]];python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d)==2 and {x["content"]["title"] for x in d}=={"公开知识文章","公开分页文章"},d' < "$tmp/feed"
[[ "$(curl -sS -o "$tmp/public-profile" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary '{"slug":"admin-writer"}' "$url/api/public/v1/social/profile")" == 200 ]];[[ "$(curl -sS -o "$tmp/public-garden" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary '{"slug":"open-garden"}' "$url/api/public/v1/social/garden")" == 200 ]];[[ "$(curl -sS -o "$tmp/explore" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary '{"limit":20}' "$url/api/public/v1/social/explore")" == 200 ]]
[[ "$(curl -sS -o "$tmp/public-search" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary '{"workspaceId":null,"query":"数字花园","offset":0,"limit":12}' "$url/api/public/v1/search")" == 200 ]]
[[ "$(curl -sS -o "$tmp/public-reader" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "{\"publicationId\":\"$publication\"}" "$url/api/public/v1/social/publication")" == 200 ]]
python3 - "$tmp/public-profile" "$tmp/public-garden" "$tmp/explore" "$tmp/public-reader" "$tmp/public-search" <<'PY'
import json,sys
p,g,e,r,s=[json.load(open(x)) for x in sys.argv[1:]]
assert p['followerCount']==1 and p['slug']=='admin-writer',p
assert g['followerCount']==1 and len(g['knowledgeBases'])==1,g
assert e['trending'][0]['title']=='公开知识文章' and e['trending'][0]['reactions']['HEART']==1,e
assert r['metadata']['publicationId']==r['metadata']['publicationId'] and r['metadata']['title']=='公开知识文章',r
assert len(s['results'])==1 and s['results'][0]['publicationId']==r['metadata']['publicationId'] and s['results'][0]['title']=='公开知识文章',s
assert s['hasMore'] is False and s['nextOffset']==1,s
assert r['plainText']=='数字花园公开正文' and r['content']['type']=='doc' and r['schemaVersion']==1,r
assert r['documentSettings']=={'pageWidth':'STANDARD','fontFamily':'SERIF','fontSize':'SMALL','paragraphSpacing':'COMPACT','showOutline':False},r
assert r['pageMetadata']['icon']=='🧭' and r['pageMetadata']['cover'].endswith('page-cover.jpg'),r
assert r['appearanceConfig']['theme']=='MAGAZINE' and r['appearanceConfig']['contentWidth']=='WIDE',r
assert r['watermarkConfig']['enabled'] is True and r['watermarkConfig']['position']=='TILED',r
PY
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select
  (select count(*) from content_events where event_type='VIEW' and resource_id='$page'),
  (select coalesce(sum(views),0) from daily_content_metrics where resource_id='$page'),
  (select coalesce(sum(unique_views),0) from daily_content_metrics where resource_id='$page');")" == '2|2|1' ]]
curl -fsS "$url/api/public/v1/social/profiles/admin-writer/rss.xml" -o "$tmp/rss";curl -fsS "$url/api/public/v1/social/profiles/admin-writer/sitemap.xml" -o "$tmp/sitemap";grep -q '<rss' "$tmp/rss";grep -q '公开知识文章' "$tmp/rss";grep -q 'knowledge.example/u/admin-writer' "$tmp/sitemap"
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/block "{\"userId\":\"$admin\"}" "$tmp/block")" == 200 ]];[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/feed '{"limit":20}' "$tmp/blocked-feed")" == 200 ]];[[ "$(python3 -c 'import json,sys;print(len(json.load(sys.stdin)))' < "$tmp/blocked-feed")" == 0 ]];[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/unblock "{\"userId\":\"$admin\"}" "$tmp/unblock")" == 200 ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/reports/create "{\"targetType\":\"PUBLICATION\",\"targetId\":\"$publication\",\"reason\":\"OTHER\",\"details\":\"审核流程测试\"}" "$tmp/report")" == 200 ]];report="$(val id < "$tmp/report")"
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/social/reports/create "{\"targetType\":\"PUBLICATION\",\"targetId\":\"$publication\",\"reason\":\"SPAM\",\"details\":\"第二条审核流程测试\"}" "$tmp/report-two")" == 200 ]];report_two="$(val id < "$tmp/report-two")"
[[ "$report" != "$report_two" ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/admin/social/reports/list '{"status":"OPEN","limit":20}' "$tmp/reports")" == 200 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/admin/social/reports/page '{"status":"OPEN","offset":0,"limit":1}' "$tmp/report-page-one")" == 200 ]];report_next="$(val nextOffset < "$tmp/report-page-one")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/admin/social/reports/page "{\"status\":\"OPEN\",\"offset\":$report_next,\"limit\":1}" "$tmp/report-page-two")" == 200 ]]
python3 - "$tmp/report-page-one" "$tmp/report-page-two" "$report" "$report_two" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2])); expected={sys.argv[3],sys.argv[4]}
assert one['hasMore'] is True and one['nextOffset']==1 and len(one['items'])==1,one
assert two['hasMore'] is False and two['nextOffset']==2 and len(two['items'])==1,two
assert {one['items'][0]['id'],two['items'][0]['id']}==expected,(one,two)
PY
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/admin/social/reports/review "{\"reportId\":\"$report\",\"status\":\"RESOLVED\",\"resolution\":\"已处理\"}" "$tmp/review")" == 200 ]]
echo SOCIAL_GARDEN_E2E_COUNTS;docker exec "$db" psql -U knowledge -d knowledge -Atc "select (select count(*) from public_profiles),(select count(*) from public_gardens),(select count(*) from social_follows),(select count(*) from publication_reactions),(select count(*) from social_blocks),(select count(*) from social_reports where status='RESOLVED')"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"待删除的第二篇文稿\",\"path\":\"second-trash-item\",\"contentType\":\"WHITEBOARD\"}" "$tmp/trash-page-two")" == 201 ]];trash_page_two="$(val id < "$tmp/trash-page-two")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"检索分页甲\",\"path\":\"search-page-a\",\"contentType\":\"DOCUMENT\"}" "$tmp/search-page-a")" == 201 ]];search_page_a="$(val id < "$tmp/search-page-a")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb\",\"title\":\"检索分页乙\",\"path\":\"search-page-b\",\"contentType\":\"DATABASE\"}" "$tmp/search-page-b")" == 201 ]];search_page_b="$(val id < "$tmp/search-page-b")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/search "{\"workspaceId\":\"$ws\",\"query\":\"检索分页\",\"resourceTypes\":[\"PAGE\"],\"offset\":0,\"limit\":1}" "$tmp/internal-search-one")" == 200 ]];search_next="$(val nextOffset < "$tmp/internal-search-one")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/search "{\"workspaceId\":\"$ws\",\"query\":\"检索分页\",\"resourceTypes\":[\"PAGE\"],\"offset\":$search_next,\"limit\":1}" "$tmp/internal-search-two")" == 200 ]]
python3 - "$tmp/internal-search-one" "$tmp/internal-search-two" "$search_page_a" "$search_page_b" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2])); expected={sys.argv[3],sys.argv[4]}
assert len(one['results'])==1 and one['hasMore'] is True and one['nextOffset']==1,one
assert len(two['results'])==1 and two['hasMore'] is False and two['nextOffset']==2,two
assert {one['results'][0]['resourceId'],two['results'][0]['resourceId']}==expected,(one,two)
PY
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/search "{\"workspaceId\":\"$ws\",\"query\":\"member@example.com\",\"resourceTypes\":[\"USER\"],\"offset\":0,\"limit\":10}" "$tmp/member-search")" == 200 ]]
python3 - "$tmp/member-search" "$member" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); assert len(d['results'])==1,d
r=d['results'][0]; assert r['resourceType']=='USER' and r['resourceId']==sys.argv[2] and r['title']=='Member Reader',r
assert 'member@example.com' in r['snippet'] and d['hasMore'] is False,d
PY
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/trash "{\"pageId\":\"$page\"}" "$tmp/trash-page-one")" == 204 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/trash "{\"pageId\":\"$trash_page_two\"}" "$tmp/trash-page-two-result")" == 204 ]]
trash_page_status="$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/trash/page '{"query":null,"offset":0,"limit":1}' "$tmp/global-trash-one")";if [[ "$trash_page_status" != 200 ]];then echo "GLOBAL_TRASH_STATUS $trash_page_status";cat "$tmp/global-trash-one";docker logs "$api";false;fi;trash_next="$(val nextOffset < "$tmp/global-trash-one")"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/trash/page "{\"query\":\"Open Garden\",\"offset\":$trash_next,\"limit\":1}" "$tmp/global-trash-two")" == 200 ]]
python3 - "$tmp/global-trash-one" "$tmp/global-trash-two" "$page" "$trash_page_two" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2])); expected={sys.argv[3],sys.argv[4]}
assert len(one['items'])==1 and one['hasMore'] is True and one['nextOffset']==1,one
assert len(two['items'])==1 and two['hasMore'] is False and two['nextOffset']==2,two
assert {one['items'][0]['id'],two['items'][0]['id']}==expected,(one,two)
assert all(item['restoreAllowed'] and item['deleteAllowed'] for item in [one['items'][0],two['items'][0]])
assert all(item['workspaceName']=='Social Workspace' and item['knowledgeBaseName']=='Open Garden KB' for item in [one['items'][0],two['items'][0]])
PY
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/pages/trash/page '{"query":null,"offset":0,"limit":25}' "$tmp/member-global-trash")" == 200 ]]
[[ "$(post "$member_cookie" "$mh" "$mt" /api/v1/pages/trash/list "{\"workspaceId\":\"$ws\"}" "$tmp/member-legacy-trash")" == 200 ]]
python3 - "$tmp/member-global-trash" "$tmp/member-legacy-trash" <<'PY'
import json,sys
page,legacy=json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))
assert page=={'items':[],'nextOffset':2,'hasMore':False},page
assert legacy==[],legacy
PY
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/restore-batch "{\"pageIds\":[\"$page\",\"$trash_page_two\"]}" "$tmp/trash-restore-batch")" == 200 ]]
[[ "$(python3 -c 'import json,sys;print(len(json.load(sys.stdin)))' < "$tmp/trash-restore-batch")" == 2 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/trash/page '{"query":null,"offset":0,"limit":25}' "$tmp/global-trash-empty")" == 200 ]];python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["items"]==[] and d["hasMore"] is False,d' < "$tmp/global-trash-empty"
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/trash "{\"pageId\":\"$page\"}" "$tmp/retrash-page-one")" == 204 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/trash "{\"pageId\":\"$trash_page_two\"}" "$tmp/retrash-page-two")" == 204 ]]
[[ "$(post "$admin_cookie" "$ah" "$at" /api/v1/pages/delete-permanently-batch "{\"pageIds\":[\"$page\",\"$trash_page_two\"]}" "$tmp/trash-delete-batch")" == 204 ]]
[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select count(*) from pages where id in ('$page','$trash_page_two');")" == 0 ]]
echo SOCIAL_GARDEN_E2E_SUCCESS
