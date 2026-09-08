#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

plan="scripts/security/zap-automation.yaml"
policy="scripts/security/zap-policy.json"
runner="scripts/security/zap-runner.sh"
processor="scripts/security/process-zap-report.py"
required_active_rule_ids="6,40003,40008,40012,40014,40018,40022,90020"

test_fail() {
  printf 'SEC-06 contract test failed: %s\n' "$*" >&2
  exit 1
}

expect_failure_contains() {
  local expected=$1
  shift
  local output status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  (( status != 0 )) || test_fail "command unexpectedly succeeded; expected rejection containing '$expected'"
  [[ "$output" == *"$expected"* ]] ||
    test_fail "expected rejection containing '$expected', got: $output"
}

for path in "$plan" "$policy" "$runner" "$processor"; do
  [[ -f "$path" ]] || test_fail "missing $path"
done

bash -n "$runner"
python3 -m py_compile "$processor"
python3 - "$policy" "$required_active_rule_ids" <<'PY'
import json
import re
import sys
from pathlib import Path
policy = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
required_active_rule_ids = tuple(sys.argv[2].split(","))
scanner = policy["scanner"]
image = scanner["image"]
if scanner["version"] != "2.17.0":
    raise SystemExit("ZAP version must remain explicitly pinned")
if not re.search(r"@sha256:[0-9a-f]{64}$", image):
    raise SystemExit("ZAP image must be digest pinned")
if ":latest" in image or image.endswith(":stable"):
    raise SystemExit("moving ZAP image tags are forbidden")
required = {"automation", "openapi", "pscan", "pscanrules", "ascanrules", "reports", "replacer"}
if not required.issubset(set(scanner["requiredAddons"])):
    raise SystemExit("required ZAP add-on inventory is incomplete")
active_rules = policy.get("activeRules")
if not isinstance(active_rules, list) or not all(
    isinstance(rule, dict) and "id" in rule for rule in active_rules
):
    raise SystemExit("SEC-06 activeRules must be an array of rule objects with ids")
active_rule_ids = tuple(str(rule["id"]) for rule in active_rules)
if (
    len(active_rule_ids) != len(required_active_rule_ids)
    or set(active_rule_ids) != set(required_active_rule_ids)
):
    raise SystemExit(
        "SEC-06 activeRules must exactly match the independent required-rule set: "
        f"expected={required_active_rule_ids} actual={active_rule_ids}"
    )
if policy["roles"] != ["alpha-owner", "alpha-restricted", "beta-owner"]:
    raise SystemExit("SEC-06 role matrix drifted")
blocking = policy["blockingPolicy"]
if blocking["high"] != "block" or blocking["medium"] != "report":
    raise SystemExit("High must block while Medium remains visible/report-only")
if blocking.get("zeroOpenApiCoverage") != "block":
    raise SystemExit("zero OpenAPI/authenticated coverage must remain blocking")
coverage = policy.get("coveragePolicy", {}).get("zeroOpenApiCoverage")
expected_probe = {
    "method": "GET",
    "path": "/api/announcements/audiences",
    "expectedStatus": 200,
}
if not isinstance(coverage, dict) or coverage.get("openApiStatistic") != "openapi.urls.added > 0":
    raise SystemExit("SEC-06 coverage policy must retain the OpenAPI import signal")
if coverage.get("authenticatedRequestResponsePerRole") != expected_probe:
    raise SystemExit("SEC-06 coverage policy must require the protected per-role request/response probe")
PY

python3 - "$plan" "$required_active_rule_ids" <<'PY'
from pathlib import Path
import re
import sys
text = Path(sys.argv[1]).read_text(encoding="utf-8")
required_active_rule_ids = tuple(sys.argv[2].split(","))
checks = (
    "type: openapi",
    "statistic: openapi.urls.added",
    'operator: ">"',
    "type: requestor",
    '${AIP_SECURITY_ZAP_TARGET}/api/announcements/audiences',
    "responseCode: 200",
    "type: passiveScan-wait",
    "type: activeScan-policy",
    "defaultThreshold: Off",
    "type: activeScan",
    "statistic: stats.ascan.stopped",
    "template: traditional-json",
    "type: exitStatus",
    "errorLevel: High",
    "warnExitValue: 1",
    "${AIP_SECURITY_ZAP_COOKIE}",
    "${AIP_SECURITY_ZAP_CSRF_TOKEN}",
)
for item in checks:
    if item not in text:
        raise SystemExit(f"Automation plan invariant missing: {item}")
try:
    policy_section = text.split("  - type: activeScan-policy\n", 1)[1].split(
        "\n  - type: activeScan\n", 1
    )[0]
except IndexError as exc:
    raise SystemExit("Automation plan activeScan-policy section is malformed") from exc
plan_rule_ids = tuple(
    re.findall(r"(?m)^\s+- id:\s*(\d+)\s*$", policy_section)
)
if (
    len(plan_rule_ids) != len(required_active_rule_ids)
    or set(plan_rule_ids) != set(required_active_rule_ids)
):
    raise SystemExit(
        "Automation plan rules must exactly match the independent SEC-06 required-rule set: "
        f"expected={required_active_rule_ids} actual={plan_rule_ids}"
    )
for rule_id in required_active_rule_ids:
    for item in (
        f"statistic: stats.ascan.{rule_id}.started",
        f"statistic: stats.ascan.{rule_id}.skipped",
    ):
        if item not in text:
            raise SystemExit(f"Required active-rule completion invariant missing: {item}")
    obsolete_time = f"statistic: stats.ascan.{rule_id}.time"
    if obsolete_time in text:
        raise SystemExit(f"Obsolete per-rule time invariant must be absent: {obsolete_time}")
if "traditional-json-plus" in text:
    raise SystemExit("request/response-bearing ZAP report templates are forbidden")
PY

grep -Fq 'export AIP_SECURITY_ZAP_FORBIDDEN_VALUES="$forbidden_json"' "$runner" || test_fail "full forbidden-value set is not exported for host-side redaction"
grep -Fq 'values.add(f"{name}={value}")' "$runner" || test_fail "cookie name=value pairs are missing from the forbidden-value set"
grep -Fq 'unset AIP_SECURITY_ZAP_FORBIDDEN_VALUES' "$runner" || test_fail "host-side forbidden-value set is not cleared after each role"
! grep -Eq '^[[:space:]]*-e[[:space:]]+AIP_SECURITY_ZAP_FORBIDDEN_VALUES([[:space:]\\]|$)' "$runner" || test_fail "forbidden-value set must not be passed into the ZAP container"
grep -Fq 'container_name="sec06-zap-${role}-$$"' "$runner" || test_fail "ZAP role container lacks a deterministic cleanup name"
grep -Fq -- '--name "$container_name"' "$runner" || test_fail "named ZAP role container is not wired into docker run"
grep -Fq 'docker rm -f "$container_name" >/dev/null 2>&1 || true' "$runner" || test_fail "non-zero ZAP exit does not force-remove its named container"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '{}\n' > "$tmp/openapi.json"
cp "$plan" "$tmp/plan.yaml"
cp "$policy" "$tmp/policy.json"
addon_sha="$(printf 'immutable-addon-inventory' | sha256sum | awk '{print $1}')"
readonly TEST_SCANNER_IMAGE='zaproxy/zap-stable:2.17.0@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
readonly TEST_FORBIDDEN_VALUES='["synthetic-secret","synthetic-cookie","synthetic-csrf"]'

cat > "$tmp/medium.json" <<'JSON'
{
  "@version": "2.17.0",
  "site": [
    {
      "@name": "http://app:8080",
      "alerts": [
        {
          "pluginid": "10021",
          "name": "Example Medium Passive Alert",
          "riskcode": "2",
          "riskdesc": "Medium (Medium)",
          "confidence": "2",
          "count": "1",
          "instances": [
            {
              "uri": "http://app:8080/api/tasks?q=synthetic-secret",
              "method": "GET",
              "param": "q",
              "attack": "synthetic-secret",
              "evidence": "synthetic-cookie"
            }
          ]
        }
      ]
    }
  ]
}
JSON

expect_failure_contains \
  'AIP_SECURITY_ZAP_FORBIDDEN_VALUES is not set' \
  env -u AIP_SECURITY_ZAP_FORBIDDEN_VALUES -u AIP_SECURITY_ZAP_ALLOW_UNSANITIZED \
  python3 "$processor" \
    --raw-report "$tmp/medium.json" \
    --output "$tmp/missing-forbidden-safe.json" \
    --metadata "$tmp/missing-forbidden-meta.json" \
    --role alpha-restricted \
    --target http://app:8080 \
    --scanner-version 2.17.0 \
    --scanner-image "$TEST_SCANNER_IMAGE" \
    --scanner-exit 0 \
    --contract "$tmp/openapi.json" \
    --automation-plan "$tmp/plan.yaml" \
    --policy "$tmp/policy.json" \
    --addon-list-sha256 "$addon_sha"
[[ ! -e "$tmp/missing-forbidden-safe.json" && ! -e "$tmp/missing-forbidden-meta.json" ]] ||
  test_fail "missing forbidden-value set wrote evidence"

expect_failure_contains \
  'AIP_SECURITY_ZAP_FORBIDDEN_VALUES contains no non-empty values' \
  env -u AIP_SECURITY_ZAP_ALLOW_UNSANITIZED AIP_SECURITY_ZAP_FORBIDDEN_VALUES='[]' \
  python3 "$processor" \
    --raw-report "$tmp/medium.json" \
    --output "$tmp/empty-forbidden-safe.json" \
    --metadata "$tmp/empty-forbidden-meta.json" \
    --role alpha-restricted \
    --target http://app:8080 \
    --scanner-version 2.17.0 \
    --scanner-image "$TEST_SCANNER_IMAGE" \
    --scanner-exit 0 \
    --contract "$tmp/openapi.json" \
    --automation-plan "$tmp/plan.yaml" \
    --policy "$tmp/policy.json" \
    --addon-list-sha256 "$addon_sha"
[[ ! -e "$tmp/empty-forbidden-safe.json" && ! -e "$tmp/empty-forbidden-meta.json" ]] ||
  test_fail "empty forbidden-value set wrote evidence without explicit opt-out"

env -u AIP_SECURITY_ZAP_FORBIDDEN_VALUES AIP_SECURITY_ZAP_ALLOW_UNSANITIZED=1 \
python3 "$processor" \
  --raw-report "$tmp/medium.json" \
  --output "$tmp/optout-safe.json" \
  --metadata "$tmp/optout-meta.json" \
  --role alpha-restricted \
  --target http://app:8080 \
  --scanner-version 2.17.0 \
  --scanner-image "$TEST_SCANNER_IMAGE" \
  --scanner-exit 0 \
  --contract "$tmp/openapi.json" \
  --automation-plan "$tmp/plan.yaml" \
  --policy "$tmp/policy.json" \
  --addon-list-sha256 "$addon_sha" >/dev/null
grep -Fq '"forbiddenValueCount": 0' "$tmp/optout-safe.json" || test_fail "opt-out evidence did not record zero forbidden values"
grep -Fq '"unsanitizedAllowed": true' "$tmp/optout-safe.json" || test_fail "opt-out evidence did not record the explicit decision"

env -u AIP_SECURITY_ZAP_ALLOW_UNSANITIZED AIP_SECURITY_ZAP_FORBIDDEN_VALUES="$TEST_FORBIDDEN_VALUES" \
python3 "$processor" \
  --raw-report "$tmp/medium.json" \
  --output "$tmp/medium-safe.json" \
  --metadata "$tmp/medium-meta.json" \
  --role alpha-restricted \
  --target http://app:8080 \
  --scanner-version 2.17.0 \
  --scanner-image "$TEST_SCANNER_IMAGE" \
  --scanner-exit 0 \
  --contract "$tmp/openapi.json" \
  --automation-plan "$tmp/plan.yaml" \
  --policy "$tmp/policy.json" \
  --addon-list-sha256 "$addon_sha"

grep -Fq '"Medium": 1' "$tmp/medium-safe.json" || test_fail "Medium alert is not visible in sanitized evidence"
grep -Fq '"forbiddenValueCount": 3' "$tmp/medium-safe.json" || test_fail "sanitization evidence did not record the forbidden-value count"
grep -Fq '"unsanitizedAllowed": false' "$tmp/medium-safe.json" || test_fail "normal SEC-06 evidence incorrectly recorded sanitization opt-out"
if grep -Fq 'synthetic-secret' "$tmp/medium-safe.json" || grep -Fq 'synthetic-cookie' "$tmp/medium-safe.json"; then
  test_fail "sanitized report persisted attack/evidence/session material"
fi
grep -Fq '"queryParameterNames"' "$tmp/medium-safe.json" || test_fail "sanitizer did not retain safe location metadata"

python3 - "$tmp/medium.json" "$tmp/encoded-secret.json" <<'PY'
import json
import sys
from pathlib import Path
doc = json.loads(Path(sys.argv[1]).read_text())
doc["site"][0]["alerts"][0]["instances"][0]["uri"] = "http://app:8080/api/synthetic%2Ftoken"
Path(sys.argv[2]).write_text(json.dumps(doc), encoding="utf-8")
PY
expect_failure_contains \
  'sanitized evidence still contains ephemeral authentication material' \
  env -u AIP_SECURITY_ZAP_ALLOW_UNSANITIZED AIP_SECURITY_ZAP_FORBIDDEN_VALUES='["synthetic/token"]' \
  python3 "$processor" \
    --raw-report "$tmp/encoded-secret.json" \
    --output "$tmp/encoded-secret-safe.json" \
    --metadata "$tmp/encoded-secret-meta.json" \
    --role alpha-restricted \
    --target http://app:8080 \
    --scanner-version 2.17.0 \
    --scanner-image "$TEST_SCANNER_IMAGE" \
    --scanner-exit 0 \
    --contract "$tmp/openapi.json" \
    --automation-plan "$tmp/plan.yaml" \
    --policy "$tmp/policy.json" \
    --addon-list-sha256 "$addon_sha"
[[ ! -e "$tmp/encoded-secret-safe.json" && ! -e "$tmp/encoded-secret-meta.json" ]] ||
  test_fail "URL-encoded forbidden path wrote sanitized evidence"

python3 - "$tmp/medium.json" "$tmp/unknown-risk.json" <<'PY'
import json
import sys
from pathlib import Path
doc = json.loads(Path(sys.argv[1]).read_text())
alert = doc["site"][0]["alerts"][0]
alert["riskcode"] = "unexpected"
alert["riskdesc"] = "Unexpected"
Path(sys.argv[2]).write_text(json.dumps(doc), encoding="utf-8")
PY
expect_failure_contains \
  'unrecognized risk classification' \
  env -u AIP_SECURITY_ZAP_ALLOW_UNSANITIZED AIP_SECURITY_ZAP_FORBIDDEN_VALUES="$TEST_FORBIDDEN_VALUES" \
  python3 "$processor" \
    --raw-report "$tmp/unknown-risk.json" \
    --output "$tmp/unknown-risk-safe.json" \
    --metadata "$tmp/unknown-risk-meta.json" \
    --role alpha-restricted \
    --target http://app:8080 \
    --scanner-version 2.17.0 \
    --scanner-image "$TEST_SCANNER_IMAGE" \
    --scanner-exit 0 \
    --contract "$tmp/openapi.json" \
    --automation-plan "$tmp/plan.yaml" \
    --policy "$tmp/policy.json" \
    --addon-list-sha256 "$addon_sha"

printf '{"site": []}\n' > "$tmp/empty-sites.json"
expect_failure_contains \
  'scanner exited successfully without scanned-site coverage' \
  env -u AIP_SECURITY_ZAP_ALLOW_UNSANITIZED AIP_SECURITY_ZAP_FORBIDDEN_VALUES="$TEST_FORBIDDEN_VALUES" \
  python3 "$processor" \
    --raw-report "$tmp/empty-sites.json" \
    --output "$tmp/empty-sites-safe.json" \
    --metadata "$tmp/empty-sites-meta.json" \
    --role alpha-restricted \
    --target http://app:8080 \
    --scanner-version 2.17.0 \
    --scanner-image "$TEST_SCANNER_IMAGE" \
    --scanner-exit 0 \
    --contract "$tmp/openapi.json" \
    --automation-plan "$tmp/plan.yaml" \
    --policy "$tmp/policy.json" \
    --addon-list-sha256 "$addon_sha"

python3 - "$tmp/medium.json" "$tmp/high.json" <<'PY'
import json
import sys
from pathlib import Path
doc = json.loads(Path(sys.argv[1]).read_text())
alert = doc["site"][0]["alerts"][0]
alert["pluginid"] = "40018"
alert["name"] = "SQL Injection"
alert["riskcode"] = "3"
alert["riskdesc"] = "High (Medium)"
Path(sys.argv[2]).write_text(json.dumps(doc), encoding="utf-8")
PY

expect_failure_contains \
  'High findings are blocking' \
  env -u AIP_SECURITY_ZAP_ALLOW_UNSANITIZED AIP_SECURITY_ZAP_FORBIDDEN_VALUES="$TEST_FORBIDDEN_VALUES" \
  python3 "$processor" \
    --raw-report "$tmp/high.json" \
    --output "$tmp/high-safe.json" \
    --metadata "$tmp/high-meta.json" \
    --role alpha-owner \
    --target http://app:8080 \
    --scanner-version 2.17.0 \
    --scanner-image "$TEST_SCANNER_IMAGE" \
    --scanner-exit 1 \
    --contract "$tmp/openapi.json" \
    --automation-plan "$tmp/plan.yaml" \
    --policy "$tmp/policy.json" \
    --addon-list-sha256 "$addon_sha"
[[ -s "$tmp/high-safe.json" ]] || test_fail "blocking High finding did not leave sanitized evidence"
grep -Fq '"blockingHighAlerts": 1' "$tmp/high-safe.json" || test_fail "High blocker count missing"

expect_failure_contains \
  'ZAP failure/timeout cannot be green' \
  env -u AIP_SECURITY_ZAP_ALLOW_UNSANITIZED AIP_SECURITY_ZAP_FORBIDDEN_VALUES="$TEST_FORBIDDEN_VALUES" \
  python3 "$processor" \
    --raw-report "$tmp/medium.json" \
    --output "$tmp/timeout-safe.json" \
    --metadata "$tmp/timeout-meta.json" \
    --role beta-owner \
    --target http://app:8080 \
    --scanner-version 2.17.0 \
    --scanner-image "$TEST_SCANNER_IMAGE" \
    --scanner-exit 124 \
    --contract "$tmp/openapi.json" \
    --automation-plan "$tmp/plan.yaml" \
    --policy "$tmp/policy.json" \
    --addon-list-sha256 "$addon_sha"

python3 - "$tmp/medium.json" "$tmp/cross-origin.json" <<'PY'
import json
import sys
from pathlib import Path
doc = json.loads(Path(sys.argv[1]).read_text())
doc["site"][0]["alerts"][0]["instances"][0]["uri"] = "https://public.example.com/leak"
Path(sys.argv[2]).write_text(json.dumps(doc), encoding="utf-8")
PY
expect_failure_contains \
  'cross-origin alert evidence observed' \
  env -u AIP_SECURITY_ZAP_ALLOW_UNSANITIZED AIP_SECURITY_ZAP_FORBIDDEN_VALUES="$TEST_FORBIDDEN_VALUES" \
  python3 "$processor" \
    --raw-report "$tmp/cross-origin.json" \
    --output "$tmp/cross-safe.json" \
    --metadata "$tmp/cross-meta.json" \
    --role alpha-owner \
    --target http://app:8080 \
    --scanner-version 2.17.0 \
    --scanner-image "$TEST_SCANNER_IMAGE" \
    --scanner-exit 0 \
    --contract "$tmp/openapi.json" \
    --automation-plan "$tmp/plan.yaml" \
    --policy "$tmp/policy.json" \
    --addon-list-sha256 "$addon_sha"

# The shared SEC-03 boundary must reject public targets before Docker or
# authenticated traffic can be reached.
# shellcheck source=scripts/security/scanner-harness.sh
source scripts/security/scanner-harness.sh
# shellcheck source=scripts/security/zap-runner.sh
source scripts/security/zap-runner.sh
export ASPNETCORE_ENVIRONMENT=Test
export AIP_SECURITY_CI_FIXTURE_ENABLED=true
export AIP_SECURITY_CI_PASSWORD='contract-test-password'
export SECURITY_SCAN_TRANSPORT_KIND=compose
export SECURITY_SCAN_TARGET='https://production.example.com'
set +e
target_rejection="$(security_zap_require_target 2>&1)"
target_status=$?
set -e
(( target_status != 0 )) || test_fail "public target passed SEC-06 target preflight"
[[ "$target_rejection" == *'SEC-03 target rejected before network access'* ]] ||
  test_fail "unexpected public-target rejection: $target_rejection"

# SEC-06 is intentionally narrower than the shared local-target allowlist: even
# an otherwise allowed localhost origin must be rejected unless it is the
# transport-bound SEC-02 Compose service alias.
export SECURITY_SCAN_TARGET='http://localhost'
set +e
target_rejection="$(security_zap_require_target 2>&1)"
target_status=$?
set -e
(( target_status != 0 )) || test_fail "non-Compose local target passed SEC-06 target preflight"
[[ "$target_rejection" == *'required SEC-06 runtime accepts only the SEC-02 Compose service origin'* ]] ||
  test_fail "unexpected SEC-06 target-preflight rejection: $target_rejection"

# A non-internal scanner network must block the matrix before toolchain
# preparation or any role scan can run. Stub Docker narrowly to the two network
# inspect calls used by security_zap_require_internal_network.
set +e
internal_network_rejection="$(
  (
    docker() {
      if [[ "$1" == "network" && "$2" == "inspect" && "$3" == "sec06-denied-network" ]]; then
        printf '[{"Internal":false}]\n'
        return 0
      fi
      printf 'UNEXPECTED_DOCKER_CALL %s\n' "$*" >&2
      return 99
    }
    security_zap_require_contract() { return 0; }
    security_zap_require_target() { return 0; }
    security_zap_verify_toolchain() { printf 'ZAP_PREP_CALLED\n' >&2; return 0; }
    security_zap_run_role() { printf 'ZAP_ROLE_CALLED\n' >&2; return 0; }
    security_zap_run_matrix sec06-denied-network "$tmp" app-container
  ) 2>&1
)"
internal_network_status=$?
set -e
(( internal_network_status != 0 )) || test_fail "non-internal SEC-06 scanner network was accepted"
[[ "$internal_network_rejection" == *'SEC-06 scanner network must be Docker internal=true'* ]] ||
  test_fail "unexpected internal-network rejection: $internal_network_rejection"
[[ "$internal_network_rejection" != *'ZAP_PREP_CALLED'* && "$internal_network_rejection" != *'ZAP_ROLE_CALLED'* ]] ||
  test_fail "SEC-06 continued to ZAP preparation after rejecting a non-internal network"

export AIP_SECURITY_ZAP_FORBIDDEN_VALUES='["cookie-value-123","session=cookie-value-123","csrf-value-123"]'
redacted="$(printf '%s\n' 'cookie-value-123 session=cookie-value-123 csrf-value-123 safe-marker' | security_zap_redact_stream)"
for value in cookie-value-123 session=cookie-value-123 csrf-value-123; do
  [[ "$redacted" != *"$value"* ]] || test_fail "stream redaction leaked forbidden value '$value'"
done
[[ "$redacted" == *'safe-marker'* ]] || test_fail "stream redaction removed safe log content"
unset AIP_SECURITY_ZAP_FORBIDDEN_VALUES

# Auth/context loss must block before the runner can prepare or launch ZAP.
auth_fetch_called=0
security_scan_verify_context() { return 1; }
security_scan_fetch_csrf() { auth_fetch_called=1; return 0; }
if security_zap_run_role alpha-owner unused-network "$tmp" >/dev/null 2>&1; then
  test_fail "failed authenticated context was incorrectly accepted"
fi
[[ "$auth_fetch_called" == 0 ]] || test_fail "runner continued after authenticated context failure"

printf 'SEC-06 ZAP contract tests passed.\n'
