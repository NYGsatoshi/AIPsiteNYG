# AIPsiteNYG

AIPsiteNYG is an ASP.NET Core modular monolith for a tenant-aware school or organization portal. It combines workspaces, groups, channels, announcements, direct messages, production tracking, file/artifact management, forms, notifications, audit logs, and tenant administration in one deployable application.

Current status: controlled local demo and internal pilot candidate. It is not ready for broad production SaaS until the documented gaps in PostgreSQL-backed search testing, object storage, and restore drills are closed.

## Supported Modes

- `Development`: local development with development tenant-header resolution available only when explicitly enabled.
- `SaaS`: hosted multi-tenant mode with platform tenant lifecycle APIs. Production SaaS still needs object storage and full HTTP isolation tests.
- `OnPremSingleTenant`: installed single-tenant mode using a configured default tenant, disabled tenant switching, and local filesystem storage.
- `OnPremMultiTenant`: documented and represented in configuration, but should be treated as pre-pilot until the same SaaS isolation tests pass.

## Core Features

- Cookie-based authentication, CSRF-protected browser API calls, invite registration, login lockout, DB-backed session validation, logout, password change, and user suspension checks.
- Tenant model, tenant membership, tenant switching, feature flags, quotas, platform admin APIs, and tenant admin APIs.
- Workspaces, groups, channels, posts, thread replies, pinned posts, and announcements with read confirmation.
- Direct conversations, messages, unread counts, read state, and member authorization.
- Projects, members, milestones, tasks, assignments, dependencies, comments, Gantt data, dashboards, and my-tasks views.
- File metadata, local filesystem storage, upload policy validation, authorized downloads, artifacts, and artifact versions.
- Database-backed notifications, tenant-scoped search, audit logs, security events, tenant metadata export, and UI shell registry foundations.

## Deferred Features

- Production object-storage adapter.
- Full tenant restore and file-body tenant export.
- Password reset flow.
- API token authentication middleware.
- Full-text search engine.
- Advanced Gantt drag editing, full free-form docking, live streaming, voice/video calls, E2EE, full billing, advanced SSO, and complete external integrations.

## Quick Start

Requirements:

- .NET 10 SDK.
- PostgreSQL 18 or another PostgreSQL version supported by the configured Npgsql provider.
- A writable file storage directory.

Restore, build, and test:

```powershell
dotnet restore AipPortal.slnx
dotnet build AipPortal.slnx
dotnet test AipPortal.slnx
```

Run migrations:

```powershell
dotnet tool restore
dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

If the local EF tool is not picked up by PowerShell, use the restored tool DLL:

```powershell
dotnet $env:USERPROFILE\.nuget\packages\dotnet-ef\10.0.8\tools\net8.0\any\dotnet-ef.dll database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

Run locally:

```powershell
$env:ConnectionStrings__DefaultConnection='Host=localhost;Port=5432;Database=aip_portal_dev;Username=aip_portal;Password=<local-password>'
dotnet run --project src/AipPortal.Web
```

Run local development with Docker Compose:

```powershell
Copy-Item .env.example .env
docker compose -f docker-compose.local.yml up --build
```

Open http://localhost:8080, or the port configured by `AIP_PORTAL_PORT`.

The Docker Compose connection string uses `Host=postgres` because the web and migration containers connect to the PostgreSQL service on the Compose network. For direct Windows execution with `dotnet run`, keep using `Host=localhost` and expose PostgreSQL with `POSTGRES_PORT`.

Reset the local Docker database:

```powershell
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml up --build
```

PostgreSQL 18 stores its Docker data below `/var/lib/postgresql`, so the Compose files mount database volumes at `/var/lib/postgresql`. If an older local volume was initialized through `/var/lib/postgresql/data`, reset it with `down -v` before starting again.

Run on-prem single-tenant defaults:

```powershell
$env:POSTGRES_PASSWORD='<strong-password>'
docker compose -f docker-compose.onprem.yml up --build
```

## Important Environment Variables

- `ConnectionStrings__DefaultConnection`
- `DataProtection__KeysPath`
- `Tenancy__AppMode`
- `Tenancy__DefaultTenantSlug`
- `Tenancy__TenantResolutionStrategy`
- `Tenancy__AllowTenantSwitching`
- `FileStorage__Provider`
- `FileStorage__RootPath`
- `FileStorage__MaxFileSizeBytes`
- `Security__CookieSecurePolicy`
- `Security__RequireHttps`
- `Security__EnableHsts`
- `Security__LoginLockoutDurationMinutes`
- `Platform__PlatformAdminSetupMode`

Do not commit production secrets. Production should use environment variables, a protected `.env`, or a secret manager.

## Admin And Security Warnings

- Do not hardcode production admin passwords.
- Disable `Platform:PlatformAdminSetupMode` outside controlled setup.
- Keep development tenant headers disabled in production.
- Use HTTPS, secure cookies, and HSTS in production.
- Back up both PostgreSQL and file storage before pilot use.
- Rehearse restore before relying on backups.

## First Docs To Read

Start with `docs/AI_CONTEXT.md`. For most development tasks, read only:

- `docs/AI_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/CODING_RULES.md`
- `docs/DATA_MODEL.md`

Then add the focused current doc only when needed:

- Security, authentication, authorization, tenancy, audit logs, file access, or privacy-sensitive changes: `docs/SECURITY.md`
- API changes: `docs/API_CONTRACTS.md`
- Deployment, Docker, configuration, environment variables, or migrations: `docs/DEPLOYMENT.md`
- Smoke tests, backup, restore, production operation, or incidents: `docs/OPERATIONS.md`
- Scope, deferred work, readiness, or priorities: `docs/ROADMAP.md`

Do not treat `docs/archive/` as current truth unless explicitly instructed.
