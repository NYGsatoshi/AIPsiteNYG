#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/security/scanner-harness.sh
source "$repo_root/scripts/security/scanner-harness.sh"

fail() {
  printf 'SEC-03 harness contract test failed: %s\n' "$*" >&2
  exit 1
}

assert_target_allowed() {
  local target=$1
  security_scan_validate_target "$target" >/dev/null || fail "expected target to be allowed: $target"
}

assert_target_rejected() {
  local target=$1
  if security_scan_validate_target "$target" >/dev/null 2>&1; then
    fail "expected target to be rejected before network access: $target"
  fi
}

assert_target_allowed "http://localhost:8080"
assert_target_allowed "https://api.localhost:8443"
assert_target_allowed "http://127.0.0.1:8080"
assert_target_allowed "http://[::1]:8080"
assert_target_allowed "http://10.23.4.5:8080"
assert_target_allowed "http://app:8080"

assert_target_rejected "https://example.com"
assert_target_rejected "https://portal.example.org"
assert_target_rejected "http://localhost.evil.example"
assert_target_rejected "http://app:8080/api"
assert_target_rejected "http://user@localhost:8080"
assert_target_rejected "ftp://localhost/resource"

AIP_SECURITY_CI_EPHEMERAL_ORIGIN="https://sec03-run.example.test" GITHUB_ACTIONS=true \
  assert_target_allowed "https://sec03-run.example.test"
AIP_SECURITY_CI_EPHEMERAL_ORIGIN="https://sec03-run.example.test" GITHUB_ACTIONS=false \
  assert_target_rejected "https://sec03-run.example.test"
AIP_SECURITY_CI_EPHEMERAL_ORIGIN="https://public.example.com" GITHUB_ACTIONS=true \
  assert_target_rejected "https://public.example.com"

ASPNETCORE_ENVIRONMENT=Test AIP_SECURITY_CI_FIXTURE_ENABLED=true AIP_SECURITY_CI_PASSWORD=dummy \
  security_scan_require_boundary || fail "valid Test boundary was rejected"
if ASPNETCORE_ENVIRONMENT=Production AIP_SECURITY_CI_FIXTURE_ENABLED=true AIP_SECURITY_CI_PASSWORD=dummy \
  security_scan_require_boundary >/dev/null 2>&1; then
  fail "Production boundary bypassed Test-only guard"
fi
if ASPNETCORE_ENVIRONMENT=Test AIP_SECURITY_CI_FIXTURE_ENABLED=false AIP_SECURITY_CI_PASSWORD=dummy \
  security_scan_require_boundary >/dev/null 2>&1; then
  fail "missing SEC-02 activation marker bypassed guard"
fi

redacted="$(
  AIP_SECURITY_CI_PASSWORD='scanner-password-value' security_scan_redact_stream <<'LOG'
Cookie: auth=secret-cookie
Set-Cookie: auth=secret-cookie
X-CSRF-Token: csrf-secret
{"password":"scanner-password-value","token":"token-secret","safe":"kept"}
LOG
)"
[[ "$redacted" != *'scanner-password-value'* ]] || fail "password leaked through redactor"
[[ "$redacted" != *'secret-cookie'* ]] || fail "cookie leaked through redactor"
[[ "$redacted" != *'csrf-secret'* ]] || fail "CSRF token leaked through redactor"
[[ "$redacted" != *'token-secret'* ]] || fail "JSON token leaked through redactor"
[[ "$redacted" == *'"safe":"kept"'* ]] || fail "redactor removed unrelated log content"

for role in alpha-owner alpha-member alpha-restricted beta-owner; do
  tenant="$(security_scan_role_tenant "$role")"
  email="$(security_scan_role_email "$role")"
  [[ "$email" == *@example.test ]] || fail "$role does not use a synthetic identity"
  [[ "$tenant" == security-alpha || "$tenant" == security-beta ]] || fail "$role mapped to unexpected tenant"
done

printf '%s\n' 'SEC-03 scanner harness contract tests passed.'
