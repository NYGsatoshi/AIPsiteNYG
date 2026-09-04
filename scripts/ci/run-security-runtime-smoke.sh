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
# shellcheck source=scripts/security/authorization-negative-matrix.sh
source scripts/security/authorization-negative-matrix.sh

cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then
    echo "SEC-03/SEC-05 runtime smoke failed; dumping redacted Compose state." >&2
    "${compose[@]}" ps 2>&1 | security_scan_redact_stream >&2 || true
    # Scanner request material stays in the ephemeral state directory. Server
    # logs are additionally redacted before they can enter the CI log stream.
    "${compose[@]}" logs --no-color postgres migrate app 2>&1 | security_scan_redact_stream >&2 || true
  fi
  security_scan_cleanup >/dev/null 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$state_dir"
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "SEC-03/SEC-05 runtime smoke failed: $*" >&2
  return 1
}

curl_network() {
  docker run --rm -i \
    --user 0:0 \
    --network "$network" \
    -v "$state_dir:/state" \
    "$curl_image" "$@"
}

# The shared harness accepts an injectable curl transport. This adapter always
# executes scanner HTTP from a disposable container attached only to the SEC-02
# Compose network; the app never publishes a host port.
security_scan_curl() {
  curl_network "$@"
}

# A hostname named "app" is not trusted by itself. The harness calls this guard
# before accepting that origin; it proves that the actual Compose app container
# is running and attached to the exact isolated network used by scanner curl.
security_scan_transport_guard() {
  local target=$1 app_container
  [[ "$target" == "$base_url" ]] || return 1
  docker network inspect "$network" >/dev/null 2>&1 || return 1
  app_container="$("${compose[@]}" ps -q app)"
  [[ -n "$app_container" ]] || return 1
  docker inspect "$app_container" --format '{{json .NetworkSettings.Networks}}' |
    python3 -c '
import json
import sys
network = sys.argv[1]
networks = json.load(sys.stdin)
if network not in networks:
    raise SystemExit(f"app container is not attached to isolated scanner network {network!r}")
' "$network"
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

# The scanner process independently proves the Test-only activation boundary and
# the Compose transport binding before it sends authentication or scan traffic.
export ASPNETCORE_ENVIRONMENT=Test
export AIP_SECURITY_CI_FIXTURE_ENABLED=true
export SECURITY_SCAN_TRANSPORT_KIND=compose
export SECURITY_SCAN_STATE_PARENT="$state_dir"
export SECURITY_SCAN_HTTP_STATE_PARENT="/state"
security_scan_init "$base_url"
security_scan_preflight

# The SEC-03 wrong-password probe clears the alpha-owner cookie jar after it has
# validated the four role sessions. Re-establish the baseline once here. SEC-05
# stale-authorization cases mutate authorization state after this point and do
# not log in again, so they still exercise the same established session.
security_scan_bootstrap_user \
  "alpha-owner" \
  "$SECURITY_SCAN_ALPHA_OWNER_EMAIL" \
  "$SECURITY_SCAN_ALPHA_TENANT_SLUG" \
  "$SECURITY_SCAN_ALPHA_OWNER_EXPECTED_ROLE"

# SEC-05 runs inside the same isolated Test-only boundary and reuses the already
# authenticated SEC-03 sessions. Its durable artifact contains metadata only;
# protected response bodies stay in SECURITY_SCAN_STATE_DIR and are destroyed.
security_authorization_negative_matrix_run

# Claims/Evidence and Finding are implemented admin surfaces too. Both authorize
# AuditView before protected artifact/finding lookup, so an ordinary Alpha member
# must be rejected at the BFLA boundary even when supplied a syntactically valid
# identifier. Re-render the same metadata-only evidence after appending the cases.
sec05_case member-audit-claims-evidence audit-claims-evidence bfla-role-downgrade alpha-member \
  'security-alpha/member' 'security-alpha/admin-audit/claims-evidence' GET 'GET /api/admin/audit/claims-evidence' \
  "/api/admin/audit/claims-evidence?artifactVersionId=$SEC05_ALPHA_TASK_ID" \
  forbidden none __NO_BODY__ '' none
sec05_case member-audit-findings audit-finding bfla-role-downgrade alpha-member \
  'security-alpha/member' 'security-alpha/admin-audit/findings' GET 'GET /api/admin/audit/findings' \
  "/api/admin/audit/findings?artifactVersionId=$SEC05_ALPHA_TASK_ID" \
  forbidden none __NO_BODY__ '' none
sec05_write_evidence
if (( SEC05_FAILURES != 0 )); then
  fail "$SEC05_FAILURES SEC-05 blocker case(s) failed after Audit Claim/Evidence/Finding coverage"
fi

security_scan_teardown

# A process restart forces both Test-only seed layers to seed the same real
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
assert_db_count 1 \
  "SELECT COUNT(*) FROM conversations WHERE \"Title\"='SEC05 ALPHA SHADOW CONVERSATION CANARY';" \
  "SEC-05 same-tenant shadow conversation"
assert_db_count 2 \
  "SELECT COUNT(*) FROM notifications WHERE \"LogicalKey\" IN ('sec05-alpha-task-open-canary','sec05-beta-task-open-canary') AND \"DeletedAt\" IS NULL;" \
  "SEC-05 notification canaries"
assert_db_count 2 \
  "SELECT COUNT(*) FROM announcements WHERE \"Title\" IN ('SEC05 ALPHA ANNOUNCEMENT CANARY','SEC05 BETA ANNOUNCEMENT CANARY') AND \"IsDeleted\"=false;" \
  "SEC-05 announcement canaries"

echo "SEC-03 scanner boundary and SEC-05 authorization negative matrix verified on disposable PostgreSQL."
