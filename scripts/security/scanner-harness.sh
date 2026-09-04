#!/usr/bin/env bash
# Shared SEC-03 scanner identity/session harness.
#
# This file is intended to be sourced by Schemathesis/ZAP wrappers and CI smoke
# tests. It never writes scanner credentials into the repository and keeps
# cookies/CSRF material under an ephemeral state directory that callers destroy
# with security_scan_cleanup / security_scan_teardown.

SECURITY_SCAN_ALPHA_OWNER_EMAIL="security-alpha-owner@example.test"
SECURITY_SCAN_ALPHA_MEMBER_EMAIL="security-alpha-member@example.test"
SECURITY_SCAN_ALPHA_RESTRICTED_EMAIL="security-alpha-restricted@example.test"
SECURITY_SCAN_BETA_OWNER_EMAIL="security-beta-owner@example.test"
SECURITY_SCAN_ALPHA_WORKSPACE_CANARY="SEC-02 Alpha Workspace Canary"
SECURITY_SCAN_BETA_WORKSPACE_CANARY="SEC-02 Beta Workspace Canary"

security_scan_fail() {
  printf 'SEC-03 scanner harness failed: %s\n' "$*" >&2
  return 1
}

security_scan_require_no_xtrace() {
  case "$-" in
    *x*) security_scan_fail "shell xtrace must be disabled while scanner auth material is in scope" ;;
    *) return 0 ;;
  esac
}

security_scan_require_boundary() {
  security_scan_require_no_xtrace || return 1
  [[ "${ASPNETCORE_ENVIRONMENT:-}" == "Test" ]] ||
    security_scan_fail "ASPNETCORE_ENVIRONMENT must be exactly Test" || return 1
  case "${AIP_SECURITY_CI_FIXTURE_ENABLED:-}" in
    true|TRUE|True|1) ;;
    *) security_scan_fail "SEC-02 activation marker AIP_SECURITY_CI_FIXTURE_ENABLED=true is required"; return 1 ;;
  esac
  [[ -n "${AIP_SECURITY_CI_PASSWORD:-}" ]] ||
    security_scan_fail "AIP_SECURITY_CI_PASSWORD is required from a test-only source" || return 1
}

security_scan_validate_target() {
  local target=${1:-}
  [[ -n "$target" ]] || {
    security_scan_fail "scan target origin is required"
    return 1
  }

  python3 - "$target" "${AIP_SECURITY_CI_EPHEMERAL_ORIGIN:-}" "${GITHUB_ACTIONS:-}" <<'PY'
from __future__ import annotations

import ipaddress
import re
import sys
from urllib.parse import urlsplit, urlunsplit

raw, ephemeral_raw, github_actions = sys.argv[1:4]


def reject(message: str) -> None:
    raise SystemExit(f"SEC-03 target rejected before network access: {message}")


def parse_origin(value: str):
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        reject(f"invalid origin: {exc}")
    if parsed.scheme not in {"http", "https"}:
        reject("scheme must be http or https")
    if parsed.username is not None or parsed.password is not None:
        reject("userinfo is forbidden")
    if not parsed.hostname:
        reject("hostname is required")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        reject("target must be an origin without path, query, or fragment")

    host = parsed.hostname.rstrip(".").lower()
    if not host:
        reject("hostname is empty")
    if any(character.isspace() for character in host):
        reject("hostname contains whitespace")

    display_host = f"[{host}]" if ":" in host else host
    netloc = display_host if port is None else f"{display_host}:{port}"
    return parsed.scheme.lower(), host, port, urlunsplit((parsed.scheme.lower(), netloc, "", "", ""))


def is_non_public_literal(host: str) -> bool:
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_link_local


def is_compose_name(host: str) -> bool:
    return "." not in host and re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", host) is not None

scheme, host, _port, normalized = parse_origin(raw)
local_allowed = (
    host == "localhost"
    or host.endswith(".localhost")
    or is_non_public_literal(host)
    or is_compose_name(host)
)

explicit_ephemeral = False
if ephemeral_raw:
    _e_scheme, e_host, _e_port, ephemeral_normalized = parse_origin(ephemeral_raw)
    # Ephemeral CI targets must still be structurally non-public. Reserved .test
    # names are allowed for an explicitly configured CI routing layer; arbitrary
    # public DNS names remain forbidden even when a caller edits environment vars.
    ephemeral_host_safe = (
        e_host == "localhost"
        or e_host.endswith(".localhost")
        or e_host.endswith(".test")
        or is_non_public_literal(e_host)
        or is_compose_name(e_host)
    )
    explicit_ephemeral = (
        github_actions.lower() == "true"
        and ephemeral_host_safe
        and normalized == ephemeral_normalized
    )

if not (local_allowed or explicit_ephemeral):
    reject(
        "only localhost, non-public IP literals, single-label Compose service names, "
        "or an explicitly configured non-public/.test GitHub Actions target are allowed"
    )

print(normalized)
PY
}

security_scan_role_tenant() {
  case "$1" in
    alpha-owner|alpha-member|alpha-restricted) printf '%s\n' 'security-alpha' ;;
    beta-owner) printf '%s\n' 'security-beta' ;;
    *) security_scan_fail "unknown synthetic scanner role '$1'"; return 1 ;;
  esac
}

security_scan_role_email() {
  case "$1" in
    alpha-owner) printf '%s\n' "$SECURITY_SCAN_ALPHA_OWNER_EMAIL" ;;
    alpha-member) printf '%s\n' "$SECURITY_SCAN_ALPHA_MEMBER_EMAIL" ;;
    alpha-restricted) printf '%s\n' "$SECURITY_SCAN_ALPHA_RESTRICTED_EMAIL" ;;
    beta-owner) printf '%s\n' "$SECURITY_SCAN_BETA_OWNER_EMAIL" ;;
    *) security_scan_fail "unknown synthetic scanner role '$1'"; return 1 ;;
  esac
}

security_scan_role_workspace_canary() {
  case "$1" in
    alpha-owner|alpha-member|alpha-restricted) printf '%s\n' "$SECURITY_SCAN_ALPHA_WORKSPACE_CANARY" ;;
    beta-owner) printf '%s\n' "$SECURITY_SCAN_BETA_WORKSPACE_CANARY" ;;
    *) security_scan_fail "unknown synthetic scanner role '$1'"; return 1 ;;
  esac
}

security_scan_role_forbidden_canary() {
  case "$1" in
    alpha-owner|alpha-member|alpha-restricted) printf '%s\n' "$SECURITY_SCAN_BETA_WORKSPACE_CANARY" ;;
    beta-owner) printf '%s\n' "$SECURITY_SCAN_ALPHA_WORKSPACE_CANARY" ;;
    *) security_scan_fail "unknown synthetic scanner role '$1'"; return 1 ;;
  esac
}

security_scan_redact_stream() {
  python3 -c '
import os
import re
import sys

text = sys.stdin.read()
secret = os.environ.get("AIP_SECURITY_CI_PASSWORD", "")
if secret:
    text = text.replace(secret, "[REDACTED]")
patterns = (
    r"(?im)^(cookie|set-cookie|x-csrf-token)\s*:\s*.*$",
    r"(?i)(\"(?:password|token|csrfToken|cookie)\"\s*:\s*\")[^\"]*(\")",
)
text = re.sub(patterns[0], lambda m: f"{m.group(1)}: [REDACTED]", text)
text = re.sub(patterns[1], r"\1[REDACTED]\2", text)
sys.stdout.write(text)
'
}

security_scan_init() {
  local target=${1:-}
  security_scan_require_boundary || return 1
  SECURITY_SCAN_TARGET="$(security_scan_validate_target "$target")" || return 1

  umask 077
  if [[ -n "${SECURITY_SCAN_STATE_DIR:-}" ]]; then
    mkdir -p "$SECURITY_SCAN_STATE_DIR"
  else
    SECURITY_SCAN_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aip-security-scanner.XXXXXX")"
  fi
  chmod 700 "$SECURITY_SCAN_STATE_DIR"
  SECURITY_SCAN_HTTP_STATE_DIR="${SECURITY_SCAN_HTTP_STATE_DIR:-$SECURITY_SCAN_STATE_DIR}"
  export SECURITY_SCAN_TARGET SECURITY_SCAN_STATE_DIR SECURITY_SCAN_HTTP_STATE_DIR
}

security_scan_cleanup() {
  if [[ -n "${SECURITY_SCAN_STATE_DIR:-}" && -d "$SECURITY_SCAN_STATE_DIR" ]]; then
    rm -rf -- "$SECURITY_SCAN_STATE_DIR"
  fi
  unset SECURITY_SCAN_STATE_DIR SECURITY_SCAN_HTTP_STATE_DIR SECURITY_SCAN_TARGET
  unset SECURITY_SCAN_CSRF_TOKEN SECURITY_SCAN_CSRF_HEADER_NAME
}

security_scan_curl_default() {
  curl "$@"
}

security_scan_http() {
  if declare -F security_scan_curl >/dev/null 2>&1; then
    security_scan_curl "$@"
  else
    security_scan_curl_default "$@"
  fi
}

security_scan_host_path() {
  printf '%s/%s\n' "$SECURITY_SCAN_STATE_DIR" "$1"
}

security_scan_http_path() {
  printf '%s/%s\n' "$SECURITY_SCAN_HTTP_STATE_DIR" "$1"
}

security_scan_cookie_jar() {
  local role=$1
  security_scan_role_tenant "$role" >/dev/null || return 1
  security_scan_http_path "${role}.cookies"
}

security_scan_fetch_csrf() {
  local role=$1
  local tenant jar payload
  tenant="$(security_scan_role_tenant "$role")" || return 1
  jar="$(security_scan_cookie_jar "$role")" || return 1
  payload="$(security_scan_http \
    --fail --silent --show-error \
    -c "$jar" -b "$jar" \
    -H "X-Tenant-Slug: $tenant" \
    "$SECURITY_SCAN_TARGET/api/security/csrf-token")" ||
    security_scan_fail "CSRF bootstrap failed for role '$role'" || return 1

  IFS=$'\t' read -r SECURITY_SCAN_CSRF_HEADER_NAME SECURITY_SCAN_CSRF_TOKEN < <(
    python3 -c '
import json
import sys
payload = json.load(sys.stdin)
header = payload.get("headerName")
token = payload.get("token")
if header != "X-CSRF-Token" or not isinstance(token, str) or not token:
    raise SystemExit("invalid CSRF response")
print(f"{header}\t{token}")
' <<<"$payload"
  ) || security_scan_fail "invalid CSRF payload for role '$role'" || return 1
  export SECURITY_SCAN_CSRF_HEADER_NAME SECURITY_SCAN_CSRF_TOKEN
}

security_scan_login_with_password() {
  local role=$1
  local password=$2
  local tenant email jar response_path response_http_path status
  tenant="$(security_scan_role_tenant "$role")" || return 1
  email="$(security_scan_role_email "$role")" || return 1
  jar="$(security_scan_cookie_jar "$role")" || return 1
  response_path="$(security_scan_host_path "${role}-login.json")"
  response_http_path="$(security_scan_http_path "${role}-login.json")"

  security_scan_fetch_csrf "$role" || return 1

  status="$(
    SECURITY_SCAN_LOGIN_EMAIL="$email" SECURITY_SCAN_LOGIN_PASSWORD="$password" \
      python3 -c '
import json
import os
import sys
json.dump({"email": os.environ["SECURITY_SCAN_LOGIN_EMAIL"], "password": os.environ["SECURITY_SCAN_LOGIN_PASSWORD"]}, sys.stdout, separators=(",", ":"))
' | security_scan_http \
      --silent --show-error \
      -o "$response_http_path" \
      -w '%{http_code}' \
      -c "$jar" -b "$jar" \
      -H "X-Tenant-Slug: $tenant" \
      -H "$SECURITY_SCAN_CSRF_HEADER_NAME: $SECURITY_SCAN_CSRF_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      "$SECURITY_SCAN_TARGET/api/auth/login"
  )" || security_scan_fail "login request failed for role '$role'" || return 1

  SECURITY_SCAN_LAST_LOGIN_STATUS="$status"
  export SECURITY_SCAN_LAST_LOGIN_STATUS
  [[ -f "$response_path" ]] || :
}

security_scan_verify_context() {
  local role=$1
  local tenant email jar me_path me_http_path workspaces_path workspaces_http_path
  local own_canary forbidden_canary
  tenant="$(security_scan_role_tenant "$role")" || return 1
  email="$(security_scan_role_email "$role")" || return 1
  own_canary="$(security_scan_role_workspace_canary "$role")" || return 1
  forbidden_canary="$(security_scan_role_forbidden_canary "$role")" || return 1
  jar="$(security_scan_cookie_jar "$role")" || return 1
  me_path="$(security_scan_host_path "${role}-me.json")"
  me_http_path="$(security_scan_http_path "${role}-me.json")"
  workspaces_path="$(security_scan_host_path "${role}-workspaces.json")"
  workspaces_http_path="$(security_scan_http_path "${role}-workspaces.json")"

  security_scan_http \
    --fail --silent --show-error \
    -o "$me_http_path" \
    -b "$jar" \
    -H "X-Tenant-Slug: $tenant" \
    "$SECURITY_SCAN_TARGET/api/auth/me" ||
    security_scan_fail "current-user probe failed for role '$role'" || return 1

  python3 - "$email" "$me_path" <<'PY' || return 1
import json
import sys
expected, path = sys.argv[1:3]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
if payload.get("email") != expected:
    raise SystemExit(f"current-user email mismatch: {payload.get('email')!r}")
PY

  security_scan_http \
    --fail --silent --show-error \
    -o "$workspaces_http_path" \
    -b "$jar" \
    -H "X-Tenant-Slug: $tenant" \
    "$SECURITY_SCAN_TARGET/api/workspaces" ||
    security_scan_fail "workspace context probe failed for role '$role'" || return 1

  grep -Fq "$own_canary" "$workspaces_path" ||
    security_scan_fail "expected workspace canary missing for role '$role'" || return 1
  if grep -Fq "$forbidden_canary" "$workspaces_path"; then
    security_scan_fail "cross-tenant workspace canary disclosed for role '$role'"
    return 1
  fi
}

security_scan_bootstrap_role() {
  local role=$1
  security_scan_login_with_password "$role" "$AIP_SECURITY_CI_PASSWORD" || return 1
  [[ "$SECURITY_SCAN_LAST_LOGIN_STATUS" == "200" ]] || {
    security_scan_fail "synthetic role '$role' login returned HTTP $SECURITY_SCAN_LAST_LOGIN_STATUS"
    return 1
  }
  security_scan_verify_context "$role" || return 1
}

security_scan_verify_wrong_password_rejected() {
  local role=${1:-alpha-owner}
  local tenant jar me_path me_http_path status
  tenant="$(security_scan_role_tenant "$role")" || return 1
  jar="$(security_scan_cookie_jar "$role")" || return 1
  rm -f -- "$(security_scan_host_path "${role}.cookies")" "$(security_scan_host_path "${role}-login.json")"

  security_scan_login_with_password "$role" "${AIP_SECURITY_CI_PASSWORD}__invalid" || return 1
  [[ "$SECURITY_SCAN_LAST_LOGIN_STATUS" == "401" ]] || {
    security_scan_fail "wrong password for '$role' returned HTTP $SECURITY_SCAN_LAST_LOGIN_STATUS instead of 401"
    return 1
  }

  me_path="$(security_scan_host_path "${role}-wrong-password-me.json")"
  me_http_path="$(security_scan_http_path "${role}-wrong-password-me.json")"
  status="$(security_scan_http \
    --silent --show-error \
    -o "$me_http_path" \
    -w '%{http_code}' \
    -b "$jar" \
    -H "X-Tenant-Slug: $tenant" \
    "$SECURITY_SCAN_TARGET/api/auth/me")" ||
    security_scan_fail "wrong-password current-user probe transport failed" || return 1
  [[ "$status" == "401" ]] || {
    security_scan_fail "wrong-password flow emitted an authenticated context (HTTP $status)"
    return 1
  }
  rm -f -- "$(security_scan_host_path "${role}.cookies")"
}

security_scan_health() {
  local output_http_path output_path
  output_path="$(security_scan_host_path 'health-ready.json')"
  output_http_path="$(security_scan_http_path 'health-ready.json')"
  security_scan_http \
    --fail --silent --show-error \
    -o "$output_http_path" \
    -H "X-Tenant-Slug: security-alpha" \
    "$SECURITY_SCAN_TARGET/health/ready" ||
    security_scan_fail "application readiness probe failed" || return 1
  grep -Fq '"status":"OK"' "$output_path" ||
    security_scan_fail "readiness endpoint returned an unexpected payload" || return 1
}

security_scan_preflight() {
  security_scan_require_boundary || return 1
  security_scan_validate_target "$SECURITY_SCAN_TARGET" >/dev/null || return 1
  security_scan_health || return 1

  local role
  for role in alpha-owner alpha-member alpha-restricted beta-owner; do
    security_scan_bootstrap_role "$role" || return 1
  done

  # Negative login is performed after all valid contexts are proven, using a
  # fresh alpha-owner jar. Re-bootstrap that role so callers receive four valid
  # scanner contexts when preflight succeeds.
  security_scan_verify_wrong_password_rejected alpha-owner || return 1
  security_scan_bootstrap_role alpha-owner || return 1

  printf '%s\n' 'SEC-03 scanner preflight passed: isolated target, SEC-02 fixture topology, four synthetic roles, and negative auth are verified.'
}

security_scan_logout_role() {
  local role=$1
  local tenant jar response_http_path status
  tenant="$(security_scan_role_tenant "$role")" || return 1
  jar="$(security_scan_cookie_jar "$role")" || return 1
  response_http_path="$(security_scan_http_path "${role}-logout.json")"

  security_scan_fetch_csrf "$role" || return 1
  status="$(printf '{}' | security_scan_http \
    --silent --show-error \
    -o "$response_http_path" \
    -w '%{http_code}' \
    -c "$jar" -b "$jar" \
    -H "X-Tenant-Slug: $tenant" \
    -H "$SECURITY_SCAN_CSRF_HEADER_NAME: $SECURITY_SCAN_CSRF_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "$SECURITY_SCAN_TARGET/api/auth/logout")" ||
    security_scan_fail "logout request failed for role '$role'" || return 1
  [[ "$status" == "200" ]] || {
    security_scan_fail "logout for '$role' returned HTTP $status"
    return 1
  }

  status="$(security_scan_http \
    --silent --show-error \
    -o "$response_http_path" \
    -w '%{http_code}' \
    -b "$jar" \
    -H "X-Tenant-Slug: $tenant" \
    "$SECURITY_SCAN_TARGET/api/auth/me")" ||
    security_scan_fail "post-logout probe failed for role '$role'" || return 1
  [[ "$status" == "401" ]] || {
    security_scan_fail "logout did not invalidate '$role' session (HTTP $status)"
    return 1
  }
}

security_scan_teardown() {
  local role
  # Re-check canaries after scanner activity before invalidating sessions.
  for role in alpha-owner alpha-member alpha-restricted beta-owner; do
    security_scan_verify_context "$role" || return 1
  done
  for role in alpha-owner alpha-member alpha-restricted beta-owner; do
    security_scan_logout_role "$role" || return 1
  done
  security_scan_health || return 1
  security_scan_cleanup
  printf '%s\n' 'SEC-03 scanner teardown passed: sessions invalidated, fixture isolation intact, and application remains healthy.'
}
