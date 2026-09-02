#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

echo "== Toolchain policy =="
node scripts/ci/verify-node-toolchain.mjs

echo "== .NET restore =="
dotnet restore AipPortal.slnx --disable-parallel --verbosity normal

echo "== .NET build =="
dotnet build AipPortal.slnx \
  --configuration Release \
  --no-restore \
  --disable-build-servers \
  -m:1

echo "== .NET tests =="
dotnet test AipPortal.slnx \
  --configuration Release \
  --no-build \
  --disable-build-servers \
  -m:1 \
  --verbosity normal

echo "== Frontend dependencies =="
npm --prefix frontend ci

echo "== Frontend production build =="
npm --prefix frontend run build

echo "== Frontend unit tests =="
npm --prefix frontend test
