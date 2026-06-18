# Known Issues

Last implementation audit: 2026-06-18.

This list records confirmed implementation/documentation mismatches and major unknowns. It is not limited to defects already filed in GitHub.

## High priority

### KI-001: No supported first-administrator bootstrap

- Status: confirmed missing.
- Evidence: `AppDbContextSeed.cs` creates tenants, plans, and optional UI-shell data only.
- Mismatch: deployment and operations docs previously assumed a controlled bootstrap procedure and meaningful `PlatformAdminSetupMode`.
- Impact: a fresh installation cannot reach authenticated admin workflows without an external/manual database procedure.
- Suggested issue: **Implement a secure first-PlatformAdmin bootstrap workflow**.

### KI-002: Invite registration does not create membership

- Status: partially implemented.
- Evidence: `AuthService.RegisterByInviteAsync` creates `User` and `Session` and marks the invite accepted, but creates no `TenantUser` or `WorkspaceMember`.
- Impact: the new cookie can be rejected on tenant API routes because active tenant membership is required.
- Suggested issue: **Complete invite acceptance with tenant and workspace membership transaction**.

### KI-003: Feature and platform configuration switches are not enforcement gates

- Status: confirmed mismatch.
- Evidence: `FeatureOptions` is only bound; most `PlatformOptions` values are never read outside binding. Tenant feature checks use `FeatureFlagService`.
- Impact: operators can believe webhooks, API tokens, platform admin, forms, or other modules are disabled when routes remain available to authorized users.
- Suggested issue: **Wire app configuration switches into route/service authorization or remove them**.

### KI-004: Object storage is configuration-only

- Status: planned.
- Evidence: object provider names resolve to `UnsupportedObjectStorageService`; readiness returns false for them.
- Impact: SaaS example configurations cannot store or read files.
- Suggested issue: **Implement and test an S3-compatible object-storage adapter**.

### KI-005: On-prem Compose cannot initialize a fresh database

- Status: confirmed deployment gap.
- Evidence: `docker-compose.onprem.yml` has no migration service; the app does not apply migrations.
- Impact: startup seed queries an absent schema on a fresh database.
- Suggested issue: **Add controlled migrations to the on-prem Compose workflow**.

### KI-006: Reverse-proxy HTTPS behavior is not implemented end to end

- Status: needs verification.
- Evidence: production requires HTTPS/HSTS, but `Program.cs` does not configure forwarded-header middleware and Compose includes no TLS proxy.
- Impact: redirect loops, incorrect scheme detection, or incorrect host-based tenant resolution are possible.
- Suggested issue: **Add trusted forwarded-header configuration and reverse-proxy integration tests**.

## Medium priority

### KI-007: Frontend current-user contract uses the wrong ID property

- Status: confirmed mismatch.
- Evidence: backend serializes `CurrentUserResponse.UserId`; frontend messaging/announcement logic reads `user.id`.
- Impact: own-message detection, conversation titles, and author edit checks can be wrong.
- Test gap: Playwright mocks return `id`, hiding the mismatch.
- Suggested issue: **Align frontend auth DTO usage and add a real contract test**.

### KI-008: Browser navigation overstates implemented UI

- Status: confirmed mismatch.
- Evidence: `/workspaces`, `/groups`, `/channels`, `/tasks`, `/artifacts`, `/calendar`, `/forms`, and search results render placeholders.
- Backend APIs exist for many of these areas.
- Suggested issue: **Label or hide placeholder navigation until workflows are implemented**.

### KI-009: Playwright does not test the real backend

- Status: known test limitation.
- Evidence: static server plus route interception in `tests/ui/`.
- Impact: DTO, authentication, CSRF, and route mismatches can pass UI tests.
- Suggested issue: **Add a small end-to-end Playwright profile against the ASP.NET Core test host**.

### KI-010: API error contract is inconsistent

- Status: confirmed mismatch.
- Evidence: global exceptions use `ErrorResponse(Code, Message, TraceId)`; many controllers return `{ error }`; authorization/not-found failures frequently return 400.
- Mismatch: `docs/API_CONTRACTS.md` described one shared error shape.
- Suggested issue: **Standardize API problem/error responses and status mapping**.

### KI-011: PostgreSQL tests silently pass when not configured

- Status: confirmed test issue.
- Evidence: tests return when `POSTGRES_TEST_CONNECTION_STRING` is absent.
- Impact: local “all green” results may not execute PostgreSQL assertions.
- Suggested issue: **Make PostgreSQL tests explicitly skip or fail when the category is requested without configuration**.

### KI-012: Tenant export is not backup or restore

- Status: partial feature.
- Evidence: metadata ZIP is generated in memory; file bodies are excluded; no import exists.
- Suggested issue: **Define tenant export completeness and implement a separately reviewed restore design**.

### KI-013: Admin and tenant-management browser UIs are mostly read-only

- Status: partial UI.
- Evidence: admin pages show summaries, tenants, plans, usage, and features, but do not expose most mutation APIs.
- Suggested issue: **Define supported admin UI scope and implement the minimum safe management flows**.

### KI-014: Tenant “invite” endpoint only adds an existing user

- Status: naming mismatch.
- Evidence: `POST /api/tenant/users/invite` accepts `UserId` and calls `AddCurrentTenantUserAsync`.
- Impact: it is not an email/token invitation workflow.
- Suggested issue: **Rename tenant user add endpoint or implement a real tenant invitation flow**.

## Low priority and compatibility debt

### KI-015: `SystemAdmin` is a compatibility alias

- Status: deprecated naming.
- Evidence: `SystemRole.SystemAdmin = PlatformAdmin`.
- Impact: mixed naming persists in controller role strings and services.
- Suggested issue: **Normalize PlatformAdmin naming while preserving serialized compatibility**.

### KI-016: Dockerfile uses .NET 10 preview image tags

- Status: needs verification.
- Evidence: `mcr.microsoft.com/dotnet/*:10.0-preview`.
- Impact: image provenance and long-term availability differ from stable tags.
- Suggested issue: **Move Dockerfile to reviewed stable .NET 10 image tags**.

### KI-017: File scan records exist without a scanning pipeline

- Status: foundation only.
- Evidence: `FileScanResult` and scan status fields exist; no scanner or background worker was found.
- Suggested issue: **Define malware-scanning behavior before accepting untrusted pilot uploads**.

### KI-018: Archived status reports contain resolved and stale claims

- Status: documentation mismatch.
- Evidence: `docs/archive/status/PILOT_STATUS.md` and reports describe older test counts and missing controls that were later added.
- Resolution: keep them archived and use `docs/archive/README.md` for context.

## Planned features, not current capabilities

- Password reset delivery.
- API token authentication middleware and request metering.
- Outbound webhook delivery.
- Object storage and signed URLs.
- Full tenant restore.
- Email delivery.
- SSO/MFA.
- Realtime messaging/notifications.
- Background jobs and scheduled reminders.
- Full billing/payment integration.
- Advanced Gantt/resource planning.
- Full free-form docking/radial UI.

## Unknowns requiring audit evidence

- Latest GitHub Actions result for the docs branch.
- Successful startup of each Compose profile.
- First-user provisioning used by any existing deployment.
- Real target-environment tenant isolation.
- Reverse-proxy scheme and host behavior.
- Backup retention and a successful restore drill.
- Production PostgreSQL and storage versions.
- Real-data performance and query plans.

## Documentation still missing

- A truthful first-administrator bootstrap runbook; blocked until the workflow exists.
- A generated or maintained endpoint inventory/OpenAPI contract.
- A frontend/backend DTO compatibility guide.
- A production reverse-proxy example with trusted proxy configuration.
- A target-environment deployment record showing exact versions and settings.
- A completed backup/restore drill record.
- Data classification, retention, deletion, and privacy requirements for real school data.
- An incident-response ownership/escalation matrix.
- A supported-browser and accessibility conformance statement.

## Recommended follow-up audits

1. Run the full GitHub Actions workflow and attach results to the documentation PR.
2. Exercise each Compose profile from an empty volume and record startup failures.
3. Design and threat-model first-admin bootstrap before implementation.
4. Trace invite acceptance through user, tenant membership, workspace membership, and session validation.
5. Compare every frontend API call and mocked fixture with the real DTOs/controllers.
6. Audit all `IgnoreQueryFilters` calls and all tenant-owned entities.
7. Run cookie-authenticated cross-tenant tests against PostgreSQL.
8. Test deployment behind the intended TLS reverse proxy.
9. Execute and record PostgreSQL plus file-storage backup/restore.
10. Decide which placeholder UI routes should be hidden, labeled, or completed.
