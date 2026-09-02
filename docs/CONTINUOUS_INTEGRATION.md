# Continuous integration

Travis CI is the canonical continuous-integration compute provider for this
repository.

Normal pull-request and `main` push verification is defined by `.travis.yml`.
The Student plan provides one concurrent job, so the Travis build is intentionally
split into bounded jobs that execute serially instead of placing the entire
repository gate in one provider job.

## Automatic Travis gates

A normal Travis build runs:

1. **Preflight / policy**
   - Node/npm toolchain policy
   - npm lockfile and install policy
   - real-backend P0 manifest/helper/syntax preflight
   - Markdown UTF-8/conflict-marker validation
2. **Backend / PostgreSQL 18**
   - exact .NET SDK from `global.json`
   - restore and Release build
   - EF migration apply + pending-model gate
   - the full backend suite with `POSTGRES_TEST_CONNECTION_STRING`
   - TASK-V1 PR07 B/C/D required-test manifests
   - WPC-02A through WPC-02F / Final01 required-test manifests
   - WPC-Final02 migration/legacy required tests
   - WPC-Final03 security required tests
3. **Frontend / quality / static browser**
   - root and Angular dependency install
   - frontend inspection inventory and TypeScript validation
   - architecture and Syncfusion guard tests
   - protected Syncfusion activation for ordinary trusted builds
   - Angular production build and unit tests
   - Storybook build
   - authoritative Linux Docker Playwright static suite reusing the host build
4. **Security / dependencies / image**
   - Gitleaks
   - npm audit baseline
   - NuGet vulnerable/deprecated reports
   - Compose validation and on-prem migration smoke
   - licensed production image build
   - runtime secret-boundary assertion
   - Trivy HIGH/CRITICAL image gate
5. **Real-backend acceptance**
   - P0 real-backend browser acceptance
   - My Tasks real-backend acceptance
   - MBJ-02 invite onboarding
   - MBJ-03 session lifecycle

Dependabot pull requests retain a no-secret trust boundary: protected license
material is not required or exposed, while syntax/Compose wiring and filesystem
security checks still run.

The real-backend, ordinary frontend compilation, and licensed image jobs require
`SYNCFUSION_LICENSE` as a protected Travis environment variable for normal
trusted builds. Do not commit the license value.

## Manual Travis suites

Provider API builds can set `MANUAL_TRAVIS_SUITE` to one of:

- `mbj01` — fresh bootstrap acceptance
- `real-backend-smoke` — general real-backend browser smoke
- `qodana` — Qodana Community for .NET; requires protected `QODANA_TOKEN`

These replace the former manual GitHub Actions compute workflows.

## GitHub Actions exceptions

GitHub Actions is retained only where the workflow itself is GitHub-native or a
protected target-environment operation:

- `nuget-dependency-submission-self-hosted.yml` submits dependency metadata to
  GitHub's dependency graph.
- `public-https-golden-path.yml` is the protected public-HTTPS target-environment
  release gate.
- `refresh-pr445-mobile-baseline.yml` is a one-off maintenance tool, not a normal
  CI gate.

No normal build, test, npm audit, security image scan, Storybook, Playwright,
PostgreSQL acceptance, MBJ, WPC, documentation, or Qodana compute should run in
GitHub Actions after this migration.

## Merge policy

A pull request is ready to merge only after the Travis status for its current
head is successful, plus any explicitly required target-environment check.

Repository branch protection must not continue requiring deleted GitHub Actions
job names. After this migration is merged, remove obsolete Actions required
checks and require the Travis PR status instead.

The repository has no tracked Buildkite pipeline. If the external
`buildkite/aipsitenyg` GitHub integration is still enabled, it must be disabled
in the external integration to eliminate that separate duplicate compute; a
repository PR cannot turn off an account-level Buildkite webhook/integration.

Browser acceptance mocks must track canonical server command routes. When a
feature moves from a legacy direct command to a durable workflow, Playwright
must exercise the durable create and transition endpoints rather than preserving
the obsolete route in its fixture.
