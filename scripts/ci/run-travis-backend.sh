#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

mode="${1:-all}"

export ASPNETCORE_ENVIRONMENT="Test"
export POSTGRES_DB="aip_portal_ci"
export POSTGRES_USER="aip_portal_ci"
export POSTGRES_PASSWORD="aip_portal_ci_password"
export POSTGRES_DEV_HOST_PORT="5433"
postgres_connection_string="Host=localhost;Port=${POSTGRES_DEV_HOST_PORT};Database=${POSTGRES_DB};Username=${POSTGRES_USER};Password=${POSTGRES_PASSWORD}"
export ConnectionStrings__DefaultConnection="$postgres_connection_string"
export POSTGRES_TEST_CONNECTION_STRING="$postgres_connection_string"

postgres_started=false
cleanup() {
  if [[ "$postgres_started" == "true" ]]; then
    docker compose -f docker-compose.db.yml down -v || true
  fi
}
trap cleanup EXIT

setup_postgres() {
  echo "== PostgreSQL 18 =="
  docker compose -f docker-compose.db.yml config --quiet
  docker compose -f docker-compose.db.yml up -d
  postgres_started=true
  bash scripts/ci/wait-for-travis-postgres.sh

  test "${ConnectionStrings__DefaultConnection}" = "${POSTGRES_TEST_CONNECTION_STRING}"
  docker compose -f docker-compose.db.yml exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'select 1' | grep -qx '1'
  echo "PostgreSQL connection probe passed."
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
