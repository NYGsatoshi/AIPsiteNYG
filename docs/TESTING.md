# Testing

Last completed full local backend test-run audit: 2026-08-02. Latest frontend
unit/build/architecture audit: 2026-08-02.

## Verification snapshot (2026-08-02)

Command:

```powershell
dotnet test AipPortal.slnx --configuration Release --no-build
```

Result:

- 620 passed
- 0 failed
- 0 skipped reported
- PostgreSQL 18 configured and all current migrations applied

Both `POSTGRES_TEST_CONNECTION_STRING` and the application connection string
targeted the same disposable migrated PostgreSQL 18 database. The container was
removed after the run. This result is therefore PostgreSQL execution evidence,
not an environment-unset conditional pass.

The active frontend unit suite passed 42 files / 323 tests, and the local
Windows Playwright diagnostic passed 63 with 3 expected skips. The pinned Linux
Playwright run remains hosted-CI evidence because three local MCR image pulls
failed with transport EOF before the image could be built. Windows screenshots
are not baseline-approval evidence.

### Historical 2026-06-28 A-04 auth boundary verification

- Release build completed with 0 warnings and 0 errors.
- `AuthSecurityHttpTests` passed 15/15 after the test harness persisted Data Protection keys to an isolated temp directory instead of the Windows user-profile key folder.
- `TenantIsolation` filtered tests passed 24/24.
- Full backend suite passed 128/128.
- Docker daemon and local PostgreSQL were unavailable on this host, so container/runtime database assertions remain separate evidence work.

### 2026-06-19 backend audit verification

- Release build completed with 0 warnings and 0 errors.
- The audit environment prevented the .NET test runner from opening its local IPC socket, so tests did not execute in that turn.
- Existing test files were inspected for coverage, but the backend audit does not claim a fresh passing test run.
- Detailed regression recommendations are in `docs/BACKEND_LOGIC_AUDIT.md`.

## Test layers

### Unit and service tests

Located under `tests/AipPortal.Tests/`.

Covered areas include:

- auth hashing, invite rejection cases, user status, lockout;
- admin service rules;
- organization authorization;
- projects/tasks;
- forms and events;
- notifications;
- integration/API-token foundations;
- local file storage;
- pagination safety;
- tenancy and save rules.

Most service fixtures use fakes or EF Core InMemory.

### HTTP tests

`AuthSecurityHttpTests`:

- starts Kestrel on an ephemeral local port;
- uses cookie authentication;
- tests CSRF, hidden session ID, revoked/expired sessions, and suspended users;
- uses EF Core InMemory.

`HttpTenantIsolationTests`:

- starts Kestrel;
- uses a test authentication handler;
- exercises controllers, tenant middleware, services, repositories, and core cross-tenant boundaries;
- uses EF Core InMemory, not PostgreSQL and not the production cookie scheme.

### PostgreSQL tests

`PostgreSqlIntegrationTests` checks:

- no pending migrations;
- tenant-scoped repository behavior;
- tenant-scoped search across several result types.

The tests require `POSTGRES_TEST_CONNECTION_STRING`.

PostgreSQL tests use `PostgreSqlFactAttribute` plus `PostgreSqlTestEnvironment.RequireConnectionString()`.
When the variable is absent locally, they are explicitly reported as skipped at discovery;
when `CI=true` or `GITHUB_ACTIONS=true`, the missing variable is a test failure. This
prevents an unconfigured PostgreSQL suite from being reported as a pass.

### TASK-V1-PR07-B immediate notification tests

PR07-B adds focused service/contract tests for the exact recipient matrix,
pre-mutation assignee capture, actor suppression, mandatory-versus-Watch
independence, duplicate relationships, direct-mention validation, Important
comment union, and ordinary-comment no-notify-all behavior. Command tests cover
assignment/Reviewer/Blocked/review/deadline integration, compatibility-route
normalization, default-off rollout behavior, safe semantic payloads, and the
separation of Gantt planned dates from hard `DeadlineAt`.

The deadline classifier suite fixes one `now` instant and exercises null/value,
23h59m/24h, local Today, local Overdue, and timezone-conversion boundaries.
Request/HTTP contract tests distinguish an omitted deadline from explicit null,
reject client significance fields, and prove the schedule request cannot own a
hard deadline.

Conditional PostgreSQL PR07-B tests are the authoritative transaction and
concurrency evidence. They must run with
`POSTGRES_TEST_CONNECTION_STRING` and cover one committed Task mutation,
relationship/Audit/Notification/business-Outbox/signal-Outbox unit; stale and
authorization zero-row outcomes; injected Task-save, Audit, and Outbox failures; retry;
and concurrent writers leaving one visible logical Notification. A local run
without the variable is not PostgreSQL evidence. Exact commands and final
counts are recorded in
`docs/verification/task-v1-pr07-b-immediate-notifications.md`.

The PR07-B relationship-target regression set suspends a `WorkspaceMember`
while retaining the User and `ProjectMember` records. Canonical
assignee/reviewer/collaborator and compatibility Assignee/Reviewer/Support
changes must reject before save, leaving Task, relationship, Watch,
Notification, NotificationUserState, Audit, and Outbox state unchanged.
Authorized cleanup of an already-revoked relationship remains permitted. The
focused TRX manifest is `scripts/ci/task-pr07b-required-tests.txt`; record its
active and matched counts from the final exact-HEAD run.

The TaskComment remediation additionally requires focused unit and HTTP proof
that revoked comment authors cannot PATCH or DELETE by stored comment ID,
current authors and Managers retain their permitted updates, and archived or
deleted parents deny changes without a persistence delta. Its safety coverage
uses the real `InMemoryCommunicationSafetyGuard` to prove Important-only
`false -> true` updates consume the post window, return
`TASK_COMMENT_RATE_LIMITED` with positive retry metadata when limited, and do
not double-charge a combined body/Important mutation. Mention tests must prove
that revoked Workspace members with stale ProjectMember/GroupMember rows are
absent from candidate search and that an authorized/unauthorized mixed mention
rejects the full command without staged notification work. The conditional
PostgreSQL suite must prove the same denied paths leave Task/comment versions,
AuditLog, Outbox, Notification, and NotificationUserState unchanged.

### Browser UI tests

Root Playwright infrastructure remains under `tests/ui`, but the legacy static-SPA specs have been marked obsolete after the MVP-A P0 Angular migration.

- `tests/ui/serve-static.mjs` serves Angular build output from `frontend/dist/aipportal-web` by default;
- legacy vanilla-SPA mocked API fixtures were removed;
- run desktop and mobile Chromium projects;
- use axe for accessibility checks.

The current skipped legacy spec is not acceptance evidence. Add new Angular-facing specs after frontend dependencies, routes, and selectors are intentionally defined.

They do **not** verify:

- the ASP.NET Core host;
- authentication cookies;
- CSRF integration with the real backend;
- serialized DTO compatibility;
- controller routes or authorization;
- PostgreSQL behavior.

### Static Angular Playwright suite

Run the frontend/static suite with:

```powershell
npm.cmd run test:ui:angular
```

`npm test`, `npm run test:ui`, and `npm run test:ui:angular` all run only
`angular-smoke.spec.ts` and `app.spec.ts` against the static Angular test
server. Their API responses are mocked. They intentionally do not discover or
execute `real-backend-smoke.spec.ts`.

### MVP0 real-backend browser smoke

Run the self-contained real-host smoke with:

```powershell
npm.cmd run test:ui:real-backend
```

The runner validates Compose, starts an isolated PostgreSQL volume, applies EF
Core migrations, builds and starts the ASP.NET Core image with the production
Angular build, enables deterministic synthetic seed data, waits for
`/health/ready`, and runs Playwright inside the Compose network against
`http://aip-backend:8080`. The alias intentionally avoids the HSTS-preloaded
`.app` hostname used by the Compose service name. It preserves traces,
screenshots, videos, HTML reports, and
the smoke error-context attachment on the host when the run fails. Containers,
networks, and the isolated test volumes are removed afterwards.

The runner prefers `docker compose` on Windows, Linux, and macOS, and falls
back to legacy `docker-compose` only when necessary. Do not point this suite at
the static server on port 4173.

For an already-running real backend only, direct execution requires the marker,
URL, and synthetic credentials explicitly:

```powershell
$env:AIP_REAL_BACKEND_SMOKE = "1"
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:8080"
$env:AIP_BROWSER_SMOKE_EMAIL = "e2e-user@example.test"
$env:AIP_BROWSER_SMOKE_PASSWORD = "E2eSmoke!23456"

node tests/ui/run-real-backend-playwright.mjs
```

The normal `dotnet run` launch profile uses port 5098; the Compose application
uses internal port 8080. Direct execution does not start ASP.NET Core for you.

### Node DEP0205 note

Historical static-suite evidence shows `[DEP0205] module.register()` only after
Playwright starts its workers. It is not emitted by the installed Playwright
CLI version command, and no project source calls `module.register()`; it is
therefore inferred to be a Playwright worker loader or transitive dependency,
not an API/backend failure. Leave the warning visible and do not suppress it
globally. Capture a deprecation trace under the supported Node version before
changing a direct dependency.

## CI

`.github/workflows/ci.yml`:

- starts PostgreSQL 18;
- restores and builds .NET;
- applies EF migrations;
- sets `POSTGRES_TEST_CONNECTION_STRING`;
- runs .NET tests;
- installs Node dependencies;
- runs Angular Playwright smoke in the pinned Linux Docker runner;
- runs Gitleaks, .NET package reports, Compose validation, Docker build, and Trivy.

This is configuration evidence. Check the actual GitHub Actions run before claiming a branch is green.

Angular screenshot baselines remain strict. Local Windows/macOS Playwright runs
are diagnostic only; baseline approval and CI-parity reruns must use the pinned
Linux Docker runner via `npm run test:ui:angular:docker`.

## Commands

All .NET tests:

```bash
dotnet test AipPortal.slnx
```

Tenancy-focused:

```bash
dotnet test AipPortal.slnx --filter 'FullyQualifiedName~Tenancy'
```

PostgreSQL category:

```bash
POSTGRES_TEST_CONNECTION_STRING='<test connection string>' \
dotnet test AipPortal.slnx --filter 'Category=PostgreSQLIntegration'
```

UI:

```bash
npm ci
npx playwright install --with-deps chromium
npm --prefix frontend ci
npm --prefix frontend run build
npm run test:ui
```

Runner helper tests:

```bash
npm run test:ui:real-backend:runner
```

Linux screenshot parity:

```bash
npm run test:ui:angular:docker
```

Use the Linux runner for screenshot baseline approval. Do not approve
Windows/macOS host-native screenshots as authoritative baselines.

Compose syntax:

```bash
docker compose -f docker-compose.db.yml config --quiet
docker compose -f docker-compose.dev.yml config --quiet
docker compose -f docker-compose.playwright.yml config --quiet
docker compose -p aipsite-real-backend-smoke-config -f docker-compose.real-backend-smoke.yml config --quiet
DB_PASSWORD=validation_only docker compose config --quiet
docker compose -f docker-compose.local.yml config --quiet
DB_PASSWORD=validation_only docker compose -f docker-compose.onprem.yml config --quiet
```

## Coverage gaps

High priority:

- scoped announcement visibility across workspace, group, public-channel, private-channel, and confidential-channel scopes;
- search authorization parity with normal project and comment authorization;
- PostgreSQL conversation creation and message attachment persistence;
- EF-backed post update/delete/pin persistence;
- assignee-filtered task queries against a real scoped `DbContext`;
- file cleanup when database/audit/notification persistence fails;
- conversation read-state message ownership;
- distinct My Tasks rows for users with multiple assignment roles;
- notification title/body boundary handling;
- HTTP status-code and shared error-response contract tests;
- first-admin/bootstrap workflow;
- successful invite acceptance creating tenant/workspace membership;
- frontend/backend DTO contract tests;
- cookie-authenticated tenant isolation against PostgreSQL;
- on-prem migration/startup flow;
- reverse-proxy/forwarded-header behavior;
- object storage when implemented;
- backup/restore rehearsal.

Medium priority:

- route parent-child mismatch rejection;
- explicit nullable-field clearing for PATCH requests;
- concurrent artifact-version allocation and event-capacity enforcement;
- maximum-length, invalid-enum, empty-GUID, null-collection, malformed-JSON, and reversed-date-range tests;
- missing physical-file behavior;
- DI scope-validation smoke tests resolving all controllers and services;
- real API smoke execution from `docs/API_SMOKE_TESTS.http`;
- feature/platform configuration enforcement;
- forms/events/workspaces/groups/channels browser workflows;
- file MIME rejection at service level;
- API error contract/status consistency;
- accessibility coverage beyond four mocked UI scenarios.

## Interpreting results

- “123 tests passed” is not equivalent to “PostgreSQL tests executed.”
- “UI tests passed” is not equivalent to “frontend integrates with backend.”
- “Compose config validates” is not equivalent to “containers start.”
- “Readiness is healthy” is not equivalent to “a user can log in.”
- “CI configuration includes a check” is not equivalent to “the latest run passed.”
