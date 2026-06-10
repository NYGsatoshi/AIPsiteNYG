# Final Acceptance Test Plan

This plan verifies whether the MVP is operationally usable in SaaS-style and on-prem single-tenant deployments. It is an acceptance checklist, not a claim that every item is automated.

Status labels:

- `Automated`: covered by current unit/service tests.
- `Manual`: must be checked by a human against a running app.
- `Partial`: some coverage exists, but important behavior still needs manual or integration testing.
- `Blocked`: cannot be accepted until missing implementation or infrastructure exists.

## A. SaaS Mode Tests

- Manual: app starts with `Tenancy:AppMode=SaaS`.
- Manual: tenant resolution works with the configured strategy.
- Partial: PlatformAdmin can create, view, update, suspend, activate, and archive tenants through `/api/platform/tenants`.
- Partial: Tenant Owner/Admin can manage only the current tenant.
- Automated plus manual: tenant switching requires active membership and enabled switching.
- Automated plus manual: TenantAdmin cannot access platform APIs.
- Automated plus manual: TenantA users cannot access TenantB tenant-owned records.
- Automated plus manual: suspended tenant blocks normal resolution, switching, and stale tenant-owned writes.
- Automated plus manual: feature flags apply per tenant.
- Automated plus manual: quotas apply per tenant.
- Blocked for broad SaaS pilot: production object storage adapter, HTTP tenant isolation tests, and PostgreSQL search isolation tests.

## B. OnPremSingleTenant Mode Tests

- Manual: app starts with `Tenancy:AppMode=OnPremSingleTenant`.
- Automated plus manual: configured default tenant is created/resolved when startup seed is enabled.
- Automated plus manual: tenant switching is disabled by default.
- Manual: PlatformAdmin is disabled or limited according to config.
- Manual: `LocalFileSystem` storage works at the configured root.
- Manual: backup docs match actual database and file paths.
- Manual: normal school workflow works without subdomains.
- Manual: plan/subscription behaves as license/configuration data, not as a payment dependency.

## C. Tenant Isolation Tests

- Automated: EF global filters isolate tenant-owned entities.
- Automated: new tenant-owned rows are stamped with current tenant ID.
- Automated: mismatched tenant ID writes are rejected.
- Automated: PlatformAdmin does not bypass tenant filters on normal tenant endpoints.
- Automated: audit logs, security events, notifications, files, conversations, projects, workspaces, groups, tasks, and announcements stay tenant-scoped.
- Manual gap: authenticated HTTP request-pipeline isolation.
- Manual gap: PostgreSQL-backed search isolation.

## D. Platform Admin Tests

- Automated plus manual: PlatformAdmin can list tenants.
- Automated plus manual: PlatformAdmin can suspend and activate tenants.
- Manual: PlatformAdmin can create first pilot tenant.
- Manual: PlatformAdmin can view platform overview, usage, plans, audit logs, and security events.
- Manual: PlatformAdmin setup mode is disabled after bootstrap.

## E. Tenant Admin Tests

- Manual: Tenant Owner/Admin can view tenant overview, settings, features, usage, users, audit logs, and security events.
- Manual: Tenant Owner/Admin can invite, update, suspend, reactivate, and remove tenant users where allowed.
- Automated plus manual: Tenant Owner/Admin cannot access platform APIs.
- Manual: Tenant Owner/Admin cannot switch into a tenant without active membership.

## F. Normal User Workflow Tests

- Automated plus manual: invite user.
- Automated: register by invite rejects expired, revoked, and accepted tokens.
- Automated plus manual: login.
- Manual: change password.
- Automated plus manual: suspended user cannot login.
- Manual: reactivate user.
- Manual: create workspace, group, channel, post, thread reply, and pin post.

## G. Production Tracking Workflow Tests

- Automated plus manual: create project.
- Automated plus manual: add project member.
- Manual: create milestone.
- Automated plus manual: create task.
- Automated plus manual: assign user.
- Automated plus manual: add comment.
- Manual: upload artifact.
- Manual: upload artifact version.
- Manual: view Gantt.
- Manual: view dashboard.
- Manual: view my tasks.

## H. DM And Notification Workflow Tests

- Automated plus manual: create direct conversation.
- Automated plus manual: send message.
- Automated plus manual: unread count appears.
- Manual: recipient opens conversation.
- Automated plus manual: read state updates.
- Automated plus manual: non-member cannot read conversation.
- Automated: user cannot read another user's notification.
- Automated: unread notification count excludes read notifications.

## I. File And Artifact Workflow Tests

- Manual: upload valid file.
- Automated plus manual: reject invalid extension.
- Automated plus manual: reject invalid MIME type.
- Manual: reject oversized file.
- Automated plus manual: download authorized file.
- Partial: deny unauthorized file at application/service level; HTTP download test is still needed.
- Manual: file audit log created.
- Automated: local storage key cannot escape the configured root.

## J. Backup And Export Readiness Tests

- Manual: run `POST /api/tenant/export` for metadata-only tenant export.
- Manual: verify export does not include file bodies or secrets.
- Manual: run database backup.
- Manual: back up configured file storage root or volume.
- Manual: restore into isolated environment.
- Manual: verify login, tenant selection, project lists, file metadata, authorized download, audit continuity, and `/health/ready`.
- Not ready: full tenant restore is not implemented.

## K. Deployment Smoke Tests

- Manual: local dev startup.
- Manual: Docker Compose startup.
- Manual: OnPremSingleTenant startup.
- Manual: health endpoints `/health/live` and `/health/ready`.
- Manual: migrations apply cleanly.
- Manual: HTTPS/security settings are production safe.
- Manual: shutdown/restart preserves database and file storage state.

## Acceptance Summary

- Local demo: ready after `dotnet build`, `dotnet test`, and manual smoke pass.
- Internal pilot: conditionally ready after backup/restore rehearsal and documented manual checks.
- School pilot: conditionally ready only for controlled use with local/on-prem storage and clear limitations.
- SaaS pilot: not ready until object storage, HTTP isolation tests, PostgreSQL search isolation tests, and restore drill evidence are complete.
