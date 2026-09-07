#!/usr/bin/env bash
set -Eeuo pipefail

gate="${1:-functional-fast}"
case "$gate" in
  functional-fast|functional-full|functional-extended) ;;
  *)
    printf 'Usage: %s [functional-fast|functional-full|functional-extended]\n' "$0" >&2
    exit 2
    ;;
esac

report_path="test-results/functional-playwright-results.xml"
owners=(FUNC-AUTHZ-001 FUNC-AUTHZ-002)

fail_report() {
  printf 'FCI-07 owner validation failed: %s\n' "$1" >&2
  return 1
}

validate_owner_report() {
  local owner="$1"
  [[ -s "$report_path" ]] || fail_report "JUnit report is missing for $owner"

  node - "$report_path" "$owner" <<'NODE'
const { readFileSync } = require('node:fs');

const [, , reportPath, owner] = process.argv;
const report = readFileSync(reportPath, 'utf8');
const testcases = report.match(/<testcase\b[\s\S]*?(?:<\/testcase>|\/>)/gu) ?? [];

if (testcases.length !== 1) {
  throw new Error(`${owner} selected ${testcases.length} testcases; expected exactly 1`);
}

const testcase = testcases[0];
if (!testcase.includes(owner)) {
  throw new Error(`${owner} is not bound to the selected testcase`);
}

if (/<(?:skipped|failure|error)\b/iu.test(testcase)) {
  throw new Error(`${owner} testcase was skipped, failed, or errored`);
}

process.stdout.write(`FCI-07 owner report validated for ${owner}.\n`);
NODE
}

run_owner() {
  local owner="$1"
  rm -f "$report_path"
  printf 'FCI-07: executing required owner %s at gate %s\n' "$owner" "$gate"
  node scripts/ci/run-functional-playwright.mjs \
    --gate "$gate" \
    --domain security-negative \
    --negative-authz \
    --journey "$owner" \
    -- \
    --project=functional-chromium \
    --workers=1 \
    --retries=0
  validate_owner_report "$owner"
}

for owner in "${owners[@]}"; do
  run_owner "$owner"
done

printf 'FCI-07: all required authorization-negative owners passed.\n'
