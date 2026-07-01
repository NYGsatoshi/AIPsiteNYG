# AIPsiteNYG
### 仕様に関しては全て[AIPsiteNYGspec](https://github.com/NYGsatoshi/AIPsiteNYGspec)に従うこと


AIPsiteNYG is a tenant-aware school and organization portal implemented as a .NET 10 ASP.NET Core modular monolith.

Repository audit status as of 2026-06-19: the backend contains a broad set of REST APIs, EF Core entities, PostgreSQL migrations, authorization services, and automated tests. A focused backend logic audit also identified critical defects in scoped announcement visibility, search authorization, conversation persistence, and message attachment handling. The MVP-A P0 user-facing frontend target is Angular under `frontend/`; hosted build artifacts are copied into `src/AipPortal.Web/wwwroot`. The repository is suitable for development and controlled technical evaluation, but it is not a turnkey pilot or production deployment.

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
| Initial administrator bootstrap | Implemented for Development | `LocalAdmin__SeedOnStartup` can seed or update a development admin user; do not use this as a production bootstrap workflow |
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
  AipPortal.Web/             Startup, middleware, controllers, hosted Angular artifacts
frontend/                    Angular frontend source
tests/
  AipPortal.Tests/           Unit, service, HTTP, tenancy, and PostgreSQL-conditional tests
  ui/                        Playwright infrastructure; legacy static-SPA specs are obsolete
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

The local profile migrates the database and seeds a default tenant. In `Development`, it can also seed a local administrator from the `LOCAL_ADMIN_*` values in `.env`.

## GCP Compute Engine development deployment

This repository includes a Docker Compose deployment path for a single Google Compute Engine VM with PostgreSQL running inside Compose.

Start from Windows PowerShell in VSCode:

```powershell
gcloud init
gcloud auth login
gcloud config set project YOUR_GCP_PROJECT_ID
.\deploy\gcp\create-vm.ps1 -ProjectId YOUR_GCP_PROJECT_ID -Zone us-central1-a -VmName aipsite-dev
gcloud compute ssh aipsite-dev --zone us-central1-a
```

On the VM:

```bash
bash ~/aipsite-gcp/gcp/bootstrap-vm.sh
exit
```

Reconnect from Windows PowerShell so Docker group membership is active, then deploy:

```powershell
gcloud compute ssh aipsite-dev --zone us-central1-a
```

On the VM:

```bash
bash ~/aipsite-gcp/gcp/deploy-app.sh
```

Then open `http://EXTERNAL_IP:8080`. For updates that keep the database volume, run:

```bash
bash ~/aipsite-gcp/gcp/update-app.sh
```

See [deploy/gcp/README.md](deploy/gcp/README.md) for VM creation, Docker setup, environment variables, logs, reset commands, and common error fixes. This is a development deployment; production should add HTTPS/reverse proxying, backups, monitoring, and hardened secret management.

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
