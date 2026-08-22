#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf '%s\n' "Usage: $0 <wpc-test-results.trx>" >&2
}

if [[ "$#" -ne 1 ]]; then
  usage
  exit 2
fi

trx_file="$1"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
manifests=(
  "scripts/ci/wpc02a-required-tests.txt"
  "scripts/ci/wpc02b-required-tests.txt"
  "scripts/ci/wpc02c-required-tests.txt"
  "scripts/ci/wpc02d-required-tests.txt"
  "scripts/ci/wpc02e-required-tests.txt"
  "scripts/ci/wpc02f-required-tests.txt"
)

aggregate_manifest="$(mktemp)"
trap 'rm -f "$aggregate_manifest"' EXIT

for manifest in "${manifests[@]}"; do
  manifest_path="$repository_root/$manifest"
  if [[ ! -f "$manifest_path" ]]; then
    printf 'Required WPC manifest does not exist: %s\n' "$manifest" >&2
    exit 1
  fi

  awk '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      sub(/[[:space:]]+$/, "", line)
      if (line != "" && line !~ /^#/) {
        print line
      }
    }
  ' "$manifest_path" >> "$aggregate_manifest"
done

required_count="$(
  awk 'NF { count++ } END { print count + 0 }' "$aggregate_manifest"
)"

if [[ "$required_count" -eq 0 ]]; then
  printf '%s\n' "WPC-Final01 aggregate manifest contains no active test names." >&2
  exit 1
fi

printf 'Verifying %s required WPC test names from %s.\n' \
  "$required_count" \
  "$trx_file"

bash "$repository_root/scripts/ci/verify-trx-results.sh" \
  "$trx_file" \
  --minimum-total "$required_count" \
  --required-tests "$aggregate_manifest" \
  --label "WPC-Final01 canonical completion"
