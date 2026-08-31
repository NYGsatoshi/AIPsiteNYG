#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${AIPSITE_SOURCE_DIR:-/srv/aipsite/app}"
DEPLOY_ENV="${AIPSITE_DEPLOY_ENV:-/srv/aipsite/deploy/.env}"
LICENSE_FILE="${SYNCFUSION_LICENSE_FILE:-/srv/aipsite/app/secrets/syncfusion-license.txt}"
CADDY_FILE="${AIPSITE_CADDYFILE:-/srv/aipsite/deploy/Caddyfile}"
COMPOSE_FILE="${SOURCE_DIR}/deploy/sakura/docker-compose.yml"
TRYCLOUDFLARE_COMPOSE_FILE="${SOURCE_DIR}/deploy/sakura/docker-compose.trycloudflare.yml"
EDGE_MODE="${AIPSITE_EDGE_MODE:-caddy}"
VALIDATE_ONLY="${AIPSITE_DEPLOY_VALIDATE_ONLY:-false}"

fail() {
  echo "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: deploy.sh [caddy|trycloudflare]

The default edge mode is caddy. Set AIPSITE_EDGE_MODE or pass the mode as the
single positional argument. Use AIPSITE_DEPLOY_VALIDATE_ONLY=true to validate
the rendered deployment contract without building or starting containers.
EOF
}

require_owner_only_file() {
  local file="$1"
  local label="$2"
  local mode

  test -s "$file" || fail "${label} is missing or empty."
  mode="$(stat -c '%a' "$file")"
  (( (8#${mode} & 8#077) == 0 )) || fail "${label} must not be readable or writable by group/other users."
}

if (( $# > 1 )); then
  usage >&2
  exit 2
fi
if (( $# == 1 )); then
  EDGE_MODE="$1"
fi

case "$EDGE_MODE" in
  caddy|trycloudflare)
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    fail "Unsupported Sakura edge mode: ${EDGE_MODE}"
    ;;
esac

case "$VALIDATE_ONLY" in
  true|false|1|0)
    ;;
  *)
    fail "AIPSITE_DEPLOY_VALIDATE_ONLY must be true, false, 1, or 0."
    ;;
esac

test -f "$COMPOSE_FILE" || fail "Missing tracked Sakura Compose file: ${COMPOSE_FILE}"
if [[ "$EDGE_MODE" == "trycloudflare" ]]; then
  test -f "$TRYCLOUDFLARE_COMPOSE_FILE" || fail "Missing tracked TryCloudflare Compose overlay: ${TRYCLOUDFLARE_COMPOSE_FILE}"
else
  test -f "$CADDY_FILE" || fail "Missing Caddyfile: ${CADDY_FILE}"
fi
require_owner_only_file "$DEPLOY_ENV" "Deployment environment file"
require_owner_only_file "$LICENSE_FILE" "Syncfusion license file"

test -d "${SOURCE_DIR}/.git" || test -f "${SOURCE_DIR}/.git" || fail "Source directory is not a Git worktree."
if [[ "$VALIDATE_ONLY" != "true" && "$VALIDATE_ONLY" != "1" ]]; then
  test -z "$(git -C "$SOURCE_DIR" status --porcelain)" || fail "Source worktree is not clean; deploy from a separate clean worktree."
fi

export AIPSITE_SOURCE_DIR="$SOURCE_DIR"
export AIPSITE_CADDYFILE="$CADDY_FILE"
export SYNCFUSION_LICENSE_FILE="$LICENSE_FILE"

compose=(docker compose --env-file "$DEPLOY_ENV" --project-name deploy -f "$COMPOSE_FILE")
if [[ "$EDGE_MODE" == "trycloudflare" ]]; then
  compose+=(-f "$TRYCLOUDFLARE_COMPOSE_FILE")
fi

validate_rendered_contract() {
  local rendered
  rendered="$(mktemp)"
  trap 'rm -f "$rendered"' RETURN

  "${compose[@]}" config --format json > "$rendered"

  python3 - "$EDGE_MODE" "$rendered" <<'PY'
import json
import sys

mode, path = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    config = json.load(handle)

services = config["services"]
web = services["web"]
env = web.get("environment", {})

required = {
    "Security__RequireHttps": "true",
    "Security__EnableHsts": "true",
    "Security__CookieSecurePolicy": "Always",
    "ReverseProxy__TrustForwardedHeaders": "true",
}
for key, expected in required.items():
    actual = env.get(key)
    if actual != expected:
        raise SystemExit(f"{mode}: expected {key}={expected!r}, got {actual!r}")

if not env.get("ReverseProxy__TrustedNetworks__0"):
    raise SystemExit(f"{mode}: trusted proxy network must be explicit")

symmetry = env.get("ReverseProxy__RequireHeaderSymmetry")
if mode == "caddy":
    if symmetry != "true":
        raise SystemExit(f"caddy: forwarded-header symmetry must remain enabled, got {symmetry!r}")
    if "caddy" not in services:
        raise SystemExit("caddy: bundled Caddy service must be present")
else:
    if symmetry != "false":
        raise SystemExit(f"trycloudflare: forwarded-header symmetry must be disabled, got {symmetry!r}")
    if "caddy" in services:
        raise SystemExit("trycloudflare: bundled Caddy must be disabled unless its profile is explicitly requested")

    origin_ports = [
        port for port in web.get("ports", [])
        if int(port.get("target", -1)) == 8080
    ]
    if not origin_ports:
        raise SystemExit("trycloudflare: web:8080 must be published to the loopback origin")
    if any(port.get("host_ip") != "127.0.0.1" for port in origin_ports):
        raise SystemExit(f"trycloudflare: origin must be loopback-only, got {origin_ports!r}")
PY
}

validate_rendered_contract

if [[ "$VALIDATE_ONLY" == "true" || "$VALIDATE_ONLY" == "1" ]]; then
  echo "Sakura ${EDGE_MODE} deployment contract is valid."
  exit 0
fi

"${compose[@]}" build web
"${compose[@]}" up -d postgres
"${compose[@]}" run --rm migrate

if [[ "$EDGE_MODE" == "trycloudflare" ]]; then
  # A previous Caddy-mode deployment can leave the project Caddy container
  # running. Stop/remove only that Compose service before exposing the
  # loopback-only Quick Tunnel origin.
  "${compose[@]}" --profile caddy stop caddy >/dev/null 2>&1 || true
  "${compose[@]}" --profile caddy rm -f caddy >/dev/null 2>&1 || true
  "${compose[@]}" up -d --no-build web
else
  "${compose[@]}" up -d --no-build web caddy
fi

"${compose[@]}" ps

check_ready() {
  "${compose[@]}" exec -T web curl --fail --silent --show-error \
    -H 'X-Forwarded-Proto: https' \
    -H 'X-Forwarded-Host: localhost' \
    http://localhost:8080/health/ready >/dev/null
}

check_trycloudflare_security_probe() {
  local headers
  headers="$(
    "${compose[@]}" exec -T web curl --fail --silent --show-error \
      -D - -o /dev/null \
      -H 'X-Forwarded-For: 198.51.100.42, 203.0.113.20' \
      -H 'X-Forwarded-Proto: https' \
      -H 'X-Forwarded-Host: portal.example.com' \
      http://localhost:8080/api/security/csrf-token
  )" || return 1

  grep -qi '^Strict-Transport-Security:' <<<"$headers" || return 1
  grep -qiE '^Set-Cookie: .*secure' <<<"$headers" || return 1
}

for attempt in $(seq 1 30); do
  if check_ready; then
    if [[ "$EDGE_MODE" != "trycloudflare" ]] || check_trycloudflare_security_probe; then
      echo "Sakura VPS deployment is ready in ${EDGE_MODE} mode."
      exit 0
    fi
  fi
  sleep 2
done

"${compose[@]}" logs --tail=200 web
fail "Sakura VPS readiness/security checks did not succeed."
