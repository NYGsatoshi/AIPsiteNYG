#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/security/aud02-lifecycle.sh
source "$repo_root/scripts/security/aud02-lifecycle.sh"

fail() {
  printf 'AUD-02 lifecycle contract test failed: %s\n' "$*" >&2
  exit 1
}

fixture_variant=baseline
db_scalar() {
  cat <<EOF_ROWS
project:sec02-alpha-project=00000000-0000-0000-0000-000000000009
project:sec02-beta-project=00000000-0000-0000-0000-000000000010
tenant:security-alpha=00000000-0000-0000-0000-000000000001
tenant:security-beta=00000000-0000-0000-0000-000000000002
user:security-alpha-member@example.test=00000000-0000-0000-0000-000000000004
user:security-alpha-owner@example.test=00000000-0000-0000-0000-000000000003
user:security-alpha-restricted@example.test=00000000-0000-0000-0000-000000000005
user:security-beta-owner@example.test=00000000-0000-0000-0000-000000000006
workspace:sec02-alpha-workspace=00000000-0000-0000-0000-000000000007
workspace:sec02-beta-workspace=00000000-0000-0000-0000-0000000000$([[ "$fixture_variant" == baseline ]] && printf '08' || printf '88')
EOF_ROWS
}

AUD02_STAGE=init
aud02_advance init fresh-start >/dev/null
aud02_advance fresh-start ready >/dev/null
aud02_advance ready login >/dev/null
aud02_advance login warm-up >/dev/null
aud02_capture_fixture_evidence >/dev/null
[[ "$AUD02_FIXTURE_IDENTITY_BEFORE" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "baseline fingerprint missing"
aud02_advance fixture-evidence teardown >/dev/null
aud02_verify_restart_identity >/dev/null
[[ "$AUD02_STAGE" == restart-identity ]] || fail "happy-path lifecycle did not complete"

AUD02_STAGE=ready
if aud02_advance init fresh-start >/dev/null 2>&1; then
  fail "out-of-order transition was accepted"
fi

AUD02_STAGE=warm-up
AUD02_FIXTURE_IDENTITY_BEFORE="$(aud02_fixture_identity_fingerprint)"
aud02_advance warm-up fixture-evidence >/dev/null
aud02_advance fixture-evidence teardown >/dev/null
fixture_variant=changed
if aud02_verify_restart_identity >/dev/null 2>&1; then
  fail "changed fixture identity was accepted after restart"
fi

printf 'AUD-02 lifecycle state machine and identity fingerprint contract verified.\n'
