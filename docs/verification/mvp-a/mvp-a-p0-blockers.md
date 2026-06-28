# MVP-A P0 Blockers

Verification date: 2026-06-24

## P0-001: Fresh MVP-A Startup Has No Usable Login/Admin Bootstrap

Status: Open

Classification: P0

Affected areas: Auth / Login, Tenant / User / Role, Authorization, Dashboard reachability, AuditLog verification

Evidence:

- `src/AipPortal.Infrastructure/Persistence/AppDbContextSeed.cs` seeds tenants, plans, UI shell metadata, modules, panels, commands, and radial menus. It does not seed a user, password, invite, tenant membership, workspace membership, or administrator.
- Fresh database verification against `aip_portal_mvpa_fresh` after migrations and Test startup produced:
  - `tenants = 1`
  - `plans = 4`
  - `users = 0`
  - `tenant_users = 0`
- `GET /api/auth/status` returned `200` with `{"isAuthenticated":false}`.
- `GET /api/auth/me` and `GET /api/admin/users` returned `401 Unauthorized`.
- `POST /api/auth/login` with a valid CSRF token and non-existent credentials returned `401` with the generic error `Invalid email or password.`

Impact:

The login endpoint exists and rejects invalid credentials correctly, but a fresh MVP-A baseline has no supported way to authenticate as an administrator or regular user. Authenticated dashboard reachability, admin APIs, role behavior, tenant membership enforcement, 403 behavior for non-admin users, and runtime AuditLog coverage for authenticated core actions cannot be fully verified from a fresh baseline.

Required next action:

Add the smallest approved first-admin/bootstrap path or documented local seed path for MVP-A verification. The fix should create only the minimum local/dev verification identity and membership needed to verify existing auth and authorization behavior. Do not add production account management scope.

## P0-002: End-to-End Authorization Verification Is Blocked By Missing Baseline Identity

Status: Open, blocked by P0-001

Classification: P0

Affected areas: Authorization, Tenant / User / Role, File / Messaging permission checks, Dashboard reachability

Evidence:

- Anonymous protected APIs were verified as protected:
  - `GET /api/auth/me` returned `401`.
  - `GET /api/admin/users` returned `401`.
  - `GET /api/projects` returned `401`.
  - `GET /api/ui/modules` returned `401`.
- Static inspection found broad controller-level `[Authorize]` coverage and admin role attributes, including `AdminController` and `PlatformTenantsController`.
- Automated tests passed for many authorization services, including tenancy isolation, admin access denial, organization authorization, projects, files, and auth session security.
- Runtime role/tenant negative tests requiring logged-in non-admin and admin users could not be performed on a fresh baseline because no user, role, tenant membership, or session can be created through startup seed.

Impact:

Server-side authorization appears materially implemented by code and tests, but MVP-A cannot mark Authorization as Pass because direct runtime evidence for admin vs non-admin and tenant boundary behavior is blocked.

Required next action:

After P0-001, run a narrow authorization smoke suite with a seeded/admin identity and a non-admin tenant member:

- Admin endpoint as anonymous: expect 401.
- Admin endpoint as non-admin: expect 403.
- Admin endpoint as admin: expect 200 or expected domain response.
- Tenant-scoped data as wrong tenant/member: expect not found or forbidden according to API contract.
- File download as unauthorized user: expect not found or forbidden according to API contract.

## Not P0 Based On Current Evidence

- Build: Pass after rerun with escalated MSBuild process permissions.
- Database migrations: Pass against local PostgreSQL.
- Startup: Pass against local PostgreSQL in Test environment.
- Health: Pass for `/health/live` and `/health/ready`.
- AuditLog implementation: Present, but runtime coverage is partial/blocked by P0-001.
- CI configuration: Present, but local UI test execution is blocked by missing frontend dependencies. Classified as P1 for local verification.

## A-01 Baseline Refresh Note

Refresh date: 2026-06-28

The A-01 evidence baseline is recorded in `docs/evidence/mvp-a/a-01-build-test-baseline.md` and `docs/evidence/mvp-a/a-01-baseline-failure-log.md`.

The .NET restore/build/test baseline passed on the Windows host. Docker/container evidence remains blocked by local Docker Desktop Linux engine availability, and live PostgreSQL assertions remain Needs verification because no local/dev PostgreSQL connection string was provided. These results do not change P0-001 or P0-002 and do not imply MVP-A Go or production readiness.
