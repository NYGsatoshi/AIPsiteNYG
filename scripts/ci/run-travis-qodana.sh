#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

test -n "${QODANA_TOKEN:-}" || {
  echo "QODANA_TOKEN must be configured as a protected Travis environment variable." >&2
  exit 1
}

results_dir="$PWD/artifacts/qodana"
rm -rf "$results_dir"
mkdir -p "$results_dir"

echo "== Qodana Community for .NET =="
docker run --rm --privileged \
  -v "$PWD:/data/project" \
  -v "$results_dir:/data/results" \
  -e QODANA_TOKEN \
  jetbrains/qodana-cdnet:2026.1-eap-privileged \
  --solution AipPortal.slnx \
  --configuration Release

sarif="$(find "$results_dir" -name 'qodana.sarif.json' -print -quit)"
test -n "$sarif" && test -f "$sarif" || {
  echo "Qodana completed without the required SARIF result." >&2
  find "$results_dir" -maxdepth 3 -type f -print || true
  exit 1
}

echo "== Qodana project-model guard =="
QODANA_PROJECT_MODEL_SUMMARY_PATH="$results_dir/project-model-summary.json" \
  node scripts/quality/check-qodana-project-model.mjs "$sarif"
