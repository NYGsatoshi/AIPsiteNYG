#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <working-directory> [npm-ci-arguments...]" >&2
  exit 2
fi

working_directory="$1"
shift
attempts="${NPM_CI_ATTEMPTS:-2}"
retry_delay_seconds="${NPM_CI_RETRY_DELAY_SECONDS:-10}"

if ! [[ "$attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "NPM_CI_ATTEMPTS must be a positive integer." >&2
  exit 2
fi

for ((attempt = 1; attempt <= attempts; attempt++)); do
  echo "npm ci attempt ${attempt}/${attempts} in ${working_directory}"

  set +e
  (
    cd "$working_directory"
    npm ci --no-audit --no-fund "$@"
  )
  status=$?
  set -e

  if (( status == 0 )); then
    exit 0
  fi

  if (( attempt == attempts )); then
    echo "npm ci failed after ${attempts} attempt(s)." >&2
    exit "$status"
  fi

  echo "npm ci failed with exit code ${status}; collecting host diagnostics before retry." >&2
  df -h || true
  df -i || true
  free -h || true
  docker system df || true
  (
    cd "$working_directory"
    npm cache verify
  ) || true
  sleep "$retry_delay_seconds"
done
