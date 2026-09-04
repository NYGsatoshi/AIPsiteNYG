#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.performance.yml"
PROFILE="${AIP_PERFORMANCE_PROFILE:-small}"
PORT="${AIP_PERFORMANCE_PORT:-18080}"
RUN_TOKEN="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}"
PROJECT="${AIP_PERFORMANCE_COMPOSE_PROJECT:-aipsite-performance-${RUN_TOKEN}}"
EVIDENCE_DIR="${AIP_PERFORMANCE_EVIDENCE_DIR:-$ROOT/artifacts/performance/${PROFILE}}"
BASE_URL="http://127.0.0.1:${PORT}"
STARTUP_TIMEOUT="${AIP_PERFORMANCE_STARTUP_TIMEOUT_SECONDS:-420}"
COMMAND_TIMEOUT="${AIP_PERFORMANCE_COMMAND_TIMEOUT_SECONDS:-900}"

case "$PROFILE" in
  small|medium|large) ;;
  *) echo "PERF-02: AIP_PERFORMANCE_PROFILE must be small, medium, or large" >&2; exit 2 ;;
esac
case "$PROJECT" in
  aipsite-performance-*) ;;
  *) echo "PERF-02: Compose project must start with aipsite-performance-" >&2; exit 2 ;;
esac
if [[ -z "${SYNCFUSION_LICENSE:-}" ]]; then
  echo "PERF-02: SYNCFUSION_LICENSE is required to build the production Angular image" >&2
  exit 2
fi
if [[ -z "${AIP_PERFORMANCE_PASSWORD:-}" ]]; then
  echo "PERF-02: AIP_PERFORMANCE_PASSWORD is required" >&2
  exit 2
fi
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "PERF-02: Docker Compose is required" >&2
  exit 2
fi
if ! command -v python3 >/dev/null; then
  echo "PERF-02: python3 is required" >&2
  exit 2
fi

export AIP_PERFORMANCE_PROFILE="$PROFILE"
export AIP_PERFORMANCE_PORT="$PORT"
export AIP_PERFORMANCE_EVIDENCE_DIR="$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"
rm -f \
  "$EVIDENCE_DIR/fixture.json" \
  "$EVIDENCE_DIR/preflight.json" \
  "$EVIDENCE_DIR/warmup.json" \
  "$EVIDENCE_DIR/environment.json"

compose() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  local exit_code=$?
  set +e
  compose down --volumes --remove-orphans >/dev/null 2>&1
  set -e
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Repeated local runs cannot inherit database/container state.
compose down --volumes --remove-orphans >/dev/null 2>&1 || true
compose config >/dev/null

# Build the browser image now so its immutable identity/version is fingerprinted.
compose build performance-browser
compose up -d --build postgres migrate app

deadline=$((SECONDS + STARTUP_TIMEOUT))
while (( SECONDS < deadline )); do
  if [[ -s "$EVIDENCE_DIR/fixture.json" ]] && \
     curl --fail --silent --show-error --max-time 5 "$BASE_URL/health/ready" >/dev/null 2>&1; then
    break
  fi
  if [[ "$(compose ps -a --status exited -q app | wc -l | tr -d ' ')" != "0" ]]; then
    echo "PERF-02: application exited before becoming healthy" >&2
    compose logs --no-color app >&2 || true
    exit 2
  fi
  sleep 2
done
if [[ ! -s "$EVIDENCE_DIR/fixture.json" ]]; then
  echo "PERF-02: fixture evidence was not produced before startup timeout" >&2
  compose logs --no-color app >&2 || true
  exit 2
fi
if ! curl --fail --silent --show-error --max-time 5 "$BASE_URL/health/ready" >/dev/null; then
  echo "PERF-02: application did not become healthy before startup timeout" >&2
  compose logs --no-color app >&2 || true
  exit 2
fi

python3 "$ROOT/scripts/performance/preflight.py" \
  --base-url "$BASE_URL" \
  --profile "$PROFILE" \
  --fixture-evidence "$EVIDENCE_DIR/fixture.json" \
  --output "$EVIDENCE_DIR/preflight.json"

python3 "$ROOT/scripts/performance/warmup.py" \
  --base-url "$BASE_URL" \
  --profile "$PROFILE" \
  --fixture-evidence "$EVIDENCE_DIR/fixture.json" \
  --output "$EVIDENCE_DIR/warmup.json"

python3 "$ROOT/scripts/performance/collect-environment.py" \
  --compose-project "$PROJECT" \
  --compose-file "$COMPOSE_FILE" \
  --profile "$PROFILE" \
  --fixture-evidence "$EVIDENCE_DIR/fixture.json" \
  --output "$EVIDENCE_DIR/environment.json"

export AIP_PERFORMANCE_BASE_URL="$BASE_URL"
export AIP_PERFORMANCE_FIXTURE_EVIDENCE="$EVIDENCE_DIR/fixture.json"
export AIP_PERFORMANCE_PREFLIGHT_EVIDENCE="$EVIDENCE_DIR/preflight.json"
export AIP_PERFORMANCE_WARMUP_EVIDENCE="$EVIDENCE_DIR/warmup.json"
export AIP_PERFORMANCE_ENVIRONMENT_EVIDENCE="$EVIDENCE_DIR/environment.json"

if (( $# > 0 )); then
  set +e
  timeout --preserve-status "$COMMAND_TIMEOUT" "$@"
  command_status=$?
  set -e
  if (( command_status != 0 )); then
    if (( command_status == 124 )); then
      echo "PERF-02: benchmark command timed out" >&2
    else
      echo "PERF-02: benchmark command exited with status $command_status" >&2
    fi
    exit "$command_status"
  fi
fi

if [[ -n "${AIP_PERFORMANCE_RESULTS_FILE:-}" ]]; then
  python3 "$ROOT/scripts/performance/verify-samples.py" \
    --results "$AIP_PERFORMANCE_RESULTS_FILE"
fi

echo "PERF-02 environment completed; evidence: $EVIDENCE_DIR"
