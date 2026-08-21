# WPC-Final02 Canonical Completion Audit

Status: implementation integrated; Final02 acceptance gate pending this PR's CI result.

## Audited baselines

- Implementation repository: `NYGsatoshi/AIPsiteNYG`
- Implementation `main`: `31a5d2986d8a83c31fbaee22a679042a17b4335c`
- Normative specification repository: `NYGsatoshi/AIPsiteNYGspec`
- Normative specification `main`: `38339ba2964587f225c4c4151f643abb5523e862`
- Normative acceptance: `docs/specs/aip-core-v4/03-acceptance/workspace-project-canonical-completion-acceptance.md`

The audited WPC implementation sequence is merged through:

- WPC-02F: PR #288
- WPC-02E-1: PR #289
- WPC-02A: PR #290, with corrective PRs #291 and #293
- WPC-02B: PR #301
- WPC-02C: PR #308
- WPC-02D: PR #313
- WPC-02E-2: PR #319

Final02 does not reimplement those workers. It verifies the integrated result and prevents a future change from silently deleting one of the required acceptance cases.

## Completion boundary

The gate covers the canonical Workspace and Project path end to end at the contract and persistence boundaries:

1. Existing Projects migrate to fail-closed visibility and activation provenance without inventing historical facts.
2. Archived Workspace reads require current membership, restore remains owner-only, and SystemAdmin has no implicit historical access.
3. Capability grants are persisted and revalidated against current tenant, membership, and Workspace scope.
4. Workspace creation provisions exactly one canonical WorkspaceGeneral conversation atomically.
5. Canonical Project creation is Workspace-scoped, idempotent, authorization-bounded, and creates a Planning/NeverActivated Project without operational defaults.
6. Explicit activation uses expected-version concurrency and atomically provisions ProjectGeneral, the resolved Task workflow, audit, realtime outbox, and activation provenance.
7. Canonical redaction is applied at WPC response, error, export, audit, notification, search, and file-metadata boundaries and fails closed on incomplete context.
8. Artifact and Message notification opens resolve current authorization on the server, return canonical routes, switch Workspace context only after validation, and leave unavailable targets unread.

The gate does not declare unrelated entries in `docs/BACKEND_LOGIC_AUDIT.md` or later product phases complete.

## Required evidence

`scripts/ci/wpc-final02-required-tests.txt` pins 60 unique backend test names across WPC-02A through WPC-02F. The manifest must remain a superset of the existing WPC-02B, WPC-02C, and WPC-02D component manifests.

`.github/workflows/wpc-final02-canonical-completion.yml` performs the following on PostgreSQL 18:

1. Verifies manifest uniqueness and predecessor-manifest inclusion.
2. Restores and builds the solution.
3. Applies all EF Core migrations.
4. Rejects pending EF Core model changes.
5. Runs all backend tests whose `Scope` trait contains `WPC02`.
6. Requires every Final02 manifest entry to be present in the executed TRX and requires at least 60 executed cases.
7. Runs the focused Angular WPC-02F protected-notification navigation specification.
8. Uploads the backend TRX as retained CI evidence.

## Local reproduction

Provide a real PostgreSQL 18 database through both connection-string variables before running the backend acceptance:

```bash
export ConnectionStrings__DefaultConnection='Host=localhost;Port=5432;Database=aip_portal_wpc_final02;Username=aip_portal_wpc_final02;Password=replace-me'
export POSTGRES_TEST_CONNECTION_STRING="$ConnectionStrings__DefaultConnection"

dotnet restore AipPortal.slnx --disable-parallel
dotnet build AipPortal.slnx --configuration Release --no-restore -m:1
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
mkdir -p artifacts/wpc-final02-test-results
dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj \
  --configuration Release \
  --no-build \
  -m:1 \
  --filter 'Scope~WPC02' \
  --logger 'trx;LogFileName=wpc-final02-acceptance.trx' \
  --results-directory artifacts/wpc-final02-test-results
bash scripts/ci/verify-trx-results.sh \
  artifacts/wpc-final02-test-results/wpc-final02-acceptance.trx \
  --minimum-total 60 \
  --required-tests scripts/ci/wpc-final02-required-tests.txt \
  --label 'WPC-Final02 canonical completion'

bash scripts/ci/npm-ci-retry.sh frontend
npm --prefix frontend test -- \
  --include src/app/shared/right-panel/wpc-02f-notification-navigation.spec.ts
```

PostgreSQL tests are not accepted as evidence when `POSTGRES_TEST_CONNECTION_STRING` is absent, because conditional test discovery can otherwise report a non-executed database path as successful.

## Merge gate

Final02 is mergeable only when:

- the branch remains based on or is rebased onto the current `main` without dropping any WPC worker changes;
- the Final02 workflow passes against PostgreSQL 18;
- the standard repository CI and security checks pass;
- no required test name is missing or duplicated;
- no pending EF Core model change exists;
- the PR has no unresolved review thread;
- no auto-merge is enabled.
