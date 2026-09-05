#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <source-kind: dir|docker> <target> <output-directory>" >&2
  exit 2
fi

source_kind="$1"
target="$2"
out_dir="$3"

case "$source_kind" in
  dir|docker) ;;
  *) echo "unsupported Syft source kind: $source_kind" >&2; exit 2 ;;
esac

command -v syft >/dev/null 2>&1 || {
  echo "Syft is not installed." >&2
  exit 1
}

mkdir -p "$out_dir"
cdx="$out_dir/sbom.cyclonedx.json"
spdx="$out_dir/sbom.spdx.json"
rm -f "$cdx" "$spdx"

export SYFT_CHECK_FOR_APP_UPDATE=false
export SYFT_QUIET=true

syft scan "$target" \
  --from "$source_kind" \
  --parallelism 1 \
  --output "cyclonedx-json=$cdx" \
  --output "spdx-json=$spdx"

test -s "$cdx" || { echo "CycloneDX SBOM is missing or empty." >&2; exit 1; }
test -s "$spdx" || { echo "SPDX SBOM is missing or empty." >&2; exit 1; }
PYTHON_BIN="${PYTHON_BIN:-python3}"
"$PYTHON_BIN" -m json.tool "$cdx" >/dev/null
"$PYTHON_BIN" -m json.tool "$spdx" >/dev/null
