# Travis Student CI lane

## Purpose

Travis CI provides an additional hosted Linux lane for expensive serial checks so
GitHub Actions and the self-hosted runner do not need to own every full-stack
verification run.

This lane is additive. It does not replace the routed GitHub Actions gates or
change their branch-protection semantics.

## Environment

- Ubuntu 24.04 (`noble`)
- Node.js 24
- npm 11.17.0
- .NET SDK 10.0.302 installed from `global.json` policy
- Docker / Docker Compose
- PostgreSQL 18 Alpine from `docker-compose.db.yml`

The Travis configuration sets both `ConnectionStrings__DefaultConnection` and
`POSTGRES_TEST_CONNECTION_STRING` to the isolated CI PostgreSQL container so
conditional PostgreSQL tests execute instead of returning early.

## Entry points

- `.travis.yml`: Travis environment and lifecycle.
- `scripts/ci/wait-for-travis-postgres.sh`: bounded PostgreSQL readiness check.
- `scripts/ci/run-travis-core.sh`: repository-owned core verification sequence.

The core sequence runs:

```text
node scripts/ci/verify-node-toolchain.mjs
dotnet restore AipPortal.slnx --disable-parallel --verbosity normal
dotnet build AipPortal.slnx --configuration Release --no-restore --disable-build-servers -m:1
dotnet test AipPortal.slnx --configuration Release --no-build --disable-build-servers -m:1 --verbosity normal
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend test
```

## Scope

Playwright, real-backend smoke, and specialized acceptance workflows remain on
their existing lanes for the initial Travis rollout. They can be migrated only
after the core Travis lane is observed green and its runtime is known to remain
comfortably below the provider job timeout.
