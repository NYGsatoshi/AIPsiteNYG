# MVP-A Environment Notes

Verification date: 2026-06-24

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
