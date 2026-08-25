#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Auth E2E failed at line $LINENO" >&2' ERR

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_jar="${API_JAR:-$project_root/backend/app-api/build/libs/knowledge-platform-api.jar}"
worker_jar="${WORKER_JAR:-$project_root/backend/app-worker/build/libs/knowledge-platform-worker.jar}"

if [[ ! -f "$api_jar" || ! -f "$worker_jar" ]]; then
  echo "Build the API and worker jars before running this script." >&2
  exit 1
fi

suffix="kp-auth-e2e-$(date +%s)-$$"
network="$suffix-net"
database="$suffix-db"
mailpit="$suffix-mailpit"
api="$suffix-api"
worker="$suffix-worker"
scratch="$(mktemp -d /tmp/kp-auth-e2e.XXXXXX)"

cleanup() {
  docker rm -f "$worker" "$api" "$mailpit" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  case "$scratch" in
    /tmp/kp-auth-e2e.*) rm -rf -- "$scratch" ;;
  esac
}
trap cleanup EXIT

wait_for() {
  local description="$1"
  shift
  for _ in $(seq 1 90); do
    if "$@"; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $description" >&2
  return 1
}

http_code() {
  local output_file="$1"
  shift
  curl -sS -o "$output_file" -w "%{http_code}" "$@"
}

json_value() {
  local field="$1"
  python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$field"
}

mail_count() {
  curl -fsS "$mailpit_url/api/v1/messages" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["total"])'
}

mail_at_least() {
  local expected="$1"
  [[ "$(mail_count)" -ge "$expected" ]]
}

latest_mail_code() {
  local message_id
  message_id="$(
    curl -fsS "$mailpit_url/api/v1/messages" |
      python3 -c 'import json,sys; print(json.load(sys.stdin)["messages"][0]["ID"])'
  )"
  curl -fsS "$mailpit_url/api/v1/message/$message_id" |
    python3 -c 'import json,re,sys
message=json.load(sys.stdin)
text=(message.get("Text") or "")+" "+(message.get("HTML") or "")
codes=re.findall(r"(?<![0-9])[0-9]{6}(?![0-9])", text)
if not codes:
    raise SystemExit("No six-digit code found in latest message")
print(codes[0])'
}

latest_invitation_token() {
  local message_id
  message_id="$(curl -fsS "$mailpit_url/api/v1/messages" | python3 -c 'import json,sys; print(json.load(sys.stdin)["messages"][0]["ID"])')"
  curl -fsS "$mailpit_url/api/v1/message/$message_id" |
    python3 -c 'import json,re,sys
message=json.load(sys.stdin)
text=(message.get("Text") or "")+" "+(message.get("HTML") or "")
tokens=re.findall(r"[?&]token=([A-Za-z0-9_-]{32,256})", text)
if not tokens: raise SystemExit("No invitation token found")
print(tokens[0])'
}

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias database -e POSTGRES_DB=knowledge -e POSTGRES_USER=knowledge -e POSTGRES_PASSWORD=knowledge postgres:17.6-alpine >/dev/null

docker run -d --name "$mailpit" --network "$network" --network-alias mailpit -p 127.0.0.1::8025 axllent/mailpit:v1.30.4 >/dev/null

wait_for "PostgreSQL" docker exec "$database" pg_isready -U knowledge -d knowledge

settings_master_key="$(openssl rand -base64 32)"
docker run -d --name "$api" --network "$network" -p 127.0.0.1::8080 --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SESSION_COOKIE_SECURE=false -e SETTINGS_MASTER_KEY="$settings_master_key" -e PUBLIC_BASE_URL=http://knowledge.test -v "$api_jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null

api_port="$(docker port "$api" 8080/tcp | sed -n 's/.*://p' | head -1)"
mailpit_port="$(docker port "$mailpit" 8025/tcp | sed -n 's/.*://p' | head -1)"
api_url="http://127.0.0.1:$api_port"
mailpit_url="http://127.0.0.1:$mailpit_port"

wait_for "API health" curl -fsS "$api_url/actuator/health"
wait_for "Mailpit API" curl -fsS "$mailpit_url/api/v1/info"

admin_cookie="$scratch/admin.cookies"
setup_code="$(
  http_code "$scratch/setup.json" -c "$admin_cookie" -H "Content-Type: application/json" --data-binary '{
      "email":"admin@example.com",
      "password":"Admin-Password-2026!",
      "passwordConfirmation":"Admin-Password-2026!",
      "workspaceName":"Primary Workspace"
    }' "$api_url/api/v1/setup/initialize"
)"
[[ "$setup_code" == "201" ]]
workspace_id="$(json_value workspaceId < "$scratch/setup.json")"

csrf_json="$(curl -fsS -b "$admin_cookie" "$api_url/api/v1/auth/csrf")"
csrf_header="$(printf "%s" "$csrf_json" | json_value headerName)"
csrf_token="$(printf "%s" "$csrf_json" | json_value token)"

curl -fsS -b "$admin_cookie" "$api_url/api/v1/workspaces" > "$scratch/admin-workspaces.json"
personal_workspace_id="$(python3 -c 'import json,sys
values=json.load(open(sys.argv[1]))
assert len(values)==2, values
organizations=[value for value in values if value["workspaceType"]=="ORGANIZATION"]
personal=[value for value in values if value["workspaceType"]=="PERSONAL"]
assert len(organizations)==1 and organizations[0]["id"]==sys.argv[2], values
assert organizations[0]["name"]=="Primary Workspace" and organizations[0]["membershipRole"]=="OWNER", organizations[0]
assert len(personal)==1, values
assert personal[0]["name"]=="我的空间" and personal[0]["membershipRole"]=="OWNER", personal[0]
print(personal[0]["id"])' "$scratch/admin-workspaces.json" "$workspace_id")"

personal_invitation_status="$(
  http_code "$scratch/personal-invitation.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" --data-binary "{
      \"workspaceId\":\"$personal_workspace_id\",
      \"email\":\"must-not-be-invited@example.com\",
      \"workspaceRole\":\"MEMBER\",
      \"expiresInHours\":168
    }" "$api_url/api/v1/admin/invitations/create"
)"
[[ "$personal_invitation_status" == "409" ]]
[[ "$(json_value code < "$scratch/personal-invitation.json")" == "PERSONAL_WORKSPACE_INVITATIONS_DISABLED" ]]

personal_team_status="$(
  http_code "$scratch/personal-team.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" --data-binary "{
      \"workspaceId\":\"$personal_workspace_id\",
      \"name\":\"Invalid Personal Team\",
      \"slug\":\"invalid-personal-team\",
      \"description\":null,
      \"avatar\":null,
      \"visibility\":\"PRIVATE\"
    }" "$api_url/api/v1/teams/create"
)"
[[ "$personal_team_status" == "409" ]]
[[ "$(json_value code < "$scratch/personal-team.json")" == "PERSONAL_WORKSPACE_TEAMS_DISABLED" ]]

smtp_update_code="$(
  http_code "$scratch/smtp-update.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" --data-binary '{
      "host":"mailpit",
      "port":1025,
      "security":"NONE",
      "username":null,
      "password":null,
      "clearPassword":false,
      "fromName":"Knowledge Platform",
      "fromAddress":"noreply@example.com",
      "replyTo":null,
      "enabled":true
    }' "$api_url/api/v1/admin/smtp/update"
)"
[[ "$smtp_update_code" == "200" ]]

docker run -d --name "$worker" --network "$network" --entrypoint java -e DATABASE_URL=jdbc:postgresql://database:5432/knowledge -e DATABASE_USER=knowledge -e DATABASE_PASSWORD=knowledge -e SETTINGS_MASTER_KEY="$settings_master_key" -e PUBLIC_BASE_URL=http://knowledge.test -e WORKER_ID="$suffix-worker" -e WORKER_POLL_DELAY=100ms -v "$worker_jar:/app.jar:ro" gradle:9.7.0-jdk25 -jar /app.jar >/dev/null

sleep 5
if [[ "$(docker inspect -f '{{.State.Running}}' "$worker")" != "true" ]]; then
  docker logs "$worker"
  exit 1
fi

smtp_test_code="$(
  http_code "$scratch/smtp-test.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" --data-binary '{"recipient":"admin@example.com"}' "$api_url/api/v1/admin/smtp/test"
)"
[[ "$smtp_test_code" == "202" ]]

smtp_ready() {
  curl -fsS -b "$admin_cookie" "$api_url/api/v1/admin/smtp" |
    python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin)["ready"] else 1)'
}
if ! wait_for "SMTP readiness" smtp_ready; then
  docker logs "$worker"
  exit 1
fi
wait_for "SMTP test message" mail_at_least 1

auth_settings_code="$(
  http_code "$scratch/auth-settings.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" --data-binary '{
      "registrationMode":"PUBLIC",
      "passwordLoginEnabled":true,
      "emailCodeLoginEnabled":true
    }' "$api_url/api/v1/admin/auth-settings/registration"
)"
[[ "$auth_settings_code" == "200" ]]

registration_status="$(
  curl -fsS "$api_url/api/v1/auth/registration-status"
)"
printf "%s" "$registration_status" |
  python3 -c 'import json,sys
s=json.load(sys.stdin)
assert s["publicRegistrationEnabled"] is True
assert s["emailVerificationRequired"] is True
assert s["passwordLoginEnabled"] is True
assert s["emailCodeLoginAvailable"] is True'

registration_start_code="$(
  http_code "$scratch/registration-start.json" -H "Content-Type: application/json" --data-binary '{
      "email":"public-user@example.com",
      "password":"Public-Password-2026!",
      "passwordConfirmation":"Public-Password-2026!"
    }' "$api_url/api/v1/auth/register/start"
)"
[[ "$registration_start_code" == "202" ]]
challenge_id="$(json_value challengeId < "$scratch/registration-start.json")"
wait_for "registration email" mail_at_least 2
registration_code="$(latest_mail_code)"

public_cookie="$scratch/public.cookies"
registration_verify_code="$(
  http_code "$scratch/registration-verify.json" -c "$public_cookie" -H "Content-Type: application/json" --data-binary "{
      \"challengeId\":\"$challenge_id\",
      \"code\":\"$registration_code\"
    }" "$api_url/api/v1/auth/register/verify"
)"
[[ "$registration_verify_code" == "200" ]]

password_login_code="$(
  http_code "$scratch/password-login.json" -c "$scratch/password.cookies" -H "Content-Type: application/json" --data-binary '{
      "email":"public-user@example.com",
      "password":"Public-Password-2026!"
    }' "$api_url/api/v1/auth/login/password"
)"
[[ "$password_login_code" == "204" ]]

email_code_request_status="$(
  http_code "$scratch/email-code-request.json" -H "Content-Type: application/json" --data-binary '{"email":"public-user@example.com"}' "$api_url/api/v1/auth/login/email-code/request"
)"
[[ "$email_code_request_status" == "202" ]]
wait_for "passwordless email" mail_at_least 3
passwordless_code="$(latest_mail_code)"

passwordless_verify_status="$(
  http_code "$scratch/email-code-verify.json" -c "$scratch/passwordless.cookies" -H "Content-Type: application/json" --data-binary "{
      \"email\":\"public-user@example.com\",
      \"code\":\"$passwordless_code\"
    }" "$api_url/api/v1/auth/login/email-code/verify"
)"
[[ "$passwordless_verify_status" == "204" ]]

missing_reset_status="$(
  http_code "$scratch/password-reset-missing.json" -H "Content-Type: application/json" \
    --data-binary '{"email":"missing-user@example.com"}' \
    "$api_url/api/v1/auth/password-reset/request"
)"
[[ "$missing_reset_status" == "202" ]]
[[ "$(mail_count)" == "3" ]]

reset_request_status="$(
  http_code "$scratch/password-reset-request.json" -H "Content-Type: application/json" \
    --data-binary '{"email":"public-user@example.com"}' \
    "$api_url/api/v1/auth/password-reset/request"
)"
[[ "$reset_request_status" == "202" ]]
reset_challenge_id="$(json_value challengeId < "$scratch/password-reset-request.json")"
wait_for "password reset email" mail_at_least 4
reset_code="$(latest_mail_code)"

reset_complete_status="$(
  http_code "$scratch/password-reset-complete.json" -H "Content-Type: application/json" --data-binary "{
      \"challengeId\":\"$reset_challenge_id\",
      \"code\":\"$reset_code\",
      \"password\":\"Changed-Password-2026!\",
      \"passwordConfirmation\":\"Changed-Password-2026!\"
    }" "$api_url/api/v1/auth/password-reset/complete"
)"
[[ "$reset_complete_status" == "204" ]]

reset_revoked_session_status="$(
  http_code "$scratch/reset-revoked-session.json" -b "$public_cookie" "$api_url/api/v1/auth/me"
)"
[[ "$reset_revoked_session_status" == "401" ]]

old_password_status="$(
  http_code "$scratch/old-password-login.json" -H "Content-Type: application/json" --data-binary '{
      "email":"public-user@example.com",
      "password":"Public-Password-2026!"
    }' "$api_url/api/v1/auth/login/password"
)"
[[ "$old_password_status" == "401" ]]

new_password_status="$(
  http_code "$scratch/new-password-login.json" -c "$scratch/new-password.cookies" -H "Content-Type: application/json" --data-binary '{
      "email":"public-user@example.com",
      "password":"Changed-Password-2026!"
    }' "$api_url/api/v1/auth/login/password"
)"
[[ "$new_password_status" == "204" ]]

new_password_csrf_json="$(curl -fsS -b "$scratch/new-password.cookies" "$api_url/api/v1/auth/csrf")"
new_password_csrf_header="$(printf "%s" "$new_password_csrf_json" | json_value headerName)"
new_password_csrf_token="$(printf "%s" "$new_password_csrf_json" | json_value token)"

curl -fsS -b "$scratch/new-password.cookies" "$api_url/api/v1/account" |
  python3 -c 'import json,sys
value=json.load(sys.stdin)
assert value["email"]=="public-user@example.com"
assert value["displayName"] is None
assert value["emailVerifiedAt"]'

profile_update_status="$(
  http_code "$scratch/account-profile.json" -b "$scratch/new-password.cookies" \
    -H "$new_password_csrf_header: $new_password_csrf_token" -H "Content-Type: application/json" \
    --data-binary '{"displayName":"Public Writer"}' "$api_url/api/v1/account/profile"
)"
[[ "$profile_update_status" == "200" ]]
[[ "$(json_value displayName < "$scratch/account-profile.json")" == "Public Writer" ]]
curl -fsS -b "$scratch/new-password.cookies" "$api_url/api/v1/auth/me" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)["displayName"]=="Public Writer"'

account_password_status="$(
  http_code "$scratch/account-password.json" -b "$scratch/new-password.cookies" \
    -H "$new_password_csrf_header: $new_password_csrf_token" -H "Content-Type: application/json" --data-binary '{
      "currentPassword":"Changed-Password-2026!",
      "newPassword":"Final-Password-2026!",
      "passwordConfirmation":"Final-Password-2026!"
    }' "$api_url/api/v1/account/password"
)"
[[ "$account_password_status" == "204" ]]

changed_password_status="$(
  http_code "$scratch/changed-password-login.json" -H "Content-Type: application/json" --data-binary '{
      "email":"public-user@example.com",
      "password":"Changed-Password-2026!"
    }' "$api_url/api/v1/auth/login/password"
)"
[[ "$changed_password_status" == "401" ]]
final_password_status="$(
  http_code "$scratch/final-password-login.json" -c "$scratch/final-password.cookies" -H "Content-Type: application/json" --data-binary '{
      "email":"public-user@example.com",
      "password":"Final-Password-2026!"
    }' "$api_url/api/v1/auth/login/password"
)"
[[ "$final_password_status" == "204" ]]

final_password_csrf_json="$(curl -fsS -b "$scratch/final-password.cookies" "$api_url/api/v1/auth/csrf")"
final_password_csrf_header="$(printf "%s" "$final_password_csrf_json" | json_value headerName)"
final_password_csrf_token="$(printf "%s" "$final_password_csrf_json" | json_value token)"

secondary_login_status="$(
  http_code "$scratch/secondary-login.json" -c "$scratch/secondary.cookies" \
    -H "User-Agent: E2E-Secondary-Browser/1.0" -H "Content-Type: application/json" --data-binary '{
      "email":"public-user@example.com",
      "password":"Final-Password-2026!"
    }' "$api_url/api/v1/auth/login/password"
)"
[[ "$secondary_login_status" == "204" ]]

curl -fsS -b "$scratch/final-password.cookies" "$api_url/api/v1/account/sessions" > "$scratch/account-sessions.json"
secondary_session_id="$(python3 -c 'import json,sys
sessions=json.load(open(sys.argv[1]))
assert len(sessions)==3
assert sum(1 for session in sessions if session["current"])==1
other=[session for session in sessions if not session["current"]]
assert other[0]["userAgent"]=="E2E-Secondary-Browser/1.0"
print(other[0]["id"])' "$scratch/account-sessions.json")"

revoke_secondary_status="$(
  http_code "$scratch/revoke-secondary.json" -b "$scratch/final-password.cookies" \
    -H "$final_password_csrf_header: $final_password_csrf_token" -H "Content-Type: application/json" \
    --data-binary '{}' "$api_url/api/v1/account/sessions/$secondary_session_id/revoke"
)"
[[ "$revoke_secondary_status" == "204" ]]
secondary_me_status="$(
  http_code "$scratch/secondary-me.json" -b "$scratch/secondary.cookies" \
    -H "User-Agent: E2E-Secondary-Browser/1.0" "$api_url/api/v1/auth/me"
)"
[[ "$secondary_me_status" == "401" ]]
curl -fsS -b "$scratch/final-password.cookies" "$api_url/api/v1/account/sessions" |
  python3 -c 'import json,sys
sessions=json.load(sys.stdin)
assert len(sessions)==2
assert sum(1 for session in sessions if session["current"])==1'

revoke_others_status="$(
  http_code "$scratch/revoke-others.json" -b "$scratch/final-password.cookies" \
    -H "$final_password_csrf_header: $final_password_csrf_token" -H "Content-Type: application/json" \
    --data-binary '{}' "$api_url/api/v1/account/sessions/revoke-others"
)"
[[ "$revoke_others_status" == "204" ]]
previous_current_status="$(
  http_code "$scratch/previous-current.json" -b "$scratch/new-password.cookies" \
    "$api_url/api/v1/auth/me"
)"
[[ "$previous_current_status" == "401" ]]
curl -fsS -b "$scratch/final-password.cookies" "$api_url/api/v1/account/sessions" |
  python3 -c 'import json,sys
sessions=json.load(sys.stdin)
assert len(sessions)==1
assert sessions[0]["current"] is True'

invitation_team_status="$(
  http_code "$scratch/invitation-team.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{
      \"workspaceId\":\"$workspace_id\",
      \"name\":\"Invited Product Team\",
      \"slug\":\"invited-product-team\",
      \"description\":null,
      \"avatar\":null,
      \"visibility\":\"PRIVATE\"
    }" "$api_url/api/v1/teams/create"
)"
[[ "$invitation_team_status" == "201" ]]
invitation_team_id="$(json_value id < "$scratch/invitation-team.json")"

invitation_kb_status="$(
  http_code "$scratch/invitation-kb.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{
      \"workspaceId\":\"$workspace_id\",
      \"name\":\"Invited Product Handbook\",
      \"slug\":\"invited-product-handbook\",
      \"ownerType\":\"WORKSPACE\",
      \"ownerId\":\"$workspace_id\",
      \"visibility\":\"PRIVATE\",
      \"publishMode\":\"MANUAL\"
    }" "$api_url/api/v1/knowledge-bases/create"
)"
[[ "$invitation_kb_status" == "201" ]]
invitation_kb_id="$(json_value id < "$scratch/invitation-kb.json")"

invalid_target_invitation_status="$(
  http_code "$scratch/invalid-target-invitation.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{
      \"workspaceId\":\"$workspace_id\",
      \"email\":\"invalid-target@example.com\",
      \"workspaceRole\":\"MEMBER\",
      \"targetTeamIds\":[\"00000000-0000-0000-0000-000000000001\"],
      \"targetKnowledgeBaseRoles\":[],
      \"expiresInHours\":168
    }" "$api_url/api/v1/admin/invitations/create"
)"
[[ "$invalid_target_invitation_status" == "400" ]]

invitation_create_status="$(
  http_code "$scratch/invitation-create.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" --data-binary "{
      \"workspaceId\":\"$workspace_id\",
      \"email\":\"invited-user@example.com\",
      \"workspaceRole\":\"MEMBER\",
      \"targetTeamIds\":[\"$invitation_team_id\"],
      \"targetKnowledgeBaseRoles\":[{\"knowledgeBaseId\":\"$invitation_kb_id\",\"role\":\"EDITOR\"}],
      \"expiresInHours\":168
    }" "$api_url/api/v1/admin/invitations/create"
)"
[[ "$invitation_create_status" == "202" ]]
invitation_id="$(json_value id < "$scratch/invitation-create.json")"
python3 -c 'import json,sys
value=json.load(open(sys.argv[1]))
assert value["targetTeamIds"]==[sys.argv[2]]
assert value["targetKnowledgeBaseRoles"]==[{"knowledgeBaseId":sys.argv[3],"role":"EDITOR"}]' \
  "$scratch/invitation-create.json" "$invitation_team_id" "$invitation_kb_id"
wait_for "invitation email" mail_at_least 5
old_invitation_token="$(latest_invitation_token)"
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "
  select count(*) filter (where job.payload->>'tokenHash'=invitation.token_hash),
         count(*) filter (where job.payload->>'tokenHash'<>invitation.token_hash)
  from durable_jobs job
  join invitations invitation on invitation.id::text=job.payload->>'invitationId'
  where job.job_type='invitation.send' and invitation.id='$invitation_id'")" == "1|0" ]]

invitation_resend_status="$(
  http_code "$scratch/invitation-resend.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{\"invitationId\":\"$invitation_id\"}" \
    "$api_url/api/v1/admin/invitations/resend"
)"
[[ "$invitation_resend_status" == "202" ]]
python3 -c 'import json,sys
value=json.load(open(sys.argv[1]))
assert value["status"]=="QUEUED"
assert value["sentAt"] is None' "$scratch/invitation-resend.json"
wait_for "resent invitation email" mail_at_least 6
invitation_token="$(latest_invitation_token)"
[[ "$invitation_token" != "$old_invitation_token" ]]
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "
  select count(*) filter (where job.payload->>'tokenHash'=invitation.token_hash),
         count(*) filter (where job.payload->>'tokenHash'<>invitation.token_hash)
  from durable_jobs job
  join invitations invitation on invitation.id::text=job.payload->>'invitationId'
  where job.job_type='invitation.send' and invitation.id='$invitation_id'")" == "1|1" ]]

old_invitation_status="$(
  http_code "$scratch/old-invitation-resolve.json" \
    "$api_url/api/v1/invitations/resolve?token=$old_invitation_token"
)"
[[ "$old_invitation_status" == "410" ]]

curl -fsS "$api_url/api/v1/invitations/resolve?token=$invitation_token" |
  python3 -c 'import json,sys
value=json.load(sys.stdin)
assert value["workspaceName"] == "Primary Workspace"
assert value["maskedEmail"].endswith("@example.com")
assert value["workspaceRole"] == "MEMBER"
assert value["targetTeamIds"] == [sys.argv[1]]
assert value["targetKnowledgeBaseRoles"] == [{"knowledgeBaseId":sys.argv[2],"role":"EDITOR"}]
assert value["accountExists"] is False' \
  "$invitation_team_id" "$invitation_kb_id"

invited_cookie="$scratch/invited.cookies"
invitation_accept_status="$(
  http_code "$scratch/invitation-accept.json" -c "$invited_cookie" -H "Content-Type: application/json" --data-binary "{
      \"token\":\"$invitation_token\",
      \"password\":\"Invited-Password-2026!\",
      \"passwordConfirmation\":\"Invited-Password-2026!\"
    }" "$api_url/api/v1/invitations/accept"
)"
[[ "$invitation_accept_status" == "200" ]]
curl -fsS -b "$invited_cookie" "$api_url/api/v1/auth/me" | python3 -c 'import json,sys; assert json.load(sys.stdin)["email"] == "invited-user@example.com"'
invited_user_id_for_targets="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select id from users where email_normalized='invited-user@example.com'")"
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select role from team_members where team_id='$invitation_team_id' and user_id='$invited_user_id_for_targets'")" == "MEMBER" ]]
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select role from knowledge_base_members where knowledge_base_id='$invitation_kb_id' and user_id='$invited_user_id_for_targets'")" == "EDITOR" ]]
curl -fsS -b "$invited_cookie" "$api_url/api/v1/workspaces" |
  python3 -c 'import json,sys
values=json.load(sys.stdin)
assert len(values)==2, values
organizations=[value for value in values if value["workspaceType"]=="ORGANIZATION"]
personal=[value for value in values if value["workspaceType"]=="PERSONAL"]
assert len(organizations)==1, values
assert organizations[0]["name"]=="Primary Workspace" and organizations[0]["membershipRole"]=="MEMBER", organizations[0]
assert len(personal)==1, values
assert personal[0]["name"]=="我的空间" and personal[0]["membershipRole"]=="OWNER", personal[0]'

invited_csrf_json="$(curl -fsS -b "$invited_cookie" "$api_url/api/v1/auth/csrf")"
invited_csrf_header="$(printf "%s" "$invited_csrf_json" | json_value headerName)"
invited_csrf_token="$(printf "%s" "$invited_csrf_json" | json_value token)"
logout_status="$(http_code "$scratch/logout.json" -b "$invited_cookie" -H "$invited_csrf_header: $invited_csrf_token" -H "Content-Type: application/json" --data-binary '{}' "$api_url/api/v1/auth/logout")"
[[ "$logout_status" == "204" ]]
logged_out_me_status="$(http_code "$scratch/logged-out-me.json" -b "$invited_cookie" "$api_url/api/v1/auth/me")"
[[ "$logged_out_me_status" == "401" ]]

curl -fsS -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" --data-binary "{\"workspaceId\":\"$workspace_id\",\"limit\":100}" "$api_url/api/v1/admin/invitations/list" |
  python3 -c 'import json,sys
values=json.load(sys.stdin)
assert len(values) == 1
assert values[0]["id"] == sys.argv[1]
assert values[0]["targetTeamIds"] == [sys.argv[2]]
assert values[0]["targetKnowledgeBaseRoles"] == [{"knowledgeBaseId":sys.argv[3],"role":"EDITOR"}]
assert values[0]["status"] == "ACCEPTED"' "$invitation_id" "$invitation_team_id" "$invitation_kb_id"

curl -fsS -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" \
  --data-binary '{"query":"public-user","status":"ALL","limit":100}' \
  "$api_url/api/v1/admin/users/list" > "$scratch/admin-users.json"
public_user_id="$(python3 -c 'import json,sys
users=json.load(open(sys.argv[1]))
assert len(users)==1
user=users[0]
assert user["email"]=="public-user@example.com"
assert user["status"]=="ACTIVE"
assert user["instanceRole"]=="USER"
assert user["workspaceCount"]==1
print(user["userId"])' "$scratch/admin-users.json")"

grant_admin_status="$(
  http_code "$scratch/grant-admin.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{\"userId\":\"$public_user_id\",\"administrator\":true}" \
    "$api_url/api/v1/admin/users/administrator"
)"
[[ "$grant_admin_status" == "200" ]]
[[ "$(json_value instanceRole < "$scratch/grant-admin.json")" == "ADMIN" ]]
granted_old_session_status="$(http_code "$scratch/granted-old-session.json" -b "$scratch/final-password.cookies" "$api_url/api/v1/auth/me")"
[[ "$granted_old_session_status" == "401" ]]

admin_role_cookie="$scratch/admin-role.cookies"
admin_role_login_status="$(http_code "$scratch/admin-role-login.json" -c "$admin_role_cookie" \
  -H "Content-Type: application/json" --data-binary '{"email":"public-user@example.com","password":"Final-Password-2026!"}' \
  "$api_url/api/v1/auth/login/password")"
[[ "$admin_role_login_status" == "204" ]]
curl -fsS -b "$admin_role_cookie" "$api_url/api/v1/auth/me" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)["instanceAdmin"] is True'

revoke_admin_status="$(
  http_code "$scratch/revoke-admin.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{\"userId\":\"$public_user_id\",\"administrator\":false}" \
    "$api_url/api/v1/admin/users/administrator"
)"
[[ "$revoke_admin_status" == "200" ]]
[[ "$(json_value instanceRole < "$scratch/revoke-admin.json")" == "USER" ]]
revoked_admin_session_status="$(http_code "$scratch/revoked-admin-session.json" -b "$admin_role_cookie" "$api_url/api/v1/auth/me")"
[[ "$revoked_admin_session_status" == "401" ]]

invited_user_id="$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select id from users where email_normalized='invited-user@example.com'")"
suspend_user_status="$(
  http_code "$scratch/suspend-user.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{\"userId\":\"$invited_user_id\",\"status\":\"SUSPENDED\"}" \
    "$api_url/api/v1/admin/users/status"
)"
[[ "$suspend_user_status" == "200" ]]
suspended_login_status="$(http_code "$scratch/suspended-login.json" -H "Content-Type: application/json" \
  --data-binary '{"email":"invited-user@example.com","password":"Invited-Password-2026!"}' \
  "$api_url/api/v1/auth/login/password")"
[[ "$suspended_login_status" == "401" ]]

activate_user_status="$(
  http_code "$scratch/activate-user.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{\"userId\":\"$invited_user_id\",\"status\":\"ACTIVE\"}" \
    "$api_url/api/v1/admin/users/status"
)"
[[ "$activate_user_status" == "200" ]]
reactivated_login_status="$(http_code "$scratch/reactivated-login.json" -c "$scratch/reactivated.cookies" \
  -H "Content-Type: application/json" --data-binary '{"email":"invited-user@example.com","password":"Invited-Password-2026!"}' \
  "$api_url/api/v1/auth/login/password")"
[[ "$reactivated_login_status" == "204" ]]

existing_invitation_status="$(
  http_code "$scratch/existing-invitation.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{
      \"workspaceId\":\"$workspace_id\",
      \"email\":\"public-user@example.com\",
      \"workspaceRole\":\"MEMBER\",
      \"expiresInHours\":168
    }" "$api_url/api/v1/admin/invitations/create"
)"
[[ "$existing_invitation_status" == "202" ]]
existing_invitation_id="$(json_value id < "$scratch/existing-invitation.json")"
wait_for "existing-account invitation email" mail_at_least 7
existing_invitation_token="$(latest_invitation_token)"
curl -fsS "$api_url/api/v1/invitations/resolve?token=$existing_invitation_token" |
  python3 -c 'import json,sys
value=json.load(sys.stdin)
assert value["accountExists"] is True
assert value["workspaceName"]=="Primary Workspace"'
existing_accept_status="$(
  http_code "$scratch/existing-accept.json" -c "$scratch/existing-accept.cookies" \
    -H "Content-Type: application/json" --data-binary "{
      \"token\":\"$existing_invitation_token\",
      \"password\":null,
      \"passwordConfirmation\":null
    }" "$api_url/api/v1/invitations/accept"
)"
[[ "$existing_accept_status" == "200" ]]
curl -fsS -b "$scratch/existing-accept.cookies" "$api_url/api/v1/auth/me" |
  python3 -c 'import json,sys; assert json.load(sys.stdin)["email"]=="public-user@example.com"'
curl -fsS -b "$scratch/existing-accept.cookies" "$api_url/api/v1/workspaces" |
  python3 -c 'import json,sys
values=json.load(sys.stdin)
assert len(values)==2
assert {value["workspaceType"] for value in values}=={"PERSONAL","ORGANIZATION"}'

curl -fsS -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" \
  --data-binary "{\"workspaceId\":\"$workspace_id\",\"limit\":1,\"offset\":0}" \
  "$api_url/api/v1/admin/invitations/page" > "$scratch/invitations-page-one.json"
invitation_next="$(json_value nextOffset < "$scratch/invitations-page-one.json")"
curl -fsS -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" \
  --data-binary "{\"workspaceId\":\"$workspace_id\",\"limit\":1,\"offset\":$invitation_next}" \
  "$api_url/api/v1/admin/invitations/page" > "$scratch/invitations-page-two.json"
python3 - "$scratch/invitations-page-one.json" "$scratch/invitations-page-two.json" "$invitation_id" "$existing_invitation_id" <<'PY'
import json,sys
one,two=json.load(open(sys.argv[1])),json.load(open(sys.argv[2])); expected={sys.argv[3],sys.argv[4]}
assert one['hasMore'] is True and one['nextOffset']==1 and len(one['items'])==1,one
assert two['hasMore'] is False and two['nextOffset']==2 and len(two['items'])==1,two
assert {one['items'][0]['id'],two['items'][0]['id']}==expected,(one,two)
PY

admin_user_id="$(curl -fsS -b "$admin_cookie" "$api_url/api/v1/auth/me" | json_value userId)"
curl -fsS -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" \
  --data-binary '{"query":"example.com","status":"ALL","limit":1,"offset":0}' \
  "$api_url/api/v1/admin/users/page" > "$scratch/users-page-one.json"
user_next_one="$(json_value nextOffset < "$scratch/users-page-one.json")"
curl -fsS -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" \
  --data-binary "{\"query\":\"example.com\",\"status\":\"ALL\",\"limit\":1,\"offset\":$user_next_one}" \
  "$api_url/api/v1/admin/users/page" > "$scratch/users-page-two.json"
user_next_two="$(json_value nextOffset < "$scratch/users-page-two.json")"
curl -fsS -b "$admin_cookie" -H "$csrf_header: $csrf_token" -H "Content-Type: application/json" \
  --data-binary "{\"query\":\"example.com\",\"status\":\"ALL\",\"limit\":1,\"offset\":$user_next_two}" \
  "$api_url/api/v1/admin/users/page" > "$scratch/users-page-three.json"
python3 - "$scratch/users-page-one.json" "$scratch/users-page-two.json" "$scratch/users-page-three.json" "$admin_user_id" "$public_user_id" "$invited_user_id" <<'PY'
import json,sys
pages=[json.load(open(path)) for path in sys.argv[1:4]]; expected=set(sys.argv[4:7])
assert [p['nextOffset'] for p in pages]==[1,2,3],pages
assert [p['hasMore'] for p in pages]==[True,True,False],pages
assert all(len(p['items'])==1 for p in pages),pages
assert {p['items'][0]['userId'] for p in pages}==expected,pages
PY

admin_user_id="$(curl -fsS -b "$admin_cookie" "$api_url/api/v1/auth/me" | json_value userId)"
owner_protection_status="$(
  http_code "$scratch/owner-protection.json" -b "$admin_cookie" -H "$csrf_header: $csrf_token" \
    -H "Content-Type: application/json" --data-binary "{\"userId\":\"$admin_user_id\",\"status\":\"SUSPENDED\"}" \
    "$api_url/api/v1/admin/users/status"
)"
[[ "$owner_protection_status" == "409" ]]

for attempt in $(seq 1 10); do
  password_failure_status="$(
    http_code "$scratch/password-rate-$attempt.json" -H "Content-Type: application/json" \
      --data-binary '{"email":"rate-limited@example.com","password":"Wrong-Password-2026!"}' \
      "$api_url/api/v1/auth/login/password"
  )"
  [[ "$password_failure_status" == "401" ]]
done
password_rate_status="$(
  http_code "$scratch/password-rate-blocked.json" -D "$scratch/password-rate-headers.txt" \
    -H "Content-Type: application/json" \
    --data-binary '{"email":"rate-limited@example.com","password":"Wrong-Password-2026!"}' \
    "$api_url/api/v1/auth/login/password"
)"
[[ "$password_rate_status" == "429" ]]
[[ "$(json_value code < "$scratch/password-rate-blocked.json")" == "PASSWORD_LOGIN_RATE_LIMITED" ]]
grep -Eqi '^Retry-After:[[:space:]]*900' "$scratch/password-rate-headers.txt"
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*) from password_login_attempts where principal_hash like '%rate-limited@example.com%' or ip_hash like '%127.0.0.1%'")" == "0" ]]
[[ "$(docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*) from password_login_attempts")" -ge "10" ]]

echo "AUTH_E2E_COUNTS"
docker exec "$database" psql -U knowledge -d knowledge -Atc "select
    (select count(*) from users),
    (select count(*) from workspaces where workspace_type = 'ORGANIZATION'),
    (select count(*) from workspaces where workspace_type = 'PERSONAL'),
    (select count(*) from email_auth_challenges where consumed_at is not null),
    (select count(*) from durable_jobs where status = 'SUCCEEDED');"

echo "AUTH_E2E_ACTIVE_SESSIONS"
docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*)
    from account_sessions where revoked_at is null;"

echo "AUTH_E2E_ADMIN_AUDIT_EVENTS"
docker exec "$database" psql -U knowledge -d knowledge -Atc "select count(*)
    from audit_events where action like 'identity.%';"

echo "AUTH_E2E_USERS"
docker exec "$database" psql -U knowledge -d knowledge -Atc "select email_normalized,email_verification_source,status
   from users
   order by email_normalized;"

echo "AUTH_E2E_SUCCESS"
