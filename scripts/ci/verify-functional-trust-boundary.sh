#!/usr/bin/env bash
set -Eeuo pipefail

workflow="${1:-.github/workflows/licensed-real-backend-acceptance.yml}"

fail() {
  printf 'Functional license trust-boundary verification failed: %s\n' "$1" >&2
  exit 1
}

require_literal() {
  local value="$1"
  grep -Fq -- "$value" "$workflow" || fail "missing required invariant: $value"
}

[[ -f "$workflow" ]] || fail "workflow file not found: $workflow"

require_literal '  workflow_dispatch:'
require_literal '  push:'
if grep -Eq '^[[:space:]]{2}(pull_request|pull_request_target):' "$workflow"; then
  fail 'secret-bearing licensed workflow must not run on pull_request or pull_request_target'
fi
require_literal 'environment: syncfusion-licensed-build'
require_literal 'SYNCFUSION_LICENSE: ${{ secrets.SYNCFUSION_LICENSE }}'
require_literal 'ref: ${{ github.sha }}'
require_literal 'persist-credentials: false'
require_literal 'name: Checkout reviewed commit'

printf 'Functional license trust-boundary verification passed for %s.\n' "$workflow"
