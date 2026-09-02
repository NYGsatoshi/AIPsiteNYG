#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

cleanup() {
  docker compose -f docker-compose.db.yml down -v || true
}
trap cleanup EXIT

echo "== PostgreSQL 18 =="
docker compose -f docker-compose.db.yml up -d
bash scripts/ci/wait-for-travis-postgres.sh

mkdir -p artifacts/test-results artifacts/ci

echo "== Restore =="
dotnet restore AipPortal.slnx --disable-parallel --verbosity normal

echo "== Release build =="
dotnet build AipPortal.slnx \
  --configuration Release \
  --no-restore \
  --disable-build-servers \
  -m:1

echo "== EF Core migration gate =="
dotnet tool restore
dotnet ef database update \
  --project src/AipPortal.Infrastructure \
  --startup-project src/AipPortal.Web \
  --configuration Release

dotnet ef migrations has-pending-model-changes \
  --project src/AipPortal.Infrastructure \
  --startup-project src/AipPortal.Web \
  --configuration Release \
  --no-build

echo "== Full backend + PostgreSQL test suite =="
dotnet test AipPortal.slnx \
  --configuration Release \
  --no-build \
  --disable-build-servers \
  -m:1 \
  --verbosity normal \
  --logger "trx;LogFileName=backend-tests.trx" \
  --results-directory artifacts/test-results

trx="artifacts/test-results/backend-tests.trx"

bash scripts/ci/verify-trx-results.sh \
  "$trx" \
  --minimum-total 1 \
  --label "Travis full backend"

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
