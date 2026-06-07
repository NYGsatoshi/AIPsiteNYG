# Pilot Operation Manual

## Create A Tenant

Use a PlatformAdmin account and the platform tenant API:

- List tenants: `GET /api/platform/tenants`
- Create tenant: `POST /api/platform/tenants`
- Suspend tenant: `POST /api/platform/tenants/{tenantId}/suspend`
- Activate tenant: `POST /api/platform/tenants/{tenantId}/activate`

Platform operations must not be performed through normal tenant endpoints.

## Invite Or Add A Tenant Admin

Current tenant-user management is available through tenant administration APIs. Add a user to the current tenant as `Owner` or `Admin`, then verify they can manage only that tenant.

Do not send raw invite tokens through logs or support tickets.

## Add Users

Tenant owners/admins should add or update tenant users only inside the current tenant context. Confirm the target user appears only in the intended tenant.

## Create Workspace, Group, Project, And Task

Typical pilot flow:

1. Create a workspace.
2. Add workspace members.
3. Create a group inside the workspace.
4. Add group members.
5. Create a project inside the workspace or group.
6. Add project members.
7. Create tasks and assignments.

After each step, verify another tenant user cannot see the new record.

## Suspend A User

Use tenant user status controls for tenant-local suspension. Platform-level account suspension should be reserved for cases where the user must be blocked across all tenants.

Record the reason in an audit-safe summary. Do not include sensitive message bodies or secrets.

## Suspend A Tenant

Only PlatformAdmin should suspend or activate tenants. Suspension should be used for contract, security, or operational incidents. After suspension:

- Confirm tenant resolution fails.
- Confirm normal users cannot access tenant app routes.
- Confirm PlatformAdmin can still view tenant status.
- Record the reason and operator.

## Check Usage

Use tenant administration usage APIs and compare:

- Active user count.
- Project count.
- Task count.
- File count.
- Storage used.
- API request counters when metering is implemented.

## Check Audit Logs

Tenant admins can view current-tenant audit logs. Platform admins should use platform-specific APIs for cross-tenant review. Never query audit logs by raw database access for routine support unless an incident requires it.

## Handle File Upload Issues

1. Check `FileStorage` configuration.
2. Check allowed extensions and maximum size.
3. Check tenant `FileSharing` feature flag.
4. Check tenant upload and storage quota.
5. Check local storage root or object bucket permissions.
6. Confirm no path traversal or user-provided path was accepted.

## Take Backup

Before a pilot change window:

1. Run PostgreSQL backup.
2. Back up file storage root or bucket.
3. Back up config and secrets through the approved secret manager.
4. Record backup time and operator.
5. Restore into a test environment on a schedule.

## Report Incident

Capture:

- Time and tenant.
- Actor user if known.
- Affected resources.
- TraceId or correlation ID.
- Audit/security event IDs.
- Operator actions taken.

Do not paste passwords, raw tokens, invite token values, API token raw values, webhook secrets, signed URLs, or sensitive message bodies into incident notes.
