# MVP-A Evidence Log

Verification date: 2026-06-24

Result status values: Pass, Partial, Failed, Blocked, Missing, Needs verification.

## A-01 Baseline Refresh

Refresh date: 2026-06-28

Detailed evidence:

- `docs/evidence/mvp-a/a-01-build-test-baseline.md`
- `docs/evidence/mvp-a/a-01-baseline-failure-log.md`

Summary: `dotnet restore`, `dotnet build`, and `dotnet test` passed on Windows with .NET SDK 10.0.301; the test runner reported 128/128 passing. Docker build/startup evidence is blocked because the Docker Desktop Linux engine endpoint is unavailable. Local UI test evidence is blocked because Playwright is not installed in `node_modules`. Live PostgreSQL assertions remain Needs verification because `POSTGRES_TEST_CONNECTION_STRING` was not set.

## A-02 Health Check Refresh

Refresh date: 2026-06-28

Detailed evidence:

- `docs/evidence/mvp-a/a-02-health-check-baseline.md`
- `docs/evidence/mvp-a/a-02-health-check-failure-log.md`

Summary: the app started locally and `/health/live` returned 200 with `{"status":"OK"}`, but `/health/ready` returned 503 with `{"status":"Unhealthy"}`. Local PostgreSQL on port 5432 was unavailable, Docker Desktop Linux engine was unavailable, and PostgreSQL/container health could not be verified. This A-02 refresh is Blocked and does not imply production approval.

## A-03 Application Smoke Refresh

Refresh date: 2026-06-28

Detailed evidence:

- `docs/evidence/mvp-a/a-03-application-smoke-baseline.md`
- `docs/evidence/mvp-a/a-03-smoke-failure-log.md`

Summary: the app started locally on `http://127.0.0.1:18083`; root/login/dashboard SPA shell routes returned 200; `/health/live` returned 200; `/health/ready` returned 503; public auth status returned unauthenticated; CSRF protection rejected unsafe anonymous POSTs; protected anonymous APIs returned 401; API 404 returned safe JSON. Local PostgreSQL on port 5432 and Docker Desktop Linux engine were unavailable. Frontend Angular, Storybook, and root Playwright smoke checks were blocked by incomplete local `node_modules`. This A-03 refresh is Blocked and does not imply production approval, MVP-A Go, or production readiness.

| Evidence ID | Area | Command or method | Environment | Observed result | Status | Related blocker | Sensitive data status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EV-001 | Repository inventory | `find . -maxdepth 3 ...` and source inspection | Workspace | Found `AipPortal.slnx`, four source projects, one .NET test project, UI tests, Dockerfiles/Compose, and GitHub Actions CI. | Pass | None | No secrets copied |
| EV-002 | Build / Startup | `dotnet --info` | Ubuntu 24.04 container | .NET SDK 10.0.200 and ASP.NET Core runtime 10.0.4 available. | Pass | None | No secrets |
| EV-003 | Build / Startup | `dotnet restore AipPortal.slnx` | Workspace, escalated for package/cache access | Restore succeeded; all projects up-to-date. | Pass | None | No secrets |
| EV-004 | Build / Startup | `dotnet build AipPortal.slnx --configuration Release --no-restore` | Sandbox | Failed with no compiler errors due MSBuild `SocketException (13): Permission denied` creating named pipe server streams. | Blocked | Environment limitation | No secrets |
| EV-005 | Build / Startup | `dotnet build AipPortal.slnx --configuration Release --no-restore --disable-build-servers -m:1` | Escalated process permissions | Build succeeded, 0 warnings, 0 errors. | Pass | None | No secrets |
| EV-006 | CI / tests | `dotnet test AipPortal.slnx --configuration Release --no-build --verbosity normal --disable-build-servers -m:1` | Escalated process permissions | 123 tests passed. PostgreSQL tests were counted but require separate connection-string verification. | Partial | None | No secrets |
| EV-007 | EF Core / PostgreSQL | `docker compose -f docker-compose.local.yml up -d postgres` | Docker local | PostgreSQL 18 container started and became healthy. | Pass | None | Local throwaway credential only |
| EV-008 | EF Core / PostgreSQL | `dotnet ef migrations list` before update | Local PostgreSQL | All 12 migrations listed as pending on empty `aip_portal` database. | Pass | None | Local throwaway credential redacted |
| EV-009 | EF Core / PostgreSQL | `dotnet ef database update` | Local PostgreSQL | All migrations applied successfully. | Pass | None | Local throwaway credential redacted |
| EV-010 | EF Core / PostgreSQL | `dotnet ef migrations list` after update | Local PostgreSQL | 12 migrations listed without pending markers. | Pass | None | Local throwaway credential redacted |
| EV-011 | EF Core / PostgreSQL | `POSTGRES_TEST_CONNECTION_STRING=... dotnet test ... --filter Category=PostgreSQLIntegration` | Local PostgreSQL | 2 PostgreSQL integration tests passed with real DB assertions. | Pass | None | Local throwaway credential redacted |
| EV-012 | Startup | `dotnet run --project src/AipPortal.Web --configuration Release --no-build` | Local PostgreSQL | App started, but launch profile forced `Development` and `http://localhost:5098`. | Partial | Environment/config note | Connection string redacted |
| EV-013 | Startup | `dotnet run ... --no-launch-profile` with `ASPNETCORE_ENVIRONMENT=Test` | Local PostgreSQL | App started in Test on `http://127.0.0.1:5086`. | Pass | None | Connection string redacted |
| EV-014 | Health check | `GET /health` | Running app | Returned `302` to `/health/ready`. | Pass | None | No secrets |
| EV-015 | Health check | `GET /health/live` | Running app | Returned `200` and `{"status":"OK"}`. | Pass | None | No secrets |
| EV-016 | Health check | `GET /health/ready` | Running app | Returned `200` with checks for database, migrations, fileStorage, dataProtection, and defaultTenant all OK. | Pass | None | No secrets |
| EV-017 | Health check | `GET /healthz` | Running app | Returned SPA fallback HTML, not a health endpoint. | Missing | P1 follow-up | No secrets |
| EV-018 | Health check | `GET /api/health` | Running app | Returned `404` JSON. | Missing | P1 follow-up | No secrets |
| EV-019 | Auth / Login | `GET /api/auth/status` | Running app | Returned `200` with unauthenticated status. | Pass | None | No secrets |
| EV-020 | Auth / Login | `GET /api/auth/me` | Running app | Returned `401 Unauthorized`. | Pass | None | No secrets |
| EV-021 | Auth / Login | `POST /api/auth/login` without CSRF | Running app | Returned `403` with CSRF error. | Pass | None | Dummy credentials only |
| EV-022 | Auth / Login | `POST /api/auth/login` with valid CSRF and invalid credentials | Running app | Returned `401` with generic error `Invalid email or password.` | Pass | None | Dummy credentials only |
| EV-023 | Tenant / User / Role | Fresh DB startup counts | Fresh local PostgreSQL database | After migrations and Test startup: tenants 1, plans 4, users 0, tenant_users 0. | Failed | P0-001 | Counts only |
| EV-024 | Authorization | `GET /api/admin/users` anonymous | Running app | Returned `401 Unauthorized`. | Pass | P0-002 for deeper checks | No secrets |
| EV-025 | Authorization | `GET /api/projects` anonymous | Running app | Returned `401 Unauthorized`. | Pass | P0-002 for deeper checks | No secrets |
| EV-026 | Authorization | `GET /api/ui/modules` anonymous | Running app | Returned `401 Unauthorized`. | Pass | P0-002 for deeper checks | No secrets |
| EV-027 | Dashboard reachability | `GET /` and `GET /dashboard` anonymous | Running app | Returned SPA login HTML. Authenticated dashboard data could not be verified without a user. | Partial | P0-001 | No private data |
| EV-028 | AuditLog | Source inspection | `DbAuditLogger`, `AuditLog`, `SecurityEvent`, services | AuditLog/SecurityEvent models and logger exist; metadata sensitive-key redaction exists; many services call audit logger. Runtime authenticated audit coverage blocked by no user. | Partial | P0-001 | No secrets |
| EV-029 | File / Messaging baseline | Source inspection | File and messaging services/controllers | File upload/download/delete use storage, permission checks, and audit calls. Messaging APIs require authorization and audit message actions; conversation attachment path is metadata-only. | Partial | P1 follow-up | No secrets |
| EV-030 | CI / tests | `.github/workflows/ci.yml` inspection | Workspace | CI includes PostgreSQL service, restore, build, migrations, tests, npm ci, Playwright install/tests, secret scan, dependency scan, Compose validation, Docker build, Trivy scan. | Pass | None | No secrets |
| EV-031 | CI / tests | `npm test -- --reporter=list` | Workspace | Failed with `playwright: not found` because `node_modules` is absent. | Blocked | P1 follow-up | No secrets |
| EV-032 | Docker / Compose | `docker compose config` | Workspace | Failed without `POSTGRES_PASSWORD`. | Partial | P1 follow-up | No secrets |
| EV-033 | Docker / Compose | `POSTGRES_PASSWORD=verification_only_password docker compose config` and on-prem equivalent | Workspace | Default and on-prem Compose configs rendered successfully with dummy value. Local Compose config rendered successfully without extra env. | Pass | None | Dummy value only |
| EV-034 | A-02 health source | Source inspection of `Program.cs`, Docker/Compose, appsettings, and deployment docs | Windows host | Existing custom endpoints are `/health`, `/health/live`, and `/health/ready`; `/healthz`, `/ready`, and `/live` are not dedicated health endpoints. | Pass | None | No secrets |
| EV-035 | A-02 local liveness | `curl.exe -i -s http://localhost:5098/health/live` | Windows host, local `dotnet run` | Returned 200 with `{"status":"OK"}`. | Pass | None | No secrets |
| EV-036 | A-02 local readiness | `curl.exe -i -s http://localhost:5098/health/ready` | Windows host, local `dotnet run` | Returned 503 with `{"status":"Unhealthy"}` because required DB-backed readiness was unavailable in this run. | Blocked | A-02 health baseline | No secrets |
| EV-037 | A-02 DB dependency | `Test-NetConnection -ComputerName localhost -Port 5432` | Windows host | TCP connection to local PostgreSQL port 5432 failed. | Blocked | A-02 health baseline | No secrets |
| EV-038 | A-02 Docker dependency | `docker info`; `docker compose --env-file .env.example ps` | Windows host | Docker Desktop Linux engine endpoint unavailable; PostgreSQL/app container health could not be inspected. | Blocked | A-02 health baseline | No secrets |
| EV-039 | A-02 backend suite | `dotnet test AipPortal.slnx --configuration Release --no-build --verbosity normal --disable-build-servers -m:1` | Windows host | 115 passed, 13 failed; failures clustered in `AuthSecurityHttpTests` CSRF/login setup returning 500. | Blocked | A-02 clean gate evidence | No secrets |
| EV-040 | A-03 backend suite | `dotnet restore`; `dotnet build`; `dotnet test` | Windows host | Restore passed, Release build passed with 0 warnings/errors, and 128/128 backend tests passed. | Pass | None | No secrets |
| EV-041 | A-03 app startup | `dotnet run ... --no-launch-profile` | Windows host | App started in Development on `http://127.0.0.1:18083`. | Pass | None | No secrets |
| EV-042 | A-03 root and shell routes | `GET /`, `/login`, `/dashboard` | Running local app | Returned SPA shell HTML with no private data observed. Authenticated dashboard data was not verified. | Partial | P0-001 for authenticated dashboard | No private data |
| EV-043 | A-03 health routes | `GET /health`, `/health/live`, `/health/ready` | Running local app | `/health` redirected to readiness, `/health/live` returned 200, and `/health/ready` returned 503 with minimal unhealthy JSON. | Blocked | A-03 smoke baseline | No secrets |
| EV-044 | A-03 health alias candidates | `GET /healthz`, `/ready`, `/live` | Running local app | Returned SPA fallback HTML, not dedicated health endpoints. | Missing | P1 follow-up | No secrets |
| EV-045 | A-03 Swagger/OpenAPI candidates | `GET /swagger`, `/swagger/index.html`, `/openapi` | Running local app | No dedicated Swagger/OpenAPI endpoint was verified; routes returned SPA fallback or 404. | Needs verification | A-03 smoke baseline | No secrets |
| EV-046 | A-03 public auth status | `GET /api/auth/status`; `GET /api/security/csrf-token` | Running local app | Auth status returned unauthenticated; CSRF endpoint returned a token payload whose value was not copied. | Pass | None | Token value omitted |
| EV-047 | A-03 unsafe anonymous POSTs | `POST /api/auth/login`; `POST /api/auth/logout` without CSRF | Running local app | Returned 403 with generic CSRF error. | Pass | None | Dummy credentials only |
| EV-048 | A-03 anonymous protected APIs | `GET /api/auth/me`; `/api/admin/users`; `/api/projects`; `/api/ui/modules` | Running local app | All returned 401 without exposing private bodies. | Pass | P0-002 for deeper authenticated checks | No private data |
| EV-049 | A-03 safe 404 behavior | `GET /api/not-found-test`; `/api/auth/not-found-test` | Running local app | Returned generic 404 JSON with trace ID and no stack trace observed. | Pass | None | No secrets |
| EV-050 | A-03 local DB dependency | `Test-NetConnection -ComputerName localhost -Port 5432` | Windows host | TCP connection to local PostgreSQL port 5432 failed. | Blocked | A-03 smoke baseline | No secrets |
| EV-051 | A-03 Docker dependency | `docker info`; `docker compose --env-file .env.example config --quiet` | Windows host | Compose config passed, but Docker Desktop Linux engine endpoint was unavailable. | Blocked | A-03 smoke baseline | No secrets |
| EV-052 | A-03 frontend build | `npm.cmd run build` in `aipsite-frontend` | Windows host | Blocked because local Angular CLI was missing from `aipsite-frontend/node_modules`. | Blocked | A-03 frontend smoke | No secrets |
| EV-053 | A-03 Storybook build | `npm.cmd run build-storybook` in `aipsite-frontend` | Windows host | Blocked because local Angular CLI was missing from `aipsite-frontend/node_modules`. | Blocked | A-03 frontend smoke | No secrets |
| EV-054 | A-03 root UI tests | `npm.cmd test -- --reporter=list` | Windows host | Blocked because the Playwright executable was unavailable. | Blocked | A-03 UI smoke | No secrets |

## Evidence Notes

- `Pass` is used only where direct command/runtime/source evidence was collected.
- Authenticated admin/non-admin/tenant runtime checks are not marked Pass because no baseline login user exists.
- No screenshots were captured because curl evidence was sufficient and no private data was exposed.
- A-02 readiness is not accepted in the 2026-06-28 Windows refresh; liveness success is not production approval.
- A-03 smoke success on public shell/protected-anonymous checks is not MVP-A Go; readiness, Docker/PostgreSQL, frontend dependencies, and authenticated runtime checks remain blocked or need verification.
