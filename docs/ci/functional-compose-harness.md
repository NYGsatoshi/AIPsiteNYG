# Functional CI deterministic full-stack harness

Issue: #581 (FCI-02)

## Canonical command

Run the current deterministic real-backend Functional stack with:

```bash
npm run test:functional
```

The command is an alias of the existing real-backend acceptance entry point, but orchestration now lives in `scripts/ci/functional-compose-harness.mjs` so additional Functional suites can reuse the same lifecycle instead of duplicating Compose setup/cleanup logic.

## Lifecycle contract

`FunctionalComposeHarness.provisionBaseStack()` owns the common setup order:

```text
validate Docker/Compose host
-> validate Compose config
-> build application + Playwright images
-> start isolated PostgreSQL
-> wait for PostgreSQL readiness
-> apply EF Core migration head
-> wait for migration success
-> start production-like ASP.NET Core host + built Angular assets
-> Test-only deterministic fixture seed completes during host startup
-> wait for /health/ready
-> execute suite
-> collect sanitized diagnostics on failure
-> docker compose down --volumes --remove-orphans
```

A Compose project name is unique per CI run/attempt/process by default. `FUNCTIONAL_COMPOSE_PROJECT_NAME` is available only as an explicit override. The older `REAL_BACKEND_SMOKE_COMPOSE_PROJECT_NAME` override remains supported during migration.

The base Compose file does not publish fixed application/database host ports. Network and named-volume resources are therefore namespaced by the isolated Compose project.

## Canonical deterministic fixture

The current common fixture builder remains the Test-only application seeder `AppDbContextSeed.SeedBrowserSmokeAsync`. The Functional harness supplies its opt-in through `buildCanonicalFunctionalFixtureEnvironment()` rather than allowing each suite to invent its own base credentials/profile.

Stable aliases exposed by `canonicalFunctionalFixtureAliases` include:

- synthetic actor: `e2e-user@example.test`
- secondary/restricted-role actor: `browser-smoke-recipient@example.test`
- Workspace: `browser-smoke-workspace` / `Browser Smoke Workspace`
- Project: `browser-smoke-project` / `Browser Smoke Project`
- Task: `Browser smoke task`
- eligible Task FileObject: `browser-smoke-task.txt`
- Announcement: `Browser smoke announcement`

The seeder is idempotent and the normal harness starts from a clean PostgreSQL volume. Journeys that are intended to validate resource creation continue to create those resources through the application/UI path; the shared seed is prerequisite data, not a general-purpose direct-DB test backdoor. The existing real-backend smoke, for example, creates its Direct Message through the public application flow instead of seeding that journey result.

Domain-specific fixtures that are not prerequisites for a suite should remain in that suite's controlled overlay/provisioner. MBJ scripts may be migrated incrementally to `FunctionalComposeHarness`; this issue does not require a flag-day rewrite of every acceptance script.

## Reset and retry policy

The default reset boundary is the entire Compose project:

```text
unique project -> clean DB/volumes -> run -> down --volumes
```

Do not reuse another lane's PostgreSQL volume, network, upload storage, data-protection keys, or Node modules. If a future suite deliberately reuses one stack for multiple phases, it must define its reset scope explicitly and keep fixture operations idempotent.

Stable logical aliases are preferred over timestamp-derived fixture identities. Tests that assert time-dependent behavior must use tolerance or an explicit test-clock policy rather than depending on exact wall-clock values.

## Failure classification

Common setup failures are emitted as:

```text
[INFRA/SETUP FAILURE] phase=<phase>: <message>
```

A suite process that starts after setup and exits non-zero is emitted as:

```text
[PRODUCT TEST FAILURE] phase=execute-suite: <message>
```

This separates Docker/Compose/image/migration/readiness failures from product-level Functional regressions.

## Sanitized diagnostics

On failure the harness writes bounded diagnostics under `test-results/`:

- Compose container status
- migration container status
- bounded log tails for PostgreSQL, migration, app, and test services
- existing Playwright traces/screenshots/reports produced after the test suite starts

The shared redactor removes known password, authorization, cookie, CSRF, invite-token, generic token/secret/license, connection-string password, and `SYNCFUSION_LICENSE` patterns. Runtime secret values supplied to the harness are also replaced before diagnostic files are written.

Do not add raw protected response bodies, cookies, bearer tokens, passwords, connection credentials, or license material to Functional diagnostics.

## Syncfusion license trust boundary

The protected full real-backend lane remains `.github/workflows/licensed-real-backend-acceptance.yml`:

- trigger: `push` to `main` or explicit `workflow_dispatch`
- protected environment: `syncfusion-licensed-build`
- license source: `${{ secrets.SYNCFUSION_LICENSE }}`
- checkout: exact `${{ github.sha }}`
- credentials persistence: disabled
- no `pull_request` or `pull_request_target` execution

`scripts/ci/verify-functional-trust-boundary.mjs` locks these invariants into the PR-safe `Real Backend P0 Preflight`. An untrusted PR therefore validates the harness and trust-boundary contract without receiving the protected license.

A future PR Functional-fast lane that needs licensed Syncfusion assets must use a reviewed/trusted same-repository commit or another explicitly approved safe design. It must not execute untrusted code through a secret-bearing `pull_request_target` job.

## Migration guide for existing runners

New Functional runners should import `FunctionalComposeHarness` directly. Existing real-backend helper imports remain available through `tests/ui/real-backend-smoke-compose-helpers.mjs` as a compatibility shim.

When migrating an MBJ or domain runner, move only the common responsibilities into the harness:

- Compose command selection
- project isolation
- base stack build/start
- PostgreSQL/migration/app readiness
- common diagnostics/redaction
- cleanup

Keep domain-specific probes, controlled fixture overlays, restart phases, and persistence assertions in the domain runner. This preserves test intent while eliminating duplicated infrastructure orchestration.
