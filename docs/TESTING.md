# Testing

Last local audit: 2026-06-18.

## Verification snapshot

Command:

```bash
dotnet test AipPortal.slnx \
  --configuration Release \
  --no-restore \
  --disable-build-servers \
  -m:1
```

Result:

- 123 passed
- 0 failed
- 0 skipped
- one compile warning: unread `workspaceAuthorization` parameter in `DbAuditQueryService`

Important qualification: `POSTGRES_TEST_CONNECTION_STRING` was unset. The two tests marked `PostgreSQLIntegration` returned before assertions and were counted as passed.

Playwright was not run in this workspace because frontend dependencies were not installed.

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

Current behavior when the variable is absent is an early `return`, not an explicit skip or failure.

### Browser UI tests

Playwright tests:

- serve `src/AipPortal.Web/wwwroot` with `tests/ui/serve-static.mjs`;
- intercept and mock API requests in `tests/ui/app.fixtures.ts`;
- run desktop and mobile Chromium projects;
- use axe for accessibility checks.

They verify static frontend behavior, routing, empty/error states, form validation, and selected accessibility states.

They do **not** verify:

- the ASP.NET Core host;
- authentication cookies;
- CSRF integration with the real backend;
- serialized DTO compatibility;
- controller routes or authorization;
- PostgreSQL behavior.

## CI

`.github/workflows/ci.yml`:

- starts PostgreSQL 18;
- restores and builds .NET;
- applies EF migrations;
- sets `POSTGRES_TEST_CONNECTION_STRING`;
- runs .NET tests;
- installs Node dependencies and Playwright Chromium;
- runs UI tests;
- runs Gitleaks, .NET package reports, Compose validation, Docker build, and Trivy.

This is configuration evidence. Check the actual GitHub Actions run before claiming a branch is green.

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
npm run test:ui
```

Compose syntax:

```bash
POSTGRES_PASSWORD=validation_only docker compose config --quiet
docker compose -f docker-compose.local.yml config --quiet
POSTGRES_PASSWORD=validation_only docker compose -f docker-compose.onprem.yml config --quiet
```

## Coverage gaps

High priority:

- first-admin/bootstrap workflow;
- successful invite acceptance creating tenant/workspace membership;
- frontend/backend DTO contract tests;
- cookie-authenticated tenant isolation against PostgreSQL;
- on-prem migration/startup flow;
- reverse-proxy/forwarded-header behavior;
- object storage when implemented;
- backup/restore rehearsal.

Medium priority:

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
