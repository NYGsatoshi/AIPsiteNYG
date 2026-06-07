# Pilot Status

## Implemented

- Modular ASP.NET Core app with application, domain, infrastructure, and web layers.
- Tenant model, tenant membership, tenant settings, plans, subscriptions, and usage records.
- EF global query filters for `ITenantEntity`.
- Tenant stamping and mismatched TenantId rejection in `AppDbContext`.
- Tenant resolver for SaaS/on-prem strategies.
- PlatformAdmin tenant lifecycle APIs.
- Tenant switching with active membership checks.
- OnPremSingleTenant default tenant support and switching disabled.
- Suspended tenant resolution rejection.
- File storage abstraction with local filesystem implementation.
- Tenant-namespaced file storage keys.
- File upload policy and quota hooks.
- Feature-flag service with tenant overrides.
- Audit logs and security events.
- Global exception middleware with safe production errors and TraceId.
- `/health/live` and `/health/ready`.
- HSTS, HTTPS redirection, secure cookie configuration, and baseline security headers.
- Named rate-limit policies for login, invite registration, file upload, search, and API token creation.
- Tenant isolation/security tests and CI workflow.

## Partially Implemented

- Rate limiting exists for the most sensitive implemented routes; additional policies are recommended for password reset after that endpoint exists.
- Readiness checks database, storage configuration, and on-prem default tenant; object storage adapter checks are configuration-level until object storage is implemented.
- File sharing and quota enforcement are implemented in file upload paths; broader project/task feature gates need more service-level enforcement before pilot.
- Search is tenant-filtered through global filters and membership predicates, but lacks PostgreSQL-backed HTTP integration tests.
- PlatformAdmin tenant lifecycle is audited at service level; full HTTP audit assertions are still needed.
- Suspended tenant behavior is enforced at resolution/switching boundaries; active sessions should also be checked for writes.

## Not Implemented

- Production object-storage adapter.
- Full tenant restore.
- Password reset flow and rate-limit policy.
- API request metering middleware.
- Full WebApplicationFactory integration harness with authenticated tenant clients.
- Background job health checks.
- Full CSRF token enforcement if cookie-auth browser clients begin using unsafe methods from rendered pages.

## Known Risks

- No full HTTP authorization-boundary test harness yet.
- PostgreSQL-specific search behavior is not tested in CI.
- Suspended tenant write blocking may rely on request tenant resolution instead of every application service checking tenant status.
- Local filesystem storage is acceptable for small on-prem only; SaaS should move to object storage.
- Backup/restore has documentation but should be rehearsed before real users.

## Security Limitations

- Do not enable development tenant headers in production.
- Do not enable PlatformAdmin setup mode in production.
- Do not expose signed storage URLs without authorization.
- Do not accept TenantId from request bodies.
- Do not use `IgnoreQueryFilters` in normal application services.

## Operational Limitations

- Tenant export is metadata-only.
- Restore is full-system restore only; tenant-level restore is future work.
- Usage metering is not complete for API request counts.
- Object storage readiness is configuration-only until a production adapter is added.

## Recommended Next Work

1. Add HTTP integration tests with authenticated TenantA/TenantB/PlatformAdmin clients.
2. Add PostgreSQL-backed search isolation tests.
3. Enforce suspended tenant status in write services as a defense-in-depth check.
4. Add object storage adapter for SaaS.
5. Run a full backup and restore drill before pilot launch.

## Pilot Readiness

Current status: conditionally safe for an internal controlled pilot only after backup/restore is rehearsed and the HTTP authorization test harness is added. Unsafe for broader production SaaS until object storage and full request-pipeline authorization tests are complete.
