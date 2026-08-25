#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Personal workspace upgrade E2E failed at line $LINENO" >&2' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_jar="${API_JAR:-$project_root/backend/app-api/build/libs/knowledge-platform-api.jar}"
if [[ ! -f "$api_jar" ]]; then
  echo "Build the API jar before running this script." >&2
  exit 1
fi

suffix="kp-personal-upgrade-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
old_api="$suffix-old-api"
new_api="$suffix-new-api"
scratch="$(mktemp -d /tmp/kp-personal-upgrade.XXXXXX)"

cleanup() {
  docker rm -f "$new_api" "$old_api" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  case "$scratch" in
    /tmp/kp-personal-upgrade.*) rm -rf -- "$scratch" ;;
  esac
}
trap cleanup EXIT

wait_for() {
  local description="$1"
  shift
  for _ in $(seq 1 90); do
    if "$@"; then return 0; fi
    sleep 1
  done
  echo "Timed out waiting for $description" >&2
  return 1
}

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias database \
  -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge \
  postgres:17.6-alpine >/dev/null
wait_for "PostgreSQL" docker exec "$database" pg_isready -U knowledge -d knowledge

settings_master_key="$(openssl rand -base64 32)"
docker run -d --name "$old_api" --network "$network" -p 127.0.0.1::8080 --entrypoint java \
  -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge \
  -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge \
  -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$settings_master_key" \
  -e SPRING_FLYWAY_TARGET=0410 \
  -v "$api_jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null
old_port="$(docker port "$old_api" 8080/tcp | sed -n 's/.*://p' | head -1)"
old_url="http://127.0.0.1:$old_port"
wait_for "pre-upgrade API" curl -fsS "$old_url/actuator/health"

setup_code="$(curl -sS -o "$scratch/setup.json" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary '{
  "email":"owner@example.com",
  "password":"Owner-Password-2026!",
  "passwordConfirmation":"Owner-Password-2026!",
  "workspaceName":"Upgrade Organization"
}' "$old_url/api/v1/setup/initialize")"
[[ "$setup_code" == "201" ]]

admin_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select id from users where email_normalized='owner@example.com'")"
personal_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select id from workspaces where workspace_type='PERSONAL' and created_by='$admin_id'::uuid")"
legacy_user_id="00000000-0000-4000-8000-000000000042"
legacy_invitation_id="00000000-0000-4000-8000-000000000043"

docker exec -i "$database" psql -v ON_ERROR_STOP=1 -U knowledge -d knowledge <<SQL >/dev/null
INSERT INTO users (
  id, email_original, email_normalized, password_hash, status,
  email_verified_at, email_verification_source, created_at, updated_at
) VALUES (
  '$legacy_user_id'::uuid, 'legacy-member@example.com', 'legacy-member@example.com',
  'legacy-password-hash', 'ACTIVE', CURRENT_TIMESTAMP, 'INVITATION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at, updated_at)
VALUES ('$personal_id'::uuid, '$legacy_user_id'::uuid, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO invitations (
  id, workspace_id, email_original, email_normalized, token_hash,
  delivery_token_encrypted, workspace_role, status, smtp_settings_version,
  expires_at, created_by, created_at, updated_at
) VALUES (
  '$legacy_invitation_id'::uuid, '$personal_id'::uuid,
  'pending-member@example.com', 'pending-member@example.com', repeat('a', 64),
  NULL, 'MEMBER', 'SENT', 1, CURRENT_TIMESTAMP + INTERVAL '7 days',
  '$admin_id'::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
SQL

[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*) from workspace_memberships where workspace_id='$personal_id'::uuid")" == "2" ]]
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select status from invitations where id='$legacy_invitation_id'::uuid")" == "SENT" ]]

docker rm -f "$old_api" >/dev/null
docker run -d --name "$new_api" --network "$network" -p 127.0.0.1::8080 --entrypoint java \
  -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge \
  -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge \
  -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$settings_master_key" \
  -v "$api_jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null
new_port="$(docker port "$new_api" 8080/tcp | sed -n 's/.*://p' | head -1)"
new_url="http://127.0.0.1:$new_port"
wait_for "upgraded API" curl -fsS "$new_url/actuator/health"

cleanup_migration_applied="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*) from flyway_schema_history where success and version::integer=420")"
[[ "$cleanup_migration_applied" == "1" ]]

membership_result="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*), min(role), bool_and(user_id=created_by) from workspace_memberships join workspaces on workspaces.id=workspace_id where workspace_id='$personal_id'::uuid group by workspace_id")"
[[ "$membership_result" == "1|OWNER|t" ]]

invitation_result="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select status, revoked_at is not null from invitations where id='$legacy_invitation_id'::uuid")"
[[ "$invitation_result" == "REVOKED|t" ]]

echo "PERSONAL_WORKSPACE_UPGRADE_RESULT"
echo "$membership_result|$invitation_result"
echo "PERSONAL_WORKSPACE_UPGRADE_E2E_SUCCESS"
