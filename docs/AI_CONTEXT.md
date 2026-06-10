# AI Context

This is the entry point for future Codex work on AIP Portal.

AIP Portal is an ASP.NET Core modular monolith for a tenant-aware school or organization operations portal. It supports workspaces, groups, channels, announcements, direct messages, projects, tasks, files/artifacts, forms/events foundations, notifications, search, audit logs, tenant administration, and platform administration.

Current status: controlled local demo and internal/on-prem pilot candidate. It is not ready for broad production SaaS until object storage, PostgreSQL-backed search isolation tests, and a recorded restore drill are complete.

## Current Stack

- .NET 10 / ASP.NET Core
- C#
- EF Core
- PostgreSQL
- Cookie authentication for the bundled browser UI
- REST APIs as the source of truth
- Docker and Docker Compose support
- Local filesystem file storage for development and small on-prem pilots

## Architecture Summary

The app is one deployable ASP.NET Core application split into four projects:

- `AipPortal.Web`: startup, middleware, controllers, static frontend assets.
- `AipPortal.Application`: use cases, authorization, DTOs, audit/notification orchestration.
- `AipPortal.Domain`: entities, enums, domain primitives.
- `AipPortal.Infrastructure`: EF Core, PostgreSQL persistence, migrations, file storage, search, infrastructure services.

Keep the modular monolith. Do not introduce microservices or new platform dependencies without an explicit product need.

## Security Rules

- Never store or log raw passwords, session keys, invite tokens, API tokens, webhook secrets, signed URLs, or file contents.
- Return DTOs from APIs; never return EF entities directly.
- Enforce authorization in Application services, not only controller attributes.
- Use pagination for any potentially large list.
- Validate uploads by authorization, feature flag, quota, size, extension, MIME type, and generated storage key.
- Keep production configuration in environment variables or a secret manager.
- Keep `Platform:PlatformAdminSetupMode` and development tenant headers disabled outside controlled setup/development.

## Multi-Tenant Rules

Tenant is the highest-level isolation boundary.

- Tenant-owned entities must include `TenantId` and implement `ITenantEntity`.
- Normal tenant endpoints must use the current server-side tenant context; never trust `TenantId` from request bodies.
- EF global query filters are part of isolation and must not be bypassed in normal services.
- `IgnoreQueryFilters` is allowed only in explicit platform/tenant infrastructure paths with tenant predicates.
- PlatformAdmin uses `/api/platform/*`; tenant admins operate only inside the current tenant.
- File storage keys must be tenant-namespaced, for example `tenants/{tenantId}/files/{fileId}`.

## What Codex Should Read

For most tasks, read only:

- `docs/AI_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/CODING_RULES.md`
- `docs/DATA_MODEL.md`

For security, authentication, authorization, tenancy, audit logs, file access, integrations, API tokens, or privacy-sensitive changes, also read:

- `docs/SECURITY.md`

For deployment, Docker, configuration, environment variables, migrations, backup, restore, smoke tests, or production operation, also read:

- `docs/DEPLOYMENT.md`
- `docs/OPERATIONS.md`

For API changes, also read:

- `docs/API_CONTRACTS.md`

For scope, deferred work, readiness, or prioritization questions, also read:

- `docs/ROADMAP.md`

Do not read `docs/archive/` unless explicitly instructed. Archived documents are historical and may be outdated.

## Active Documentation Map

- `docs/ARCHITECTURE.md`: solution structure, layers, request flow, persistence, files, notifications, search, audit, UI shell.
- `docs/CODING_RULES.md`: coding, layering, API, security, testing, and documentation rules.
- `docs/DATA_MODEL.md`: entity model, conventions, tenant ownership, soft delete, feature foundations.
- `docs/SECURITY.md`: detailed current security, tenancy, authorization, file access, secrets, and known security limitations.
- `docs/API_CONTRACTS.md`: API conventions, DTO rules, errors, validation, auth expectations, pagination.
- `docs/DEPLOYMENT.md`: local, Docker, SaaS, on-prem, configuration, environment variables, migrations.
- `docs/OPERATIONS.md`: smoke tests, backups, restore drills, production checklist, incident handling.
- `docs/ROADMAP.md`: MVP scope, deferred features, current blockers, technical debt, and near-term work.

Root `README.md` is the quick-start summary. Root `SECURITY.md` is the vulnerability reporting policy.
