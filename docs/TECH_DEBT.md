# Technical Debt

## TD-001

Title: Add authenticated HTTP tenant isolation test harness
Area: Security
Severity: High
Description: Existing tenant isolation coverage is mostly EF/service-level. It does not yet prove the full ASP.NET Core request pipeline, cookie auth, tenant middleware, and controller routing boundaries with TenantA/TenantB/PlatformAdmin clients.
Risk: SaaS regressions could slip through if a controller or route bypasses an application-layer authorization expectation.
Suggested fix: Add `WebApplicationFactory` integration tests with seeded tenants, authenticated clients, tenant resolution variants, and cross-tenant negative assertions for major APIs.
Fixed now: no
Owner suggestion: Security

## TD-002

Title: Add PostgreSQL-backed search isolation tests
Area: Search
Severity: High
Description: Search uses provider-specific `ILike` predicates and visibility joins. Current tests do not fully exercise PostgreSQL execution for tenant-scoped search requests.
Risk: Search could leak or omit tenant data under provider-specific behavior that EF InMemory cannot detect.
Suggested fix: Add PostgreSQL integration tests for workspace/group/channel/message/project/task/artifact search across TenantA and TenantB.
Fixed now: no
Owner suggestion: Backend

## TD-003

Title: Enforce suspended tenant status inside write services
Area: Tenancy
Severity: High
Description: Suspended tenants are rejected at resolution and switching boundaries, but application services generally trust the current tenant context once established.
Risk: A long-lived authenticated session could continue writes if tenant status changes after tenant resolution has already occurred.
Suggested fix: Add a reusable application-layer guard for write use cases, or enrich current tenant context with active status checks per request.
Fixed now: yes
Resolution: `AppDbContext.SaveChanges` and `SaveChangesAsync` now verify the current tenant is still Active before saving normal tenant-owned data. Added tests for stale suspended tenant writes and active tenant writes in `TenantIsolationSecurityTests`.
Owner suggestion: Backend

## TD-004

Title: Implement production object storage adapter
Area: File storage
Severity: High
Description: Object storage providers are configuration placeholders. SaaS examples point to object storage, but the runtime adapter is currently unsupported.
Risk: Production SaaS cannot meet durable multi-tenant file storage expectations without a real object storage backend.
Suggested fix: Implement S3-compatible/object-storage adapter with authorized downloads, no raw permanent URL exposure, and storage health checks.
Fixed now: no
Owner suggestion: Infra

## TD-005

Title: Add full CSRF enforcement for cookie-auth unsafe methods
Area: Security
Severity: Medium
Description: Configuration contains an `EnableCsrfProtection` switch, but API controllers do not currently enforce antiforgery tokens for browser cookie-auth POST/PATCH/DELETE requests.
Risk: If the browser UI uses cookies for authenticated unsafe methods, cross-site requests could trigger state changes.
Suggested fix: Add antiforgery token issuance and validation for cookie-auth browser clients, or move unsafe API calls to a token pattern that is not automatically sent cross-site.
Fixed now: no
Owner suggestion: Security

## TD-006

Title: Complete API token authentication middleware
Area: Integrations
Severity: Medium
Description: API token creation, hashing, revocation, expiry, and validator service exist, but no middleware currently authenticates requests and sets tenant context from API tokens.
Risk: API token readiness can be overstated; tokens are foundation-only until request authentication and tenant context binding are implemented.
Suggested fix: Add authentication handler/middleware, scope checks, tenant context assignment, rate limiting, and request metering.
Fixed now: no
Owner suggestion: Backend

## TD-007

Title: Rehearse backup and restore before pilot
Area: Operations
Severity: Medium
Description: Backup/restore documentation exists, but the review did not verify a successful restore drill.
Risk: Recovery time and data consistency are unknown for a real incident.
Suggested fix: Run a test restore of database plus file storage, record the result, and update the operation manual with measured steps.
Fixed now: no
Owner suggestion: Infra

## TD-008

Title: Add direct service tests for MIME type upload rejection
Area: File storage
Severity: Low
Description: Upload policy now exposes allowed MIME types and upload services enforce them, but current tests only cover the policy/config surface and local storage behavior.
Risk: Future refactors could accidentally skip MIME validation in one upload path.
Suggested fix: Add focused `FileService` and `ArtifactService` tests for rejected content types and accepted extension/content-type pairs.
Fixed now: no
Owner suggestion: Backend
