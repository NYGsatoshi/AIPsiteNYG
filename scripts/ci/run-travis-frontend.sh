#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

is_dependabot() {
  [[ "${TRAVIS_PULL_REQUEST_BRANCH:-}" == dependabot/* ]]
}

echo "== Repository test dependencies =="
bash scripts/ci/npm-ci-retry.sh .

echo "== Angular dependencies =="
bash scripts/ci/npm-ci-retry.sh frontend

echo "== Frontend inspection toolchain =="
for attempt in 1 2; do
  if npm --prefix tools/frontend-inspections install \
    --prefer-online \
    --ignore-scripts \
    --no-audit \
    --no-fund; then
    break
  fi
  [[ "$attempt" -lt 2 ]] || exit 1
  sleep 10
done

mkdir -p artifacts/frontend-inspections
printf '{"status":"inspection-started","provider":"travis"}\n' \
  > artifacts/frontend-inspections/ci-manifest.json

echo "== Frontend inspection inventory =="
npm run lint:frontend

echo "== TypeScript application model =="
(
  cd frontend
  ./node_modules/.bin/tsc --noEmit --project tsconfig.app.json
)

echo "== Architecture checks =="
npm --prefix frontend run check:architecture
npm --prefix frontend run test:architecture

echo "== Syncfusion license guard tests =="
npm --prefix frontend run test:syncfusion-license

if is_dependabot; then
  echo "Dependabot trust boundary: protected Syncfusion license is not required for compilation."
else
  test -n "${SYNCFUSION_LICENSE:-}" || {
    echo "SYNCFUSION_LICENSE must be configured as a protected Travis environment variable." >&2
    exit 1
  }
  echo "== Syncfusion license activation =="
  (
    cd frontend
    test -x node_modules/.bin/syncfusion-license
    npm run syncfusion:activate
  )
fi

echo "== Angular production build =="
npm --prefix frontend run build

echo "== Angular unit tests =="
npm --prefix frontend test

echo "== Storybook build =="
npm --prefix frontend run build-storybook

echo "== Authoritative Linux static Playwright =="
AIP_PLAYWRIGHT_REUSE_HOST_BUILD=true npm run test:ui:angular:docker
