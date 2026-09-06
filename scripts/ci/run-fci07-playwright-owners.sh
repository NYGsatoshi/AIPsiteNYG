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
  grep -Fq "$owner" "$report_path" || fail_report "JUnit report does not contain $owner"

  local testcase_count
  testcase_count="$(awk '
    {
      line = $0
      while (match(line, /<testcase([ >])/)) {
        count += 1
        line = substr(line, RSTART + RLENGTH)
      }
    }
    END { print count + 0 }
  ' "$report_path")"
  [[ "$testcase_count" -eq 1 ]] || fail_report "$owner selected $testcase_count testcases; expected exactly 1"

  if grep -Eq '(<skipped([[:space:]/>])|skipped="[1-9][0-9]*"|failures="[1-9][0-9]*"|errors="[1-9][0-9]*")' "$report_path"; then
    fail_report "$owner was skipped, failed, or errored"
  fi
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
