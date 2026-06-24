# AIPsiteNYG
仕様に関しては全て**AIPsiteNYGspec**に従うこと

AIPsiteNYG is a tenant-aware school and organization portal implemented as a .NET 10 ASP.NET Core modular monolith.

Repository audit status as of 2026-06-19: the backend contains a broad set of REST APIs, EF Core entities, PostgreSQL migrations, authorization services, and automated tests. A focused backend logic audit also identified critical defects in scoped announcement visibility, search authorization, conversation persistence, and message attachment handling. The bundled browser UI covers a smaller subset. The repository is suitable for development and controlled technical evaluation, but it is not a turnkey pilot or production deployment.

## Status language

Project documentation uses these labels:

- **Implemented**: wired into the running application and supported by direct code evidence.
- **Partially implemented**: meaningful code exists, but an end-to-end workflow, UI, integration, or enforcement layer is incomplete.
- **Planned**: described as future work and not implemented.
- **Deprecated**: retained only for compatibility or historical reference.
- **Needs verification**: source evidence is insufficient, environment-dependent, or not exercised in this audit.
- **Inferred**: behavior is concluded from code structure rather than a completed runtime check.

## Current implementation summary

| Area | Status | Evidence and limits |
| --- | --- | --- |
| ASP.NET Core host and modular projects | Implemented | `src/AipPortal.Web/Program.cs`, `AipPortal.slnx` |
| PostgreSQL and EF Core migrations | Implemented | `src/AipPortal.Infrastructure/Persistence/AppDbContext.cs`, `src/AipPortal.Infrastructure/Persistence/Migrations/` |
| Cookie login, logout, password change, CSRF, session validation, lockout | Implemented | `src/AipPortal.Application/Auth/`, `src/AipPortal.Web/Security/`, `src/AipPortal.Web/Middleware/CsrfProtectionMiddleware.cs` |
| Initial administrator bootstrap | **Not implemented** | Startup seed creates tenants/plans/UI metadata, not users; see `src/AipPortal.Infrastructure/Persistence/AppDbContextSeed.cs` |
| Invite registration | Partially implemented | Creates a user and session, but does not create tenant or workspace membership |
| Tenant filters and tenant-aware save rules | Implemented | `src/AipPortal.Infrastructure/Persistence/AppDbContext.cs` |
| Workspaces, groups, channels, messaging, projects, forms, events, files, notifications | Backend implemented; UI varies | Controllers and services exist; several browser routes are placeholders |
| Local filesystem storage | Implemented | `src/AipPortal.Infrastructure/Files/LocalFileStorageService.cs` |
| Object storage | Planned | Config names exist, but `UnsupportedObjectStorageService` is used |
| Tenant metadata export | Partially implemented | ZIP metadata export exists; file bodies and restore do not |
| Webhooks and API tokens | Foundation only | Management/validation code exists; no outbound delivery or request authentication middleware |
| Docker Compose | Partially implemented | Local profile includes migrations; on-prem profile does not |

See [AI context](docs/AI_CONTEXT.md) for the full status matrix and [known issues](docs/KNOWN_ISSUES.md) before planning work.
See [backend logic audit](docs/BACKEND_LOGIC_AUDIT.md) for controller, service, validation, error-handling, file, project, messaging, announcement, DI, and HTTP-status findings.

## Repository layout

```text
src/
  AipPortal.Domain/          Entities, enums, common domain types
  AipPortal.Application/     Use cases, DTOs, authorization, service contracts
  AipPortal.Infrastructure/  EF Core, PostgreSQL, repositories, files, audit, search
  AipPortal.Web/             Startup, middleware, controllers, static browser UI
tests/
  AipPortal.Tests/           Unit, service, HTTP, tenancy, and PostgreSQL-conditional tests
  ui/                        Playwright tests against static assets with mocked APIs
docs/                        Active documentation
docs/archive/                Historical plans, reports, specifications, and status snapshots
```

## Development start

Requirements:

- .NET 10 SDK
- PostgreSQL
- Node.js 24 for the UI test workflow
- Docker and Docker Compose for container workflows

```bash
dotnet restore AipPortal.slnx
dotnet tool restore
dotnet ef database update \
  --project src/AipPortal.Infrastructure \
  --startup-project src/AipPortal.Web
dotnet run --project src/AipPortal.Web
```

Set `ConnectionStrings__DefaultConnection` to a PostgreSQL connection string with valid credentials before applying migrations or starting the app.

For the local Compose profile:

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up --build
```

The local profile migrates the database and seeds a default tenant. It does **not** seed a login user or administrator. A supported first-admin bootstrap workflow is a known missing feature.

## Verification snapshot

On 2026-06-18:

- `dotnet test AipPortal.slnx --configuration Release --no-restore --disable-build-servers -m:1` passed 123 tests with one compile warning.
- `POSTGRES_TEST_CONNECTION_STRING` was unset, so the two PostgreSQL tests returned without executing their database assertions even though the test runner counted them as passed.
- All three Compose files passed `docker compose ... config --quiet` when a validation-only `POSTGRES_PASSWORD` was supplied where required.
- Playwright tests were not run because locked frontend dependencies were not installed in this workspace.

See [testing](docs/TESTING.md) for exact interpretation.

## Documentation

- [AI context](docs/AI_CONTEXT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Database](docs/DATABASE.md)
- [Testing](docs/TESTING.md)
- [Known issues](docs/KNOWN_ISSUES.md)
- [Backend logic audit](docs/BACKEND_LOGIC_AUDIT.md)
- [Coding rules](docs/CODING_RULES.md)
- [API conventions](docs/API_CONTRACTS.md)
- [Operations](docs/OPERATIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Archive index](docs/archive/README.md)

Archived documents are historical evidence, not current project truth.
