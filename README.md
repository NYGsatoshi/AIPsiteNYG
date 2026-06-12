# AIPsiteNYG

AIPsiteNYG is a tenant-aware school and organization portal built as an ASP.NET Core modular monolith. It is currently appropriate for controlled local demos and internal pilot validation. It is not yet ready for unrestricted public SaaS operation.

## Product positioning

AIPsiteNYG is designed to combine school communication and project operations in one portal: announcements, workspaces, groups, channels, direct messages, projects, tasks, files, notifications, audit logs, and tenant administration.

The main product goal is to reduce scattered school operations across chat tools, file drives, spreadsheets, and ad-hoc announcements while keeping tenant isolation and operational traceability as first-class requirements.

## Current implementation scope

Implemented or represented in the current application:

- ASP.NET Core web host with modular Domain, Application, Infrastructure, and Web projects.
- PostgreSQL-backed persistence through EF Core.
- Cookie-based browser authentication, CSRF protection, login lockout, session validation, password change, logout, and user suspension checks.
- Tenant model, tenant membership, tenant switching, tenant administration, platform administration, feature flags, quotas, and audit logging.
- Workspaces, groups, channels, posts, thread replies, pinned posts, announcements, projects, milestones, tasks, assignments, comments, files, artifacts, notifications, and tenant-scoped search foundations.
- Docker and Docker Compose based local/on-prem development flow.

## Not production-ready yet

Do not sell, expose, or operate this as a broad public service until these are closed:

- Production object storage adapter and file-body export/restore.
- Restore drills for PostgreSQL and file storage.
- Full tenant-isolation tests under hosted HTTP conditions.
- Password reset flow, API token middleware, advanced SSO/MFA, billing, and external integrations.
- Operational monitoring, incident process, and backup verification.

## Quick start

Requirements:

- .NET 10 SDK or the SDK version required by the current project files.
- PostgreSQL compatible with the configured Npgsql provider.
- Docker Desktop or compatible Docker engine for Compose workflows.

```powershell
dotnet restore AipPortal.slnx
dotnet build AipPortal.slnx
dotnet test AipPortal.slnx
```

Run database migrations:

```powershell
dotnet tool restore
dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

Run locally:

```powershell
$env:ConnectionStrings__DefaultConnection='Host=localhost;Port=5432;Database=aip_portal_dev;Username=aip_portal;Password=<local-password>'
dotnet run --project src/AipPortal.Web
```

Run with Docker Compose:

```powershell
Copy-Item .env.example .env
docker compose -f docker-compose.local.yml up --build
```

Open `http://localhost:8080` unless `AIP_PORTAL_PORT` is changed.

## Required operational rules

- Never commit production secrets, passwords, tokens, keys, or real student data.
- Disable development tenant headers and platform setup mode outside controlled setup.
- Use HTTPS, secure cookies, HSTS, and protected Data Protection keys in production-like environments.
- Back up both PostgreSQL and file storage before pilot use.
- Rehearse restore before relying on backups.

## Documentation map

Start with `docs/AI_CONTEXT.md`, then read only the focused document needed for the task:

- Architecture: `docs/ARCHITECTURE.md`
- Coding rules: `docs/CODING_RULES.md`
- Data model: `docs/DATA_MODEL.md`
- Security: `docs/SECURITY.md` and `SECURITY.md`
- Deployment: `docs/DEPLOYMENT.md`
- Operations: `docs/OPERATIONS.md`
- Roadmap and deferred work: `docs/ROADMAP.md`

Do not treat `docs/archive/` as current truth unless explicitly instructed.