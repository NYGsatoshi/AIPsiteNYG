#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <working-directory> [npm-ci-arguments...]" >&2
  exit 2
fi

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
working_directory="$1"
shift
attempts="${NPM_CI_ATTEMPTS:-2}"
retry_delay_seconds="${NPM_CI_RETRY_DELAY_SECONDS:-10}"

if ! [[ "$attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "NPM_CI_ATTEMPTS must be a positive integer." >&2
  exit 2
fi

if [[ ! -f "$working_directory/package.json" || ! -f "$working_directory/package-lock.json" ]]; then
  echo "package.json and package-lock.json are required in $working_directory." >&2
  exit 2
fi

npm_version="$(npm --version)"
IFS=. read -r npm_major npm_minor _ <<< "$npm_version"
if ! [[ "$npm_major" =~ ^[0-9]+$ && "$npm_minor" =~ ^[0-9]+$ ]]; then
  echo "Unable to parse npm version: $npm_version" >&2
  exit 2
fi
if (( npm_major < 11 || (npm_major == 11 && npm_minor < 16) )); then
  echo "npm 11.16.0 or newer is required for strict install-script policy; found $npm_version." >&2
  exit 2
fi

# actions/checkout persists a temporary credential in the local git config by
# default. Remove it before any dependency lifecycle script can execute.
git -C "$working_directory" config --local --unset-all \
  http.https://github.com/.extraheader 2>/dev/null || true

secure_temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
secure_cache="$secure_temp_root/npm-cache-${GITHUB_RUN_ID:-local}-${GITHUB_JOB:-job}-${GITHUB_RUN_ATTEMPT:-1}"
secure_userconfig="$secure_temp_root/npm-userconfig-${GITHUB_RUN_ID:-local}-${GITHUB_JOB:-job}-${GITHUB_RUN_ATTEMPT:-1}.npmrc"
mkdir -p "$secure_cache"
: > "$secure_userconfig"
chmod 600 "$secure_userconfig"

export NPM_CONFIG_CACHE="$secure_cache"
export NPM_CONFIG_USERCONFIG="$secure_userconfig"
export NPM_CONFIG_REGISTRY="https://registry.npmjs.org/"
export NPM_CONFIG_STRICT_ALLOW_SCRIPTS="true"
export NPM_CONFIG_ALLOW_GIT="none"
export NPM_CONFIG_ALLOW_REMOTE="none"
export NPM_CONFIG_PREFER_OFFLINE="false"
export NPM_CONFIG_AUDIT="false"
export NPM_CONFIG_FUND="false"

node "$script_directory/verify-npm-lockfile.mjs" "$working_directory"

for ((attempt = 1; attempt <= attempts; attempt++)); do
  echo "npm ci attempt ${attempt}/${attempts} in ${working_directory} with npm ${npm_version}"

  set +e
  (
    cd "$working_directory"
    npm ci \
      --prefer-online \
      --strict-allow-scripts \
      --allow-git=none \
      --allow-remote=none \
      --no-audit \
      --no-fund \
      "$@"
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
  npm cache verify || true
  sleep "$retry_delay_seconds"
done
