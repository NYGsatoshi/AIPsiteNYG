#!/usr/bin/env bash
set -Eeuo pipefail

: "${AIP_SECURITY_CI_PASSWORD:?AIP_SECURITY_CI_PASSWORD is required for the SEC-03 runtime smoke}"

project="${AIP_SECURITY_CI_PROJECT:-aipsite-security-runtime-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}}"
compose=(
  docker compose
  -p "$project"
  -f docker-compose.real-backend-smoke.yml
  -f docker-compose.security.yml
  -f docker-compose.security.runtime.yml
)
state_dir="$(mktemp -d)"
network="${project}_default"
curl_image="curlimages/curl:8.21.0"
base_url="http://app:8080"

# shellcheck source=scripts/security/scanner-harness.sh
source scripts/security/scanner-harness.sh

cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then
    echo "SEC-03 runtime smoke failed; dumping Compose state." >&2
    "${compose[@]}" ps >&2 || true
    # Application/DB logs are server-side only. Scanner request material is kept
    # in the ephemeral state directory below and is never uploaded as an artifact.
    "${compose[@]}" logs --no-color postgres migrate app >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$state_dir"
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "SEC-03 runtime smoke failed: $*" >&2
  return 1
}

curl_network() {
  docker run --rm -i \
    --user 0:0 \
    --network "$network" \
    -v "$state_dir:/state" \
    "$curl_image" "$@"
}

# The shared harness accepts an injectable curl transport. Keeping this adapter
# here lets scanner authentication run against the app-only Compose network
# without publishing a host port.
security_scan_curl() {
  curl_network "$@"
}

wait_ready() {
  local attempt
  for attempt in $(seq 1 90); do
    if curl_network \
      --fail --silent --show-error \
      -H "X-Tenant-Slug: security-alpha" \
      "$base_url/health/ready" \
      > "$state_dir/health-ready.json" 2>/dev/null; then
      grep -Fq '"status":"OK"' "$state_dir/health-ready.json" ||
        fail "readiness endpoint returned an unexpected payload"
      return 0
    fi
    sleep 2
  done
  fail "application did not become ready"
}

db_scalar() {
  local sql=$1
  "${compose[@]}" exec -T postgres \
    psql -v ON_ERROR_STOP=1 \
      -U aip_portal_security \
      -d aip_portal_security \
      -At -c "$sql"
}

assert_db_count() {
  local expected=$1
  local sql=$2
  local label=$3
  local actual
  actual="$(db_scalar "$sql" | tr -d '\r\n[:space:]')"
  [[ "$actual" == "$expected" ]] ||
    fail "$label expected $expected rows after restart, got '$actual'"
}

# The runtime override must remove the production frontend build (and therefore
# the private Syncfusion build secret) while keeping the app unreachable from the
# host. The security job probes it only through the isolated Compose network.
"${compose[@]}" config --quiet
"${compose[@]}" config --format json | python3 -c '
import json
import sys

document = json.load(sys.stdin)
app = document["services"]["app"]
if "build" in app:
    raise SystemExit("SEC-03 runtime app must not retain the production Docker build")
if app.get("image") != "mcr.microsoft.com/dotnet/sdk:10.0.302":
    raise SystemExit("SEC-03 runtime app must use the pinned .NET SDK image")
if app.get("ports"):
    raise SystemExit("SEC-03 runtime app must not publish host ports")
environment = app.get("environment", {})
if str(environment.get("AIP_SECURITY_CI_FIXTURE_ENABLED", "")).lower() != "true":
    raise SystemExit("SEC-03 runtime fixture must remain enabled")
if str(environment.get("ASPNETCORE_ENVIRONMENT", "")).lower() != "test":
    raise SystemExit("SEC-03 runtime app must remain Test-only")
'

"${compose[@]}" up -d postgres migrate app
wait_ready

# The scanner process must independently prove the same Test-only activation
# boundary before it sends any authentication or scan traffic.
export ASPNETCORE_ENVIRONMENT=Test
export AIP_SECURITY_CI_FIXTURE_ENABLED=true
export SECURITY_SCAN_STATE_DIR="$state_dir/scanner"
export SECURITY_SCAN_HTTP_STATE_DIR="/state/scanner"
security_scan_init "$base_url"
security_scan_preflight
# No active scanner is invoked in SEC-03. Later SEC phases run their tool between
# these two calls and reuse the in-memory/session files from this harness.
security_scan_teardown

# A process restart forces the Test-only hosted service to seed the same real
# PostgreSQL database a second time. Successful readiness plus exact canary row
# counts proves the fixture remains idempotent under relational constraints.
"${compose[@]}" restart app
wait_ready

assert_db_count 2 \
  "SELECT COUNT(*) FROM tenants WHERE \"Slug\" IN ('security-alpha','security-beta');" \
  "tenant canaries"
assert_db_count 4 \
  "SELECT COUNT(*) FROM users WHERE lower(\"Email\") IN ('security-alpha-owner@example.test','security-alpha-member@example.test','security-alpha-restricted@example.test','security-beta-owner@example.test');" \
  "synthetic identities"
assert_db_count 2 \
  "SELECT COUNT(*) FROM workspaces WHERE \"Slug\" IN ('sec02-alpha-workspace','sec02-beta-workspace');" \
  "workspace canaries"
assert_db_count 2 \
  "SELECT COUNT(*) FROM projects WHERE \"Slug\" IN ('sec02-alpha-project','sec02-beta-project');" \
  "project canaries"

echo "SEC-03 scanner target guard, synthetic sessions, tenant isolation, logout invalidation, and disposable PostgreSQL lifecycle verified."
