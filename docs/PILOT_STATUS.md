# Pilot Status

Last updated: 2026-06-08

Verification snapshot: `dotnet build AipPortal.slnx` passed with 0 errors on 2026-06-08. `dotnet test AipPortal.slnx` passed with 84 passed, 0 failed, and 0 skipped on 2026-06-08. Both commands reported NU1900 warnings because the NuGet vulnerability feed was unreachable in the sandbox.

## Ready

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
- Application-layer defense-in-depth for suspended/archived/deleted tenant writes through tenant-owned save boundaries.
- Tenant-aware shell context, tenant switcher, separated Platform Admin and Tenant Admin navigation, tenant usage/quota/feature display, and onboarding checklist UI.
- Local demo documentation, smoke checklist, API smoke examples, handoff guide, demo script, limitations note, and school-facing explanation.

## Partially Ready

- Rate limiting exists for the most sensitive implemented routes, including login, invite registration, file uploads, artifact version uploads, search, and API token creation; additional policies are recommended for password reset after that endpoint exists.
- Readiness checks database, storage configuration, and on-prem default tenant; object storage adapter checks are configuration-level until object storage is implemented.
- File sharing, upload size, extension allowlist, MIME allowlist, and quota enforcement are implemented in file upload paths; broader project/task feature gates need more service-level enforcement before pilot.
- Search is tenant-filtered through global filters and membership predicates, but lacks PostgreSQL-backed HTTP integration tests.
- PlatformAdmin tenant lifecycle is audited at service level; full HTTP audit assertions are still needed.
- Suspended tenant behavior is enforced at resolution/switching boundaries and at tenant-owned save boundaries.
- OnPremSingleTenant mode is configuration-backed and seed-aware, but every pilot installation still needs a real startup, storage, backup, and restore smoke pass.
- API smoke examples exist, but they use placeholders and must be run against a seeded environment.

## Not Implemented

- Production object-storage adapter.
- Full tenant restore.
- Password reset flow and rate-limit policy.
- API request metering middleware.
- Full WebApplicationFactory integration harness with authenticated tenant clients.
- Frontend automated tests for tenant switcher, admin navigation visibility, disabled modules, suspended tenant state, and quota warnings.
- Background job health checks.
- Full CSRF token enforcement if cookie-auth browser clients begin using unsafe methods from rendered pages.
- Live streaming, voice/video, E2EE, full billing, advanced SSO, full-text search engine, complete external integrations, advanced Gantt drag editing, and full free-form docking.

## Blockers

- Broad SaaS pilot is blocked by missing production object storage, authenticated HTTP tenant isolation tests, PostgreSQL-backed search isolation tests, and a recorded backup/restore drill.
- School pilot is blocked until the target installation passes manual smoke tests and a restore drill.
- Production use is blocked until production secrets, HTTPS, secure cookies, HSTS, admin bootstrap, and backup procedures are verified in the deployed environment.

## Known Risks

- No full HTTP authorization-boundary test harness yet.
- PostgreSQL-specific search behavior is not tested in CI.
- Local filesystem storage is acceptable for small on-prem only; SaaS should move to object storage.
- Backup/restore has documentation but should be rehearsed before real users.
- Full CSRF token enforcement and API token request authentication are not implemented.

## Required Manual Checks

- Local dev startup.
- Docker Compose startup.
- OnPremSingleTenant startup.
- SaaS-mode tenant setup.
- First admin setup and setup-mode shutdown.
- Basic user workflow from invite through suspension/reactivation.
- Workspace/group/channel post/thread/pin workflow.
- DM unread/read-state workflow.
- Announcement read confirmation workflow.
- Project/task/artifact/Gantt/dashboard/my-tasks workflow.
- File upload, invalid file rejection, authorized download, and unauthorized denial.
- TenantA/TenantB manual isolation check.
- Backup and restore drill.

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
3. Add object storage adapter for SaaS.
4. Add frontend tests for tenant/admin UI behavior once a frontend harness is chosen.
5. Run a full backup and restore drill before pilot launch.

## Recommendation

- Ready for local demo: yes, after manual smoke.
- Ready for school pilot: conditionally, only after environment-specific smoke tests and restore rehearsal pass.
- Ready for SaaS pilot: no.
- Current status: conditionally safe for an internal controlled pilot only. Unsafe for broader production SaaS until object storage, authenticated HTTP isolation tests, PostgreSQL-backed search isolation tests, and restore drill evidence are complete.
