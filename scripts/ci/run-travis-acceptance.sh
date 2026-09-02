#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

suite="${1:-}"
if [[ -z "$suite" ]]; then
  echo "usage: $0 <real-backend-p0|real-backend-my-tasks|mbj01|mbj02|mbj03|real-backend-smoke>" >&2
  exit 2
fi

echo "== Acceptance dependencies =="
bash scripts/ci/npm-ci-retry.sh .

is_dependabot() {
  [[ "${TRAVIS_PULL_REQUEST_BRANCH:-}" == dependabot/* ]]
}

require_license() {
  test -n "${SYNCFUSION_LICENSE:-}" || {
    echo "SYNCFUSION_LICENSE must be configured as a protected Travis environment variable for $suite." >&2
    exit 1
  }
}

if is_dependabot; then
  echo "Dependabot trust boundary: validating acceptance wiring without protected license material."
  case "$suite" in
    real-backend-p0)
      node --check tests/ui/prepare-real-backend-p0-state.mjs
      node --check tests/ui/run-real-backend-p0.mjs
      node --check tests/ui/run-real-backend-smoke-compose.mjs
      SYNCFUSION_LICENSE=ci_config_validation_only \
        docker compose -p aipsite-dependabot-p0 -f docker-compose.real-backend-smoke.yml config --quiet
      ;;
    real-backend-my-tasks)
      node --check tests/ui/run-real-backend-my-tasks.mjs
      SYNCFUSION_LICENSE=ci_config_validation_only \
        docker compose -p aipsite-dependabot-my-tasks -f docker-compose.real-backend-smoke.yml config --quiet
      ;;
    mbj02)
      bash -n scripts/ci/run-mbj02-invite-acceptance.sh
      node --check tests/ui/mbj02-invite-acceptance.mjs
      SYNCFUSION_LICENSE=ci_config_validation_only \
        docker compose -p aipsite-dependabot-mbj02 -f docker-compose.real-backend-smoke.yml config --quiet
      ;;
    mbj03)
      bash -n scripts/ci/run-mbj03-session-acceptance.sh
      node --check tests/ui/mbj03-session-acceptance.mjs
      SYNCFUSION_LICENSE=ci_config_validation_only \
        docker compose -p aipsite-dependabot-mbj03 -f docker-compose.real-backend-smoke.yml config --quiet
      ;;
    *)
      echo "Manual suite $suite is not expected on a Dependabot PR." >&2
      exit 2
      ;;
  esac
  exit 0
fi

require_license
docker network prune --force || true

case "$suite" in
  real-backend-p0)
    node --check tests/ui/run-real-backend-p0.mjs
    node tests/ui/run-real-backend-p0.mjs
    ;;
  real-backend-my-tasks)
    node --check tests/ui/run-real-backend-my-tasks.mjs
    node tests/ui/run-real-backend-my-tasks.mjs
    ;;
  mbj01)
    bash -n scripts/ci/run-mbj01-bootstrap-acceptance.sh
    node --check tests/ui/mbj01-bootstrap-acceptance.mjs
    bash scripts/ci/run-mbj01-bootstrap-acceptance.sh
    ;;
  mbj02)
    bash -n scripts/ci/run-mbj02-invite-acceptance.sh
    node --check tests/ui/mbj02-invite-acceptance.mjs
    bash scripts/ci/run-mbj02-invite-acceptance.sh
    ;;
  mbj03)
    bash -n scripts/ci/run-mbj03-session-acceptance.sh
    node --check tests/ui/mbj03-session-acceptance.mjs
    bash scripts/ci/run-mbj03-session-acceptance.sh
    ;;
  real-backend-smoke)
    npm run test:ui:real-backend
    ;;
  *)
    echo "Unknown Travis acceptance suite: $suite" >&2
    exit 2
    ;;
esac
