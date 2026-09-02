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

The backend Travis entry point owns its PostgreSQL environment locally inside
the shell process. Connection strings are assembled after startup rather than
serialized through Travis YAML, because the semicolon-delimited .NET connection
string must remain one shell value. A `psql select 1` probe fails the job before
EF or xUnit if the database/user/port contract is not actually usable.

## Job split

The Student plan serializes jobs. Backend verification is deliberately split
into separate failure domains so provider summaries identify whether a failure
belongs to compilation, EF/PostgreSQL, the full suite, or required acceptance
gates without requiring access to private Travis job logs.

| Travis stage | Responsibility |
| --- | --- |
| `preflight` | toolchain, lockfile/install policy, documentation integrity |
| `backend-build` | exact restore and Release solution build |
| `backend-ef` | PostgreSQL 18 probe, migration apply, pending-model check |
| `backend-tests` | full backend suite with real PostgreSQL |
| `backend-gates` | focused PR07/WPC acceptance run plus required-test manifests |
| `frontend` | lint/type/architecture, Angular, Storybook, static Playwright |
| `security` | Gitleaks, npm/NuGet checks, Compose/migration, image/Trivy |
| `acceptance` | P0, My Tasks, MBJ-02, MBJ-03 real-backend suites |
| `manual` | MBJ-01, general real-backend smoke, Qodana API-triggered suites |

The required-test manifests are checked against a dedicated focused backend
TRX. The ordinary full-suite job is therefore a pure full-suite result and a
manifest mismatch cannot disguise itself as an application-test failure.

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
