# MVP-A Environment Notes

Verification date: 2026-06-24

## A-01 Windows Baseline Refresh

Refresh date: 2026-06-28

Evidence files:

- `docs/evidence/mvp-a/a-01-build-test-baseline.md`
- `docs/evidence/mvp-a/a-01-baseline-failure-log.md`

Observed local host:

| Item | Observed value |
| --- | --- |
| OS | Windows 10.0.26200, win-x64 |
| .NET SDK | 10.0.301 |
| .NET runtime | Microsoft.NETCore.App 10.0.9, Microsoft.AspNetCore.App 10.0.9 |
| global.json | Present, pins 10.0.301 |
| Docker | Client 29.5.3 installed; Docker Desktop Linux engine unavailable |
| Docker Compose | v5.1.4 |
| Node.js | v26.4.0 |
| npm | 11.17.0 through `npm.cmd`; `npm.ps1` blocked by PowerShell execution policy |

The 2026-06-28 .NET baseline passed restore, Release build, and the backend test runner. Docker runtime evidence, root UI tests, and live PostgreSQL assertions remain blocked or Needs verification as recorded in the A-01 evidence files. No secret values were copied into the evidence.

## A-02 Windows Health Refresh

Refresh date: 2026-06-28

Evidence files:

- `docs/evidence/mvp-a/a-02-health-check-baseline.md`
- `docs/evidence/mvp-a/a-02-health-check-failure-log.md`

Observed local host:

| Item | Observed value |
| --- | --- |
| OS | Windows NT 10.0.26200.0, win-x64 |
| .NET SDK | 10.0.301 |
| .NET runtime | Microsoft.NETCore.App 10.0.9, Microsoft.AspNetCore.App 10.0.9 |
| Docker | Client 29.5.3 installed; Docker Desktop Linux engine unavailable |
| Docker Compose | v5.1.4 |
| Local app URL | `http://localhost:5098` from launch profile |

The app process started and `/health/live` returned 200, but `/health/ready` returned 503. Local PostgreSQL on port 5432 was not reachable and Docker Compose container health could not be inspected. This A-02 refresh is Blocked; it does not imply production approval.

## A-03 Application Smoke Refresh

Refresh date: 2026-06-28

Evidence files:

- `docs/evidence/mvp-a/a-03-application-smoke-baseline.md`
- `docs/evidence/mvp-a/a-03-smoke-failure-log.md`

| Item | Observed value |
| --- | --- |
| Branch | `main` |
| Commit | `d20589a6d237e3c7c0fbbefb8040861bfd4b7506` |
| OS | Windows 10.0.26200, win-x64 |
| .NET SDK | 10.0.301 |
| .NET runtime | Microsoft.NETCore.App 10.0.9, Microsoft.AspNetCore.App 10.0.9 |
| Docker client | 29.5.3 |
| Docker Compose | v5.1.4 |
| Node.js | v26.4.0 |
| npm | 11.17.0 through `npm.cmd` |
| Smoke base URL | `http://127.0.0.1:18083` |

The app process started, root and SPA shell routes returned 200, `/health/live` returned 200, public auth status was safe, unsafe anonymous POSTs without CSRF returned 403, and protected anonymous APIs returned 401. `/health/ready`, Docker runtime, PostgreSQL runtime, frontend Angular/Storybook builds, root Playwright UI tests, and authenticated admin/non-admin/tenant smoke checks remain blocked or need verification as recorded in the A-03 evidence files. No secret values, CSRF token values, cookies, connection strings, tenant identifiers, or personal data were copied into the evidence.

Repository: `/workspaces/AIPsiteNYG`

## Local Environment

| Item | Observed value |
| --- | --- |
| OS | Ubuntu 24.04 container |
| .NET SDK | 10.0.200 |
| .NET runtime | Microsoft.NETCore.App 10.0.4, Microsoft.AspNetCore.App 10.0.4 |
| global.json | Missing |
| Docker | 29.3.0-1 |
| Docker Compose | v2.40.3 |
| Node.js | v24.14.0 |
| npm | 11.9.0 |
| Local .NET tool manifest | `.config/dotnet-tools.json`, `dotnet-ef` 10.0.8 |

## Database Setup Used

Local PostgreSQL was started with:

```bash
docker compose -f docker-compose.local.yml up -d postgres
```

The container became healthy as `aipsitenyg-postgres-1` on port `5432`.

Two local databases were used:

| Database | Purpose |
| --- | --- |
| `aip_portal` | Main local verification database, also used for targeted PostgreSQL integration tests. |
| `aip_portal_mvpa_fresh` | Fresh non-destructive verification database created to confirm startup seed behavior. |

No destructive database reset/drop command was run.

## Runtime Notes

`dotnet run --project src/AipPortal.Web --configuration Release --no-build` used `src/AipPortal.Web/Properties/launchSettings.json`, forced `Development`, and listened on `http://localhost:5098`.

For clean environment verification, the app was restarted with:

```bash
ASPNETCORE_ENVIRONMENT=Test ASPNETCORE_URLS=http://127.0.0.1:5086 \
ConnectionStrings__DefaultConnection='Host=localhost;Port=5432;Database=aip_portal;Username=aip_portal;Password=...' \
dotnet run --project src/AipPortal.Web --configuration Release --no-build --no-launch-profile
```

A fresh database startup was also run on `http://127.0.0.1:5087` against `aip_portal_mvpa_fresh`.

Sensitive values in this report are redacted. Only local throwaway PostgreSQL credentials from the repository's Compose profile were used.

## Important Limitations

- No seeded or bootstrap administrator user exists after fresh startup.
- Authenticated dashboard/admin runtime verification is blocked without creating a user or invite through an approved baseline path.
- `npm test` was attempted before installing frontend dependencies and failed because `playwright` was not present in `node_modules`.
- The full `dotnet test` run passed, but the two PostgreSQL tests return early unless `POSTGRES_TEST_CONNECTION_STRING` is set. A targeted PostgreSQL test run was therefore executed separately with the local connection string.
