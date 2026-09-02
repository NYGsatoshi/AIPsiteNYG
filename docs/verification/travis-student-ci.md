# Travis Student CI migration

## Purpose

Travis CI is the canonical hosted CI compute provider for AIPsiteNYG. The
initial additive Travis rollout has been replaced by provider-owned build,
test, security, browser, MBJ, and WPC verification so the same work is not
also executed by GitHub Actions.

## Environment

- Ubuntu 24.04 (`noble`)
- Node.js 24
- npm 11.17.0
- .NET SDK 10.0.302
- Docker / Docker Compose
- PostgreSQL 18 Alpine

`ConnectionStrings__DefaultConnection` and `POSTGRES_TEST_CONNECTION_STRING`
point to the isolated PostgreSQL 18 service used by the backend Travis job, so
conditional PostgreSQL tests cannot silently pass without provider execution.

## Job split

The Student plan is expected to serialize jobs. The repository therefore uses
separate provider jobs rather than one oversized full-stack command:

| Travis stage | Responsibility |
| --- | --- |
| `preflight` | toolchain, lockfile/install policy, documentation integrity |
| `backend` | Release build, migrations, full PostgreSQL suite, PR07/WPC manifests |
| `frontend` | lint/type/architecture, Angular, Storybook, static Playwright |
| `security` | Gitleaks, npm/NuGet checks, Compose/migration, image/Trivy |
| `acceptance` | P0, My Tasks, MBJ-02, MBJ-03 real-backend suites |
| `manual` | MBJ-01, general real-backend smoke, Qodana API-triggered suites |

Each former specialized PostgreSQL workflow is represented by the full backend
TRX plus its existing required-test manifest. This preserves the proof that the
named acceptance tests actually executed while avoiding a second build/restore
of the same commit.

## Repository entry points

- `.travis.yml`
- `scripts/ci/run-travis-preflight.sh`
- `scripts/ci/run-travis-backend.sh`
- `scripts/ci/run-travis-frontend.sh`
- `scripts/ci/run-travis-security.sh`
- `scripts/ci/run-travis-acceptance.sh`
- `scripts/ci/run-travis-qodana.sh`
- `scripts/ci/validate-documentation.sh`
- `scripts/ci/wait-for-travis-postgres.sh`

The initial `scripts/ci/run-travis-core.sh` compatibility entry point is
removed because backend and frontend work now have separate timeout domains.

## Required Travis secrets

Configure these in Travis, never in source control:

- `SYNCFUSION_LICENSE` — required by licensed Docker/real-backend acceptance.
- `QODANA_TOKEN` — required only for `MANUAL_TRAVIS_SUITE=qodana`.

A missing required secret is a hard failure for the corresponding Travis job;
the migration does not silently downgrade a licensed acceptance gate.

## GitHub Actions boundary

Normal CI workflows were removed to prevent duplicate execution. GitHub-native
dependency submission, the protected public-HTTPS gate, and the PR445 baseline
maintenance tool remain outside Travis for their provider-specific purposes.

Branch protection is configured outside the repository. Old required GitHub
Actions check names must be replaced with the Travis status after merge.
