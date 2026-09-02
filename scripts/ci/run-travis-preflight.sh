#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

echo "== Node toolchain policy =="
node scripts/ci/verify-node-toolchain.mjs

echo "== npm lockfile supply-chain policy =="
while IFS= read -r -d '' lockfile; do
  package_dir="$(dirname "$lockfile")"
  node scripts/ci/verify-npm-lockfile.mjs "$package_dir"
done < <(find . -name package-lock.json -not -path '*/node_modules/*' -print0 | sort -z)

echo "== npm install policy =="
bash scripts/ci/npm-ci-retry.sh .
bash scripts/ci/npm-ci-retry.sh frontend
if [[ -f aipsite-frontend/package.json && -f aipsite-frontend/package-lock.json ]]; then
  bash scripts/ci/npm-ci-retry.sh aipsite-frontend
fi

echo "== Real-backend P0 manifest/runner preflight =="
node --test \
  tests/ui/build-playwright-grep.node-test.mjs \
  tests/ui/verify-playwright-required-tests.node-test.mjs \
  tests/ui/real-backend-smoke-compose-helpers.node-test.mjs

node --check tests/ui/prepare-real-backend-p0-state.mjs
node --check tests/ui/real-backend-smoke-compose-helpers.mjs
node --check tests/ui/run-real-backend-p0.mjs
node --check tests/ui/run-real-backend-playwright.mjs
node --check tests/ui/run-real-backend-smoke-compose.mjs

grep_pattern="$(
  node scripts/ci/build-playwright-grep.mjs \
    scripts/ci/real-backend-pr-p0-required-tests.txt \
    --verify tests/ui/real-backend-smoke.spec.ts
)"
test -n "$grep_pattern"

echo "== Documentation integrity =="
bash scripts/ci/validate-documentation.sh
