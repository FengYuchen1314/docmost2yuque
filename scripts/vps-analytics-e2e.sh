#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Analytics E2E failed at line $LINENO" >&2' ERR

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
jar="${API_JAR:-$root/backend/app-api/build/libs/knowledge-platform-api.jar}"
[[ -f "$jar" ]]
suffix="kp-analytics-e2e-$(date +%s)-$$"
network="$suffix-net"; database="$suffix-db"; api="$suffix-api"
scratch="$(mktemp -d /tmp/kp-analytics-e2e.XXXXXX)"
cleanup(){ docker rm -f "$api" "$database" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; case "$scratch" in /tmp/kp-analytics-e2e.*) rm -rf -- "$scratch";; esac; }
trap cleanup EXIT
wait_for(){ local label="$1"; shift; for _ in $(seq 1 90); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done; echo "Timed out waiting for $label" >&2; docker logs "$api" >&2 || true; return 1; }
value(){ python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
post(){ local cookie="$1" header="$2" token="$3" path="$4" data="$5" out="$6"; curl -sS -o "$out" -w "%{http_code}" -b "$cookie" -H "$header: $token" -H 'Content-Type: application/json' --data-binary "$data" "$url$path"; }

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null
wait_for PostgreSQL docker exec "$database" pg_isready -U knowledge -d knowledge
docker run -d --name "$api" --network "$network" -p 127.0.0.1::8080 --entrypoint java \
  -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge \
  -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$(openssl rand -base64 32)" -v "$jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null
port="$(docker port "$api" 8080/tcp | sed -n 's/.*://p' | head -1)"; url="http://127.0.0.1:$port"
wait_for API curl -fsS "$url/actuator/health"

admin_cookie="$scratch/admin.cookies"
code="$(curl -sS -o "$scratch/setup.json" -w '%{http_code}' -c "$admin_cookie" -H 'Content-Type: application/json' --data-binary '{"email":"admin@example.com","password":"Admin-Password-2026!","passwordConfirmation":"Admin-Password-2026!","workspaceName":"Metric Workspace"}' "$url/api/v1/setup/initialize")"; [[ "$code" == 201 ]]
admin_id="$(value userId < "$scratch/setup.json")"; workspace_id="$(value workspaceId < "$scratch/setup.json")"
csrf="$(curl -fsS -b "$admin_cookie" "$url/api/v1/auth/csrf")"; header="$(printf %s "$csrf" | value headerName)"; token="$(printf %s "$csrf" | value token)"

code="$(post "$admin_cookie" "$header" "$token" /api/v1/knowledge-bases/create "{\"workspaceId\":\"$workspace_id\",\"name\":\"Metric KB\",\"slug\":\"metric-kb\",\"ownerType\":\"WORKSPACE\",\"ownerId\":\"$workspace_id\",\"visibility\":\"WORKSPACE\",\"publishMode\":\"MANUAL\"}" "$scratch/kb.json")"; [[ "$code" == 201 ]]
kb_id="$(value id < "$scratch/kb.json")"
code="$(post "$admin_cookie" "$header" "$token" /api/v1/pages/create "{\"knowledgeBaseId\":\"$kb_id\",\"title\":\"Metric Page\",\"path\":\"metric-page\",\"contentType\":\"DOCUMENT\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"metrics body\"}]}}" "$scratch/page.json")"; [[ "$code" == 201 ]]
page_id="$(value id < "$scratch/page.json")"

for n in 1 2; do code="$(post "$admin_cookie" "$header" "$token" /api/v1/pages/get "{\"pageId\":\"$page_id\"}" "$scratch/get-$n.json")"; [[ "$code" == 200 ]]; done
code="$(post "$admin_cookie" "$header" "$token" /api/v1/pages/update "{\"pageId\":\"$page_id\",\"expectedRevision\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"text\":\"metrics updated\"}]}}" "$scratch/update.json")"; [[ "$code" == 200 ]]
code="$(post "$admin_cookie" "$header" "$token" /api/v1/comments/create "{\"pageId\":\"$page_id\",\"anchor\":{\"kind\":\"page\"},\"body\":{\"type\":\"doc\",\"content\":[]},\"plainText\":\"metric comment\",\"mentionedUserIds\":[]}" "$scratch/comment.json")"; [[ "$code" == 201 ]]
code="$(post "$admin_cookie" "$header" "$token" /api/v1/pages/publish "{\"pageId\":\"$page_id\",\"idempotencyKey\":\"analytics-publish-v1\"}" "$scratch/pub.json")"; [[ "$code" == 201 ]]
code="$(post "$admin_cookie" "$header" "$token" /api/v1/shares/create "{\"pageId\":\"$page_id\",\"role\":\"READER\"}" "$scratch/share.json")"; [[ "$code" == 201 ]]

member_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "with u as (insert into users(id,email_original,email_normalized,password_hash,status,email_verified_at,email_verification_source,created_at,updated_at) select gen_random_uuid(),'member@example.com','member@example.com',password_hash,'ACTIVE',now(),'ADMIN',now(),now() from users where id='$admin_id' returning id), m as (insert into workspace_memberships(workspace_id,user_id,role,created_at) select '$workspace_id',id,'MEMBER',now() from u returning user_id) select user_id from m")"
member_cookie="$scratch/member.cookies"; code="$(curl -sS -o "$scratch/member-login.json" -w '%{http_code}' -c "$member_cookie" -H 'Content-Type: application/json' --data-binary '{"email":"member@example.com","password":"Admin-Password-2026!"}' "$url/api/v1/auth/login/password")"; [[ "$code" == 204 ]]
mcsrf="$(curl -fsS -b "$member_cookie" "$url/api/v1/auth/csrf")"; mheader="$(printf %s "$mcsrf" | value headerName)"; mtoken="$(printf %s "$mcsrf" | value token)"
code="$(post "$member_cookie" "$mheader" "$mtoken" /api/v1/pages/get "{\"pageId\":\"$page_id\"}" "$scratch/member-get.json")"; [[ "$code" == 200 ]]
code="$(post "$member_cookie" "$mheader" "$mtoken" /api/v1/analytics/page "{\"pageId\":\"$page_id\"}" "$scratch/member-analytics.json")"; [[ "$code" == 403 ]]

code="$(post "$admin_cookie" "$header" "$token" /api/v1/analytics/page "{\"pageId\":\"$page_id\"}" "$scratch/page-report.json")"; [[ "$code" == 200 ]]
python3 - "$scratch/page-report.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
t=d['totals']
assert t['views']==2, t
assert t['uniqueViews']==2, t
assert t['edits']==2, t
assert t['comments']==1, t
assert t['shares']==1, t
assert len(d['daily'])==1, d
assert d['daily'][0]['date'] is not None, d['daily'][0]
PY
code="$(post "$admin_cookie" "$header" "$token" /api/v1/analytics/knowledge-base "{\"knowledgeBaseId\":\"$kb_id\"}" "$scratch/kb-report.json")"; [[ "$code" == 200 ]]
python3 - "$scratch/kb-report.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); assert d['totals']['views']==2; assert d['totals']['comments']==1
PY
code="$(curl -sS -o "$scratch/report.csv" -w '%{http_code}' -b "$admin_cookie" -H "$header: $token" -H 'Content-Type: application/json' --data-binary "{\"pageId\":\"$page_id\"}" "$url/api/v1/analytics/page/export")"; [[ "$code" == 200 ]]
grep -q '^date,views,unique_views,edits,comments,shares,exports,reactions' "$scratch/report.csv"

echo ANALYTICS_E2E_COUNTS
docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*),sum(views),sum(unique_views),sum(edits),sum(comments),sum(shares) from daily_content_metrics"
echo ANALYTICS_E2E_SUCCESS
