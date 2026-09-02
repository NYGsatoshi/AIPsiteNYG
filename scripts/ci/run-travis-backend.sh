#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

mode="${1:-all}"

export ASPNETCORE_ENVIRONMENT="Test"
export POSTGRES_DB="aip_portal_ci"
export POSTGRES_USER="aip_portal_ci"
export POSTGRES_PASSWORD="aip_portal_ci_password"

postgres_container=""
cleanup() {
  if [[ -n "$postgres_container" ]]; then
    docker rm --force "$postgres_container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

setup_postgres() {
  echo "== PostgreSQL 18 =="
  postgres_container="aipsite-travis-pg-${TRAVIS_JOB_ID:-$$}"

  # GitHub Actions used an automatically assigned service port. Do the same on
  # Travis instead of assuming that host port 5433 is free on the worker VM.
  docker run --detach \
    --name "$postgres_container" \
    --publish 127.0.0.1::5432 \
    --env "POSTGRES_DB=$POSTGRES_DB" \
    --env "POSTGRES_USER=$POSTGRES_USER" \
    --env "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
    --health-cmd "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB" \
    --health-interval 5s \
    --health-timeout 5s \
    --health-retries 20 \
    --health-start-period 5s \
    postgres:18-alpine >/dev/null

  for attempt in $(seq 1 30); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$postgres_container")"
    if [[ "$status" == "healthy" ]]; then
      break
    fi
    echo "Waiting for PostgreSQL ($attempt/30): $status"
    sleep 2
  done

  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$postgres_container")"
  if [[ "$status" != "healthy" ]]; then
    echo "PostgreSQL did not become healthy: $status" >&2
    docker logs "$postgres_container" >&2 || true
    exit 1
  fi

  port_binding="$(docker port "$postgres_container" 5432/tcp | head -n 1)"
  postgres_port="${port_binding##*:}"
  if [[ ! "$postgres_port" =~ ^[0-9]+$ ]]; then
    echo "Unable to resolve PostgreSQL host port from: $port_binding" >&2
    docker port "$postgres_container" >&2 || true
    exit 1
  fi

  postgres_connection_string="Host=127.0.0.1;Port=${postgres_port};Database=${POSTGRES_DB};Username=${POSTGRES_USER};Password=${POSTGRES_PASSWORD}"
  export ConnectionStrings__DefaultConnection="$postgres_connection_string"
  export POSTGRES_TEST_CONNECTION_STRING="$postgres_connection_string"

  docker exec "$postgres_container" \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'select 1' | grep -qx '1'
  echo "PostgreSQL connection probe passed on an ephemeral host port."
}

restore_build() {
  mkdir -p artifacts/test-results artifacts/ci
  echo "== Restore =="
  dotnet restore AipPortal.slnx --disable-parallel --verbosity normal

  echo "== Release build =="
  dotnet build AipPortal.slnx \
    --configuration Release \
    --no-restore \
    --disable-build-servers \
    -m:1
}

apply_schema() {
  echo "== Apply PostgreSQL schema =="
  dotnet tool restore
  dotnet ef database update \
    --project src/AipPortal.Infrastructure \
    --startup-project src/AipPortal.Web \
    --configuration Release \
    --no-build
}

run_ef_gate() {
  apply_schema
  echo "== EF Core pending-model gate =="
  dotnet ef migrations has-pending-model-changes \
    --project src/AipPortal.Infrastructure \
    --startup-project src/AipPortal.Web \
    --configuration Release \
    --no-build
}

run_full_tests() {
  apply_schema
  echo "== Full backend + PostgreSQL test suite =="
  dotnet test AipPortal.slnx \
    --configuration Release \
    --no-build \
    --disable-build-servers \
    -m:1 \
    --verbosity normal \
    --logger "trx;LogFileName=backend-tests.trx" \
    --results-directory artifacts/test-results

  bash scripts/ci/verify-trx-results.sh \
    artifacts/test-results/backend-tests.trx \
    --minimum-total 1 \
    --label "Travis full backend"
}

run_required_gates() {
  apply_schema
  echo "== PR07 + WPC focused required-test run =="
  gate_filter='Scope=TaskV1PR07B|Scope=TaskV1PR07C|Scope=TaskV1PR07D|Scope=WPC02A|Scope=WPC02B|Scope=WPC02C|Scope=WPC02D|Scope=WPC02E|Scope=WPC02F|Scope=WPCFINAL01|Scope=WPCFinal02|Scope=WPCFinal03|FullyQualifiedName~Wpc02AWorkspaceAuthorizationTests|FullyQualifiedName~CanonicalRedactionServiceTests'

  dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj \
    --configuration Release \
    --no-build \
    --disable-build-servers \
    -m:1 \
    --verbosity normal \
    --filter "$gate_filter" \
    --logger "trx;LogFileName=backend-gates.trx" \
    --results-directory artifacts/test-results

  trx="artifacts/test-results/backend-gates.trx"
  bash scripts/ci/verify-trx-results.sh "$trx" --minimum-total 1 --label "Travis focused backend gates"

  for gate in b c d; do
    bash scripts/ci/verify-trx-results.sh \
      "$trx" \
      --minimum-total 1 \
      --required-tests "scripts/ci/task-pr07${gate}-required-tests.txt" \
      --label "TASK-V1-PR07-${gate^^}"
  done

  bash scripts/ci/verify-wpc-final01-results.sh "$trx"

  bash scripts/ci/verify-trx-results.sh \
    "$trx" \
    --minimum-total 3 \
    --required-tests scripts/ci/wpc-final02-migration-required-tests.txt \
    --label "WPC-Final02 migration and legacy compatibility"

  bash scripts/ci/verify-trx-results.sh \
    "$trx" \
    --minimum-total 17 \
    --required-tests scripts/ci/wpc-final03-required-tests.txt \
    --label "WPC-Final03 Security"
}

case "$mode" in
  build)
    restore_build
    ;;
  ef)
    setup_postgres
    restore_build
    run_ef_gate
    ;;
  tests)
    setup_postgres
    restore_build
    run_full_tests
    ;;
  gates)
    setup_postgres
    restore_build
    run_required_gates
    ;;
  all)
    setup_postgres
    restore_build
    run_ef_gate
    run_full_tests
    run_required_gates
    ;;
  *)
    echo "Unknown Travis backend mode: $mode" >&2
    exit 2
    ;;
esac
