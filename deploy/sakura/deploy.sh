#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${AIPSITE_SOURCE_DIR:-/srv/aipsite/app}"
DEPLOY_ENV="${AIPSITE_DEPLOY_ENV:-/srv/aipsite/deploy/.env}"
LICENSE_FILE="${SYNCFUSION_LICENSE_FILE:-/srv/aipsite/app/secrets/syncfusion-license.txt}"
CADDY_FILE="${AIPSITE_CADDYFILE:-/srv/aipsite/deploy/Caddyfile}"
COMPOSE_FILE="${SOURCE_DIR}/deploy/sakura/docker-compose.yml"

fail() {
  echo "$1" >&2
  exit 1
}

require_owner_only_file() {
  local file="$1"
  local label="$2"
  local mode

  test -s "$file" || fail "${label} is missing or empty."
  mode="$(stat -c '%a' "$file")"
  (( (8#${mode} & 8#077) == 0 )) || fail "${label} must not be readable or writable by group/other users."
}

test -f "$COMPOSE_FILE" || fail "Missing tracked Sakura Compose file: ${COMPOSE_FILE}"
test -f "$CADDY_FILE" || fail "Missing Caddyfile: ${CADDY_FILE}"
require_owner_only_file "$DEPLOY_ENV" "Deployment environment file"
require_owner_only_file "$LICENSE_FILE" "Syncfusion license file"

test -d "${SOURCE_DIR}/.git" || test -f "${SOURCE_DIR}/.git" || fail "Source directory is not a Git worktree."
test -z "$(git -C "$SOURCE_DIR" status --porcelain)" || fail "Source worktree is not clean; deploy from a separate clean worktree."

export AIPSITE_SOURCE_DIR="$SOURCE_DIR"
export AIPSITE_CADDYFILE="$CADDY_FILE"
export SYNCFUSION_LICENSE_FILE="$LICENSE_FILE"

compose=(docker compose --env-file "$DEPLOY_ENV" --project-name deploy -f "$COMPOSE_FILE")

"${compose[@]}" config --quiet
"${compose[@]}" build web
"${compose[@]}" up -d postgres
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --no-build web caddy
"${compose[@]}" ps

for attempt in $(seq 1 30); do
  if "${compose[@]}" exec -T web curl --fail --silent --show-error \
    -H 'X-Forwarded-Proto: https' \
    -H 'X-Forwarded-Host: localhost' \
    http://localhost:8080/health/ready >/dev/null; then
    echo "Sakura VPS deployment is ready."
    exit 0
  fi
  sleep 2
done

"${compose[@]}" logs --tail=200 web
fail "Sakura VPS readiness check did not succeed in time."
