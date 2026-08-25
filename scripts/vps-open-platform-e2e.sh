#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Open platform E2E failed at line $LINENO" >&2' ERR
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."&&pwd)";jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}";[[ -f "$jar" ]];suffix="kp-open-e2e-$(date +%s)-$$";net="$suffix-net";db="$suffix-db";api="$suffix-api";hook="$suffix-hook";tmp="$(mktemp -d /tmp/kp-open-e2e.XXXXXX)"
cleanup(){ docker rm -f "$api" "$hook" "$db" >/dev/null 2>&1||true;docker network rm "$net" >/dev/null 2>&1||true;case "$tmp" in /tmp/kp-open-e2e.*)rm -rf -- "$tmp";;esac;};trap cleanup EXIT
wait_for(){ local label="$1";shift;for _ in $(seq 1 100);do "$@" >/dev/null 2>&1&&return;sleep 1;done;echo "timeout $label";docker logs "$api";return 1;};val(){ python3 -c 'import json,sys;v=json.load(sys.stdin);print(v[sys.argv[1]] if v.get(sys.argv[1]) is not None else "")' "$1";};post(){ local cookie="$1" header="$2" token="$3" path="$4" data="$5" out="$6";curl -sS -o "$out" -w '%{http_code}' -b "$cookie" -H "$header: $token" -H 'Content-Type: application/json' --data-binary "$data" "$url$path";}
docker network create "$net" >/dev/null
docker run -d --name "$db" --network "$net" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null
docker run -d --name "$hook" --network "$net" --network-alias hook python:3.13-alpine python -u -c 'import http.server,json
class H(http.server.BaseHTTPRequestHandler):
 def do_POST(self):
  body=self.rfile.read(int(self.headers.get("content-length",0))).decode();print(json.dumps({"signature":self.headers.get("X-Knowledge-Signature"),"timestamp":self.headers.get("X-Knowledge-Timestamp"),"event":self.headers.get("X-Knowledge-Event"),"delivery":self.headers.get("X-Knowledge-Delivery"),"body":body}),flush=True);self.send_response(204);self.end_headers()
 def log_message(self,*args):pass
http.server.HTTPServer(("0.0.0.0",8090),H).serve_forever()' >/dev/null
wait_for db docker exec "$db" pg_isready -U knowledge -d knowledge
master="$(openssl rand -base64 32)"
docker run -d --name "$api" --network "$net" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$master" -e PLATFORM_WEBHOOKS_ALLOW_HTTP=true -e PLATFORM_WEBHOOKS_ALLOW_PRIVATE_ADDRESSES=true -e PLATFORM_WEBHOOKS_ENQUEUE_DELAY_MS=250 -e PLATFORM_WEBHOOKS_DELIVERY_DELAY_MS=250 -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null
port="$(docker port "$api" 8080/tcp|sed -n 's/.*://p'|head -1)";url="http://127.0.0.1:$port";wait_for api curl -fsS "$url/actuator/health"

cookie="$tmp/admin-c";[[ "$(curl -sS -o "$tmp/setup" -w '%{http_code}' -c "$cookie" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Open Platform Workspace"}' "$url/api/v1/setup/initialize")" == 201 ]];actor="$(val userId < "$tmp/setup")";ws="$(val workspaceId < "$tmp/setup")";csrf="$(curl -fsS -b "$cookie" "$url/api/v1/auth/csrf")";ch="$(printf %s "$csrf"|val headerName)";cp="$(printf %s "$csrf"|val parameterName)";ct="$(printf %s "$csrf"|val token)"
[[ "$(post "$cookie" "$ch" "$ct" /api/v1/knowledge-bases/create "{\"workspaceId\":\"$ws\",\"name\":\"API Knowledge\",\"slug\":\"api-knowledge\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$ws\",\"visibility\":\"PRIVATE\",\"publishMode\":\"MANUAL\"}" "$tmp/kb")" == 201 ]];kb="$(val id < "$tmp/kb")"

all_scopes='["workspaces:read","users:read","teams:read","knowledge-bases:read","documents:read","documents:write","catalog:read","search:read","webhooks:read","webhooks:write","offline_access"]'
[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/api-keys/create "{\"workspaceId\":\"$ws\",\"name\":\"Automation\",\"scopes\":$all_scopes}" "$tmp/key")" == 201 ]];key_id="$(val id < "$tmp/key")";api_key="$(val secret < "$tmp/key")";[[ "$api_key" == kp_live_* ]]
[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/api-keys/list "{\"workspaceId\":\"$ws\"}" "$tmp/keys")" == 200 ]];python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d)==1 and d[0]["secret"] is None' < "$tmp/keys"
bad_status="$(curl -sS -o "$tmp/bad-key" -w '%{http_code}' -H 'X-API-Key: kp_live_invalid_invalid' "$url/api/v2/workspaces")";if [[ "$bad_status" != 401 ]];then echo "unexpected invalid-key status: $bad_status";cat "$tmp/bad-key";false;fi
workspace_status="$(curl -sS -o "$tmp/workspaces" -w '%{http_code}' -H "X-API-Key: $api_key" "$url/api/v2/workspaces")";if [[ "$workspace_status" != 200 ]];then echo "unexpected workspace status: $workspace_status";cat "$tmp/workspaces";docker logs "$api" 2>&1|tail -80;false;fi;python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d)==1' < "$tmp/workspaces"
underscore_key='kp_live_ab_cdEFghIJK_known_secret_material';underscore_hash="$(printf %s "$underscore_key"|sha256sum|awk '{print $1}')"
docker exec "$db" psql -U knowledge -d knowledge -v ON_ERROR_STOP=1 -c "insert into api_keys(id,workspace_id,user_id,name,key_prefix,secret_hash,scopes,created_at) values(gen_random_uuid(),'$ws'::uuid,'$actor'::uuid,'Legacy underscore prefix','ab_cdEFghIJK',decode('$underscore_hash','hex'),array['workspaces:read'],now());" >/dev/null
[[ "$(curl -sS -o "$tmp/underscore-key-workspaces" -w '%{http_code}' -H "X-API-Key: $underscore_key" "$url/api/v2/workspaces")" == 200 ]]
create="{\"knowledgeBaseId\":\"$kb\",\"title\":\"External API document\",\"path\":\"external-api-document\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"Open API searchable body\"}]}}"
[[ "$(curl -sS -o "$tmp/document" -w '%{http_code}' -H "X-API-Key: $api_key" -H 'Idempotency-Key: create-document-001' -H 'Content-Type: application/json' --data-binary "$create" "$url/api/v2/documents")" == 201 ]];page="$(val id < "$tmp/document")"
[[ "$(curl -sS -o "$tmp/document-replay" -w '%{http_code}' -H "X-API-Key: $api_key" -H 'Idempotency-Key: create-document-001' -H 'Content-Type: application/json' --data-binary "$create" "$url/api/v2/documents")" == 201 ]];[[ "$(val id < "$tmp/document-replay")" == "$page" ]]
changed="${create/External API document/Different title}";[[ "$(curl -sS -o "$tmp/idempotency-conflict" -w '%{http_code}' -H "X-API-Key: $api_key" -H 'Idempotency-Key: create-document-001' -H 'Content-Type: application/json' --data-binary "$changed" "$url/api/v2/documents")" == 409 ]]
[[ "$(curl -sS -o "$tmp/search" -w '%{http_code}' -H "Authorization: Bearer $api_key" "$url/api/v2/search?workspaceId=$ws&q=searchable&limit=10")" == 200 ]];grep -q 'External API document' "$tmp/search"

[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/api-keys/create "{\"workspaceId\":\"$ws\",\"name\":\"Read only\",\"scopes\":[\"documents:read\"]}" "$tmp/read-key")" == 201 ]];read_key="$(val secret < "$tmp/read-key")";[[ "$(curl -sS -o "$tmp/scope-denied" -w '%{http_code}' -H "X-API-Key: $read_key" -H 'Idempotency-Key: denied-create-001' -H 'Content-Type: application/json' --data-binary "$create" "$url/api/v2/documents")" == 403 ]];grep -q API_SCOPE_DENIED "$tmp/scope-denied"

initialize='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}'
[[ "$(curl -sS -o "$tmp/mcp-init" -w '%{http_code}' -H "Authorization: Bearer $api_key" -H 'Content-Type: application/json' --data-binary "$initialize" "$url/mcp")" == 200 ]];grep -q knowledge-platform "$tmp/mcp-init"
mcp_call="{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"get_document\",\"arguments\":{\"pageId\":\"$page\"}}}";[[ "$(curl -sS -o "$tmp/mcp-call" -w '%{http_code}' -H "X-API-Key: $api_key" -H 'Content-Type: application/json' --data-binary "$mcp_call" "$url/mcp")" == 200 ]];grep -q 'External API document' "$tmp/mcp-call"

oauth_scopes='["workspaces:read","knowledge-bases:read","documents:read","offline_access"]';[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/oauth-clients/create "{\"workspaceId\":\"$ws\",\"name\":\"PKCE Client\",\"redirectUris\":[\"http://localhost/callback\"],\"scopes\":$oauth_scopes,\"publicClient\":true}" "$tmp/client")" == 201 ]];client_id="$(val clientId < "$tmp/client")"
verifier='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~PKCE';challenge="$(python3 -c 'import base64,hashlib,sys;print(base64.urlsafe_b64encode(hashlib.sha256(sys.argv[1].encode()).digest()).rstrip(b"=").decode())' "$verifier")"
auth_body="{\"clientId\":\"$client_id\",\"redirectUri\":\"http://localhost/callback\",\"scope\":\"workspaces:read knowledge-bases:read documents:read offline_access\",\"state\":\"e2e-state\",\"codeChallenge\":\"$challenge\",\"codeChallengeMethod\":\"S256\",\"consent\":true}"
authorize_query="client_id=$client_id&redirect_uri=http%3A%2F%2Flocalhost%2Fcallback&scope=workspaces%3Aread%20knowledge-bases%3Aread%20documents%3Aread%20offline_access&state=e2e-state&code_challenge=$challenge&code_challenge_method=S256";[[ "$(curl -sS -D "$tmp/consent-redirect" -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Accept: text/html' "$url/oauth/authorize?$authorize_query")" == 302 ]];grep -qi '^location: /oauth/consent?' "$tmp/consent-redirect"
[[ "$(curl -sS -D "$tmp/auth-headers" -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode client_id="$client_id" --data-urlencode redirect_uri=http://localhost/callback --data-urlencode 'scope=workspaces:read knowledge-bases:read documents:read offline_access' --data-urlencode state=e2e-state --data-urlencode code_challenge="$challenge" --data-urlencode code_challenge_method=S256 --data-urlencode consent=true --data-urlencode "$cp=$ct" "$url/oauth/authorize")" == 303 ]];location="$(sed -n 's/^[Ll]ocation: //p' "$tmp/auth-headers"|tr -d '\r'|tail -1)";code="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.parse_qs(urllib.parse.urlparse(sys.argv[1]).query)["code"][0])' "$location")"
[[ "$(curl -sS -o "$tmp/token" -w '%{http_code}' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode grant_type=authorization_code --data-urlencode client_id="$client_id" --data-urlencode code="$code" --data-urlencode redirect_uri=http://localhost/callback --data-urlencode code_verifier="$verifier" "$url/oauth/token")" == 200 ]];access="$(val access_token < "$tmp/token")";refresh="$(val refresh_token < "$tmp/token")";[[ "$access" == kp_oauth_* && "$refresh" == kp_refresh_* ]]
[[ "$(curl -sS -o "$tmp/oauth-workspaces" -w '%{http_code}' -H "Authorization: Bearer $access" "$url/api/v2/workspaces")" == 200 ]]
[[ "$(curl -sS -o "$tmp/refresh" -w '%{http_code}' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode grant_type=refresh_token --data-urlencode client_id="$client_id" --data-urlencode refresh_token="$refresh" "$url/oauth/token")" == 200 ]];new_access="$(val access_token < "$tmp/refresh")";new_refresh="$(val refresh_token < "$tmp/refresh")"
[[ "$(curl -sS -o "$tmp/reuse" -w '%{http_code}' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode grant_type=refresh_token --data-urlencode client_id="$client_id" --data-urlencode refresh_token="$refresh" "$url/oauth/token")" == 400 ]];grep -q OAUTH_REFRESH_REUSE "$tmp/reuse";[[ "$(curl -sS -o "$tmp/family-revoked" -w '%{http_code}' -H "Authorization: Bearer $new_access" "$url/api/v2/workspaces")" == 401 ]]

[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/webhooks/create "{\"workspaceId\":\"$ws\",\"name\":\"Receiver\",\"endpointUrl\":\"http://hook:8090/events\",\"events\":[\"webhook.test\",\"document.created\",\"document.published\",\"comment.created\"]}" "$tmp/webhook")" == 201 ]];webhook="$(val id < "$tmp/webhook")";hook_secret="$(val signingSecret < "$tmp/webhook")"
[[ "$(curl -sS -o "$tmp/external-hooks" -w '%{http_code}' -H "X-API-Key: $api_key" "$url/api/v2/webhooks?workspaceId=$ws")" == 200 ]];grep -q Receiver "$tmp/external-hooks"
external_hook_body="{\"workspaceId\":\"$ws\",\"name\":\"External subscription\",\"endpointUrl\":\"http://hook:8090/external\",\"events\":[\"document.updated\"]}";[[ "$(curl -sS -o "$tmp/external-hook" -w '%{http_code}' -H "X-API-Key: $api_key" -H 'Idempotency-Key: create-webhook-001' -H 'Content-Type: application/json' --data-binary "$external_hook_body" "$url/api/v2/webhooks")" == 201 ]];external_hook="$(val id < "$tmp/external-hook")";[[ "$(curl -sS -o "$tmp/external-hook-replay" -w '%{http_code}' -H "X-API-Key: $api_key" -H 'Idempotency-Key: create-webhook-001' -H 'Content-Type: application/json' --data-binary "$external_hook_body" "$url/api/v2/webhooks")" == 201 ]];[[ "$(val id < "$tmp/external-hook-replay")" == "$external_hook" ]]
docker exec "$db" psql -U knowledge -d knowledge -v ON_ERROR_STOP=1 -c "insert into audit_events(id,workspace_id,actor_id,action,resource_type,resource_id,outcome,occurred_at) select gen_random_uuid(),'$ws'::uuid,'$actor'::uuid,'noise.event','WORKSPACE','$ws'::uuid,'SUCCESS',clock_timestamp() from generate_series(1,520);" >/dev/null
event_create="{\"knowledgeBaseId\":\"$kb\",\"title\":\"Post-subscription event document\",\"path\":\"post-subscription-event\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"Webhook event body\"}]}}"
[[ "$(curl -sS -o "$tmp/event-document" -w '%{http_code}' -H "X-API-Key: $api_key" -H 'Idempotency-Key: webhook-event-document-001' -H 'Content-Type: application/json' --data-binary "$event_create" "$url/api/v2/documents")" == 201 ]];event_page="$(val id < "$tmp/event-document")"
[[ "$(post "$cookie" "$ch" "$ct" /api/v1/pages/publish "{\"pageId\":\"$event_page\",\"idempotencyKey\":\"webhook-event-publish-001\"}" "$tmp/event-publication")" == 201 ]]
[[ "$(post "$cookie" "$ch" "$ct" /api/v1/comments/create "{\"pageId\":\"$event_page\",\"anchor\":{\"kind\":\"PAGE\"},\"body\":{\"type\":\"doc\",\"content\":[]},\"plainText\":\"Webhook comment event\",\"mentionedUserIds\":[]}" "$tmp/event-comment")" == 201 ]];event_comment="$(val id < "$tmp/event-comment")"
[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/webhooks/test "{\"webhookId\":\"$webhook\"}" "$tmp/webhook-test")" == 202 ]]
delivered='';for _ in $(seq 1 40);do post "$cookie" "$ch" "$ct" /api/v1/open-platform/webhooks/deliveries "{\"webhookId\":\"$webhook\",\"limit\":20}" "$tmp/deliveries" >/dev/null;delivered="$(python3 -c 'import json,sys;d=json.load(sys.stdin);types={x["eventType"] for x in d if x["status"]=="DELIVERED"};print(next((x["id"] for x in d if x["eventType"]=="webhook.test" and x["status"]=="DELIVERED"),"") if {"webhook.test","document.created","document.published","comment.created"}<=types else "")' < "$tmp/deliveries")";[[ -n "$delivered" ]]&&break;sleep 1;done
if [[ -z "$delivered" ]];then cat "$tmp/deliveries" >&2;docker exec "$db" psql -U knowledge -d knowledge -c "select action,resource_type,resource_id,occurred_at from audit_events where workspace_id='$ws' order by occurred_at" >&2;docker logs "$api" 2>&1|tail -160 >&2;false;fi
docker logs "$hook" > "$tmp/hook-log";python3 - "$tmp/hook-log" "$hook_secret" <<'PY'
import hashlib,hmac,json,sys
rows=[json.loads(x) for x in open(sys.argv[1]) if x.strip()]
assert rows,rows
for row in rows:
 expected='v1='+hmac.new(sys.argv[2].encode(),(row['timestamp']+'.'+row['body']).encode(),hashlib.sha256).hexdigest()
 assert hmac.compare_digest(expected,row['signature']),(expected,row)
PY
python3 - "$tmp/hook-log" "$page" "$event_page" "$event_comment" <<'PY'
import json,sys
events=[json.loads(json.loads(line)['body']) for line in open(sys.argv[1]) if line.strip()]
pairs={(event['type'],event['data'].get('resourceId')) for event in events}
assert ('document.created',sys.argv[3]) in pairs,pairs
assert ('document.published',sys.argv[3]) in pairs,pairs
assert ('comment.created',sys.argv[4]) in pairs,pairs
assert ('document.created',sys.argv[2]) not in pairs,pairs
PY
[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/webhooks/test "{\"webhookId\":\"$webhook\"}" "$tmp/webhook-test-two")" == 202 ]]
for _ in $(seq 1 40); do
  delivery_count="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select count(*) from webhook_deliveries where webhook_id='$webhook' and event_type='webhook.test' and status='DELIVERED'")"
  if [[ "$delivery_count" -ge 2 ]]; then break; fi
  sleep 1
done
[[ "$delivery_count" -ge 2 ]]
delivery_total="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select count(*) from webhook_deliveries where webhook_id='$webhook'")"
delivery_page_limit="$((delivery_total-1))"
[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/webhooks/deliveries/page "{\"webhookId\":\"$webhook\",\"limit\":$delivery_page_limit,\"offset\":0}" "$tmp/delivery-page-one")" == 200 ]];delivery_next="$(val nextOffset < "$tmp/delivery-page-one")"
[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/webhooks/deliveries/page "{\"webhookId\":\"$webhook\",\"limit\":$delivery_page_limit,\"offset\":$delivery_next}" "$tmp/delivery-page-two")" == 200 ]]
docker exec "$db" psql -U knowledge -d knowledge -Atc "select id from webhook_deliveries where webhook_id='$webhook' order by id" > "$tmp/delivery-ids"
python3 - "$tmp/delivery-page-one" "$tmp/delivery-page-two" "$tmp/delivery-ids" "$delivery_total" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2])); expected={line.strip() for line in open(sys.argv[3]) if line.strip()}; total=int(sys.argv[4])
assert len(one['items'])==total-1 and one['hasMore'] is True and one['nextOffset']==total-1,one
assert len(two['items'])==1 and two['hasMore'] is False and two['nextOffset']==total,two
actual={item['id'] for item in one['items']+two['items']}
assert actual==expected and len(actual)==total,(actual,expected)
PY
before="$(wc -l < "$tmp/hook-log")";[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/webhooks/replay "{\"webhookId\":\"$webhook\",\"deliveryId\":\"$delivered\"}" "$tmp/replay")" == 204 ]];for _ in $(seq 1 20);do after="$(docker logs "$hook" 2>&1|wc -l)";[[ "$after" -gt "$before" ]]&&break;sleep 1;done;[[ "$after" -gt "$before" ]]

[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/webhooks/create "{\"workspaceId\":\"$ws\",\"name\":\"Failing hook\",\"endpointUrl\":\"http://hook:9999/fail\",\"events\":[\"webhook.test\"]}" "$tmp/failing")" == 201 ]];failing="$(val id < "$tmp/failing")";[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/webhooks/test "{\"webhookId\":\"$failing\"}" "$tmp/failing-test")" == 202 ]]
for _ in $(seq 1 12);do sleep 1;docker exec "$db" psql -U knowledge -d knowledge -c "update webhook_deliveries set next_attempt_at=now() where webhook_id='$failing' and status='RETRYING'" >/dev/null;state="$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select coalesce(max(status),'') from webhook_deliveries where webhook_id='$failing' and event_type='webhook.test'")";[[ "$state" == DEAD ]]&&break;done;[[ "$state" == DEAD ]];[[ "$(docker exec "$db" psql -U knowledge -d knowledge -Atc "select suspended_at is not null from webhook_subscriptions where id='$failing'")" == t ]]

[[ "$(post "$cookie" "$ch" "$ct" /api/v1/open-platform/api-keys/revoke "{\"workspaceId\":\"$ws\",\"id\":\"$key_id\"}" "$tmp/revoke-key")" == 204 ]];[[ "$(curl -sS -o "$tmp/revoked-key" -w '%{http_code}' -H "X-API-Key: $api_key" "$url/api/v2/workspaces")" == 401 ]]
echo OPEN_PLATFORM_E2E_COUNTS;docker exec "$db" psql -U knowledge -d knowledge -Atc "select (select count(*) from api_keys),(select count(*) from oauth_clients),(select count(*) from oauth_access_tokens),(select count(*) from webhook_subscriptions),(select count(*) from webhook_deliveries where status='DELIVERED'),(select count(*) from webhook_deliveries where status='DEAD'),(select count(*) from pages)";echo OPEN_PLATFORM_E2E_SUCCESS
