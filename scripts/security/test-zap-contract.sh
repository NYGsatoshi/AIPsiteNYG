#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

plan="scripts/security/zap-automation.yaml"
policy="scripts/security/zap-policy.json"
runner="scripts/security/zap-runner.sh"
processor="scripts/security/process-zap-report.py"

test_fail() {
  printf 'SEC-06 contract test failed: %s\n' "$*" >&2
  exit 1
}

for path in "$plan" "$policy" "$runner" "$processor"; do
  [[ -f "$path" ]] || test_fail "missing $path"
done

python3 -m py_compile "$processor"
python3 - "$policy" <<'PY'
import json
import re
import sys
from pathlib import Path
policy = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
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
if policy["roles"] != ["alpha-owner", "alpha-restricted", "beta-owner"]:
    raise SystemExit("SEC-06 role matrix drifted")
if policy["blockingPolicy"]["high"] != "block" or policy["blockingPolicy"]["medium"] != "report":
    raise SystemExit("High must block while Medium remains visible/report-only")
PY

python3 - "$plan" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text(encoding="utf-8")
checks = (
    "type: openapi",
    "statistic: openapi.urls.added",
    'operator: ">"',
    "type: passiveScan-wait",
    "type: activeScan-policy",
    "defaultThreshold: Off",
    "type: activeScan",
    "template: traditional-json",
    "type: exitStatus",
    "errorLevel: High",
    "${AIP_SECURITY_ZAP_COOKIE}",
    "${AIP_SECURITY_ZAP_CSRF_TOKEN}",
)
for item in checks:
    if item not in text:
        raise SystemExit(f"Automation plan invariant missing: {item}")
for rule in ("id: 6", "id: 40003", "id: 40008", "id: 40012", "id: 40014", "id: 40018", "id: 40022", "id: 90020"):
    if rule not in text:
        raise SystemExit(f"Required explicit active rule missing: {rule}")
if "traditional-json-plus" in text:
    raise SystemExit("request/response-bearing ZAP report templates are forbidden")
PY

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '{}\n' > "$tmp/openapi.json"
cp "$plan" "$tmp/plan.yaml"
cp "$policy" "$tmp/policy.json"
addon_sha="$(printf 'immutable-addon-inventory' | sha256sum | awk '{print $1}')"

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

AIP_SECURITY_ZAP_FORBIDDEN_VALUES='["synthetic-secret","synthetic-cookie","synthetic-csrf"]' \
python3 "$processor" \
  --raw-report "$tmp/medium.json" \
  --output "$tmp/medium-safe.json" \
  --metadata "$tmp/medium-meta.json" \
  --role alpha-restricted \
  --target http://app:8080 \
  --scanner-version 2.17.0 \
  --scanner-image 'zaproxy/zap-stable:2.17.0@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  --scanner-exit 0 \
  --contract "$tmp/openapi.json" \
  --automation-plan "$tmp/plan.yaml" \
  --policy "$tmp/policy.json" \
  --addon-list-sha256 "$addon_sha"

grep -Fq '"Medium": 1' "$tmp/medium-safe.json" || test_fail "Medium alert is not visible in sanitized evidence"
if grep -Fq 'synthetic-secret' "$tmp/medium-safe.json" || grep -Fq 'synthetic-cookie' "$tmp/medium-safe.json"; then
  test_fail "sanitized report persisted attack/evidence/session material"
fi
grep -Fq '"queryParameterNames"' "$tmp/medium-safe.json" || test_fail "sanitizer did not retain safe location metadata"

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
if python3 "$processor" \
  --raw-report "$tmp/unknown-risk.json" \
  --output "$tmp/unknown-risk-safe.json" \
  --metadata "$tmp/unknown-risk-meta.json" \
  --role alpha-restricted \
  --target http://app:8080 \
  --scanner-version 2.17.0 \
  --scanner-image 'zaproxy/zap-stable:2.17.0@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  --scanner-exit 0 \
  --contract "$tmp/openapi.json" \
  --automation-plan "$tmp/plan.yaml" \
  --policy "$tmp/policy.json" \
  --addon-list-sha256 "$addon_sha"; then
  test_fail "unrecognized alert risk was incorrectly accepted"
fi

printf '{"site": []}\n' > "$tmp/empty-sites.json"
if python3 "$processor" \
  --raw-report "$tmp/empty-sites.json" \
  --output "$tmp/empty-sites-safe.json" \
  --metadata "$tmp/empty-sites-meta.json" \
  --role alpha-restricted \
  --target http://app:8080 \
  --scanner-version 2.17.0 \
  --scanner-image 'zaproxy/zap-stable:2.17.0@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  --scanner-exit 0 \
  --contract "$tmp/openapi.json" \
  --automation-plan "$tmp/plan.yaml" \
  --policy "$tmp/policy.json" \
  --addon-list-sha256 "$addon_sha"; then
  test_fail "successful scanner exit without scanned-site coverage was incorrectly accepted"
fi

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

if AIP_SECURITY_ZAP_FORBIDDEN_VALUES='["synthetic-secret","synthetic-cookie"]' \
  python3 "$processor" \
    --raw-report "$tmp/high.json" \
    --output "$tmp/high-safe.json" \
    --metadata "$tmp/high-meta.json" \
    --role alpha-owner \
    --target http://app:8080 \
    --scanner-version 2.17.0 \
    --scanner-image 'zaproxy/zap-stable:2.17.0@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    --scanner-exit 1 \
    --contract "$tmp/openapi.json" \
    --automation-plan "$tmp/plan.yaml" \
    --policy "$tmp/policy.json" \
    --addon-list-sha256 "$addon_sha"; then
  test_fail "controlled High alert did not block"
fi
[[ -s "$tmp/high-safe.json" ]] || test_fail "blocking High finding did not leave sanitized evidence"
grep -Fq '"blockingHighAlerts": 1' "$tmp/high-safe.json" || test_fail "High blocker count missing"

if python3 "$processor" \
  --raw-report "$tmp/medium.json" \
  --output "$tmp/timeout-safe.json" \
  --metadata "$tmp/timeout-meta.json" \
  --role beta-owner \
  --target http://app:8080 \
  --scanner-version 2.17.0 \
  --scanner-image 'zaproxy/zap-stable:2.17.0@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  --scanner-exit 124 \
  --contract "$tmp/openapi.json" \
  --automation-plan "$tmp/plan.yaml" \
  --policy "$tmp/policy.json" \
  --addon-list-sha256 "$addon_sha"; then
  test_fail "scanner timeout was incorrectly accepted"
fi

python3 - "$tmp/medium.json" "$tmp/cross-origin.json" <<'PY'
import json
import sys
from pathlib import Path
doc = json.loads(Path(sys.argv[1]).read_text())
doc["site"][0]["alerts"][0]["instances"][0]["uri"] = "https://public.example.com/leak"
Path(sys.argv[2]).write_text(json.dumps(doc), encoding="utf-8")
PY
if python3 "$processor" \
  --raw-report "$tmp/cross-origin.json" \
  --output "$tmp/cross-safe.json" \
  --metadata "$tmp/cross-meta.json" \
  --role alpha-owner \
  --target http://app:8080 \
  --scanner-version 2.17.0 \
  --scanner-image 'zaproxy/zap-stable:2.17.0@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  --scanner-exit 0 \
  --contract "$tmp/openapi.json" \
  --automation-plan "$tmp/plan.yaml" \
  --policy "$tmp/policy.json" \
  --addon-list-sha256 "$addon_sha"; then
  test_fail "cross-origin report evidence was incorrectly accepted"
fi

# The SEC-06 wrapper must refuse a public/non-allowlisted target before Docker or
# authenticated traffic can be reached.
# shellcheck source=scripts/security/scanner-harness.sh
source scripts/security/scanner-harness.sh
# shellcheck source=scripts/security/zap-runner.sh
source scripts/security/zap-runner.sh
export ASPNETCORE_ENVIRONMENT=Test
export AIP_SECURITY_CI_FIXTURE_ENABLED=true
export AIP_SECURITY_CI_PASSWORD='contract-test-password'
export SECURITY_SCAN_TARGET='https://production.example.com'
export SECURITY_SCAN_TRANSPORT_KIND=compose
if security_zap_require_target >/dev/null 2>&1; then
  test_fail "public target passed SEC-06 target preflight"
fi

# Auth/context loss must block before the runner can prepare or launch ZAP.
auth_fetch_called=0
security_scan_verify_context() { return 1; }
security_scan_fetch_csrf() { auth_fetch_called=1; return 0; }
if security_zap_run_role alpha-owner unused-network "$tmp" >/dev/null 2>&1; then
  test_fail "failed authenticated context was incorrectly accepted"
fi
[[ "$auth_fetch_called" == 0 ]] || test_fail "runner continued after authenticated context failure"

printf 'SEC-06 ZAP contract tests passed.\n'
