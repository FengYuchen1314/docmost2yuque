#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
nginx_config="$root_dir/deploy/nginx.conf"
compose_config="$root_dir/deploy/docker-compose.yml"
security_config="$root_dir/backend/app-api/src/main/java/io/knowledge/platform/config/SecurityConfiguration.java"
internal_controller="$root_dir/backend/app-api/src/main/java/io/knowledge/platform/collaborationapi/InternalCollaborationController.java"

fail() {
  printf 'EDGE_TRUST_FAILURE %s\n' "$1" >&2
  exit 1
}

grep -Fq 'proxy_set_header X-Forwarded-For $remote_addr;' "$nginx_config" \
  || fail 'nginx must replace, not append, the client address forwarded to the API'
if grep -Fq 'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' "$nginx_config"; then
  fail 'nginx must not preserve an attacker-supplied X-Forwarded-For chain'
fi
grep -Fq 'server_tokens off;' "$nginx_config" || fail 'nginx version disclosure must remain disabled'
grep -Fq 'X-Content-Type-Options nosniff always' "$nginx_config" || fail 'nosniff response policy is missing'
grep -Fq 'Content-Security-Policy' "$nginx_config" || fail 'Content-Security-Policy is missing'

api_block="$(awk '/^  api:/{capture=1} /^  worker:/{capture=0} capture{print}' "$compose_config")"
if grep -Eq '^[[:space:]]+ports:' <<<"$api_block"; then
  fail 'the API service must not publish a host port'
fi
grep -Fq 'internal: true' "$compose_config" || fail 'the backend network must remain internal'
grep -Fq 'COLLAB_INTERNAL_TOKEN: ${COLLAB_INTERNAL_TOKEN:?set COLLAB_INTERNAL_TOKEN}' "$compose_config" \
  || fail 'the collaboration materialization secret must be mandatory'
grep -Fq 'expectedToken.length < 32' "$internal_controller" \
  || fail 'the internal endpoint must fail closed when its token is weak or absent'
grep -Fq 'MessageDigest.isEqual' "$internal_controller" \
  || fail 'the internal token must use constant-time comparison'
grep -Fq 'requestMatchers("/api/v1/admin/**")' "$security_config" \
  || fail 'the instance-admin route boundary is missing'
grep -Fq '.hasRole("INSTANCE_ADMIN")' "$security_config" \
  || fail 'the instance-admin route boundary is not role protected'

printf 'EDGE_TRUST_SUCCESS forwarded_for=overwritten api_host_port=closed backend_network=internal internal_token=fail_closed\n'
