#!/usr/bin/env bash
set -Eeuo pipefail

: "${AIP_SECURITY_CI_PASSWORD:?AIP_SECURITY_CI_PASSWORD is required for the SEC-02 runtime smoke}"

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

cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then
    echo "SEC-02 runtime smoke failed; dumping Compose state." >&2
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --no-color postgres migrate app >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$state_dir"
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "SEC-02 runtime smoke failed: $*" >&2
  return 1
}

curl_network() {
  docker run --rm \
    --user 0:0 \
    --network "$network" \
    -v "$state_dir:/state" \
    "$curl_image" "$@"
}

wait_ready() {
  local attempt
  for attempt in $(seq 1 90); do
    if curl_network \
      --fail --silent --show-error \
      -H "X-Tenant-Slug: security-alpha" \
      "$base_url/health/ready" \
      > "$state_dir/health-ready.json" 2>/dev/null; then
      grep -Fq '"status":"OK"' "$state_dir/health-ready.json" || \
        fail "readiness endpoint returned an unexpected payload"
      return 0
    fi
    sleep 2
  done
  fail "application did not become ready"
}

csrf_token() {
  local tenant=$1
  local jar=$2
  local payload
  payload="$(curl_network \
    --fail --silent --show-error \
    -c "/state/$jar" \
    -b "/state/$jar" \
    -H "X-Tenant-Slug: $tenant" \
    "$base_url/api/security/csrf-token")"
  python3 -c '
import json
import sys
payload = json.load(sys.stdin)
if payload.get("headerName") != "X-CSRF-Token":
    raise SystemExit("unexpected CSRF header name")
token = payload.get("token")
if not isinstance(token, str) or not token:
    raise SystemExit("empty CSRF token")
print(token)
' <<<"$payload"
}

write_login_payload() {
  local email=$1
  local output=$2
  python3 - "$email" "$output" <<'PY'
import json
import os
import sys

email, output = sys.argv[1], sys.argv[2]
with open(output, "w", encoding="utf-8") as handle:
    json.dump(
        {"email": email, "password": os.environ["AIP_SECURITY_CI_PASSWORD"]},
        handle,
        separators=(",", ":"),
    )
PY
}

login() {
  local tenant=$1
  local email=$2
  local jar=$3
  local prefix=$4
  local token
  token="$(csrf_token "$tenant" "$jar")"
  write_login_payload "$email" "$state_dir/${prefix}-login.json"
  curl_network \
    --fail --silent --show-error \
    -c "/state/$jar" \
    -b "/state/$jar" \
    -H "X-Tenant-Slug: $tenant" \
    -H "X-CSRF-Token: $token" \
    -H "Content-Type: application/json" \
    --data-binary "@/state/${prefix}-login.json" \
    "$base_url/api/auth/login" \
    > "$state_dir/${prefix}-login-response.json"
  python3 - "$email" "$state_dir/${prefix}-login-response.json" <<'PY'
import json
import sys

email, path = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
if payload.get("email") != email:
    raise SystemExit(f"login response email mismatch: {payload.get('email')!r}")
PY
}

get_workspaces() {
  local tenant=$1
  local jar=$2
  local output=$3
  curl_network \
    --fail --silent --show-error \
    -b "/state/$jar" \
    -H "X-Tenant-Slug: $tenant" \
    "$base_url/api/workspaces" \
    > "$state_dir/$output"
}

assert_contains() {
  local path=$1
  local value=$2
  grep -Fq "$value" "$path" || fail "expected canary '$value' was not present in $(basename "$path")"
}

assert_not_contains() {
  local path=$1
  local value=$2
  if grep -Fq "$value" "$path"; then
    fail "cross-tenant canary '$value' leaked through $(basename "$path")"
  fi
}

cross_tenant_probe() {
  local tenant=$1
  local jar=$2
  local output=$3
  local status
  status="$(curl_network \
    --silent --show-error \
    -o "/state/$output" \
    -w '%{http_code}' \
    -b "/state/$jar" \
    -H "X-Tenant-Slug: $tenant" \
    "$base_url/api/workspaces")"
  # The cookie validator is allowed to reject the principal with 401 before the
  # Workspace boundary runs, or the downstream authorization layer may return an
  # empty 200 / concealment 403/404. None of those outcomes may disclose either
  # tenant's canary.
  case "$status" in
    200|401|403|404) ;;
    *) fail "cross-tenant workspace probe returned HTTP $status" ;;
  esac
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
  [[ "$actual" == "$expected" ]] || \
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
    raise SystemExit("SEC-02 runtime app must not retain the production Docker build")
if app.get("image") != "mcr.microsoft.com/dotnet/sdk:10.0.302":
    raise SystemExit("SEC-02 runtime app must use the pinned .NET SDK image")
if app.get("ports"):
    raise SystemExit("SEC-02 runtime app must not publish host ports")
environment = app.get("environment", {})
if str(environment.get("AIP_SECURITY_CI_FIXTURE_ENABLED", "")).lower() != "true":
    raise SystemExit("SEC-02 runtime fixture must remain enabled")
if str(environment.get("ASPNETCORE_ENVIRONMENT", "")).lower() != "test":
    raise SystemExit("SEC-02 runtime app must remain Test-only")
'

"${compose[@]}" up -d postgres migrate app
wait_ready

# The dashboard list DTO intentionally exposes the Workspace display name rather
# than its slug, so HTTP isolation assertions use the synthetic display-name
# canaries. Slug uniqueness is checked separately against PostgreSQL below.
alpha_workspace_canary="SEC-02 Alpha Workspace Canary"
beta_workspace_canary="SEC-02 Beta Workspace Canary"

login security-alpha security-alpha-owner@example.test alpha.cookies alpha
get_workspaces security-alpha alpha.cookies alpha-workspaces.json
assert_contains "$state_dir/alpha-workspaces.json" "$alpha_workspace_canary"
assert_not_contains "$state_dir/alpha-workspaces.json" "$beta_workspace_canary"

cross_tenant_probe security-beta alpha.cookies alpha-as-beta.json
assert_not_contains "$state_dir/alpha-as-beta.json" "$alpha_workspace_canary"
assert_not_contains "$state_dir/alpha-as-beta.json" "$beta_workspace_canary"

login security-beta security-beta-owner@example.test beta.cookies beta
get_workspaces security-beta beta.cookies beta-workspaces.json
assert_contains "$state_dir/beta-workspaces.json" "$beta_workspace_canary"
assert_not_contains "$state_dir/beta-workspaces.json" "$alpha_workspace_canary"

cross_tenant_probe security-alpha beta.cookies beta-as-alpha.json
assert_not_contains "$state_dir/beta-as-alpha.json" "$alpha_workspace_canary"
assert_not_contains "$state_dir/beta-as-alpha.json" "$beta_workspace_canary"

# A process restart forces the Test-only hosted service to seed the same real
# PostgreSQL database a second time. Successful readiness plus exact canary row
# counts proves the seed remains idempotent under relational constraints.
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

echo "SEC-02 PostgreSQL runtime, authentication, tenant isolation, and restart idempotence verified."
