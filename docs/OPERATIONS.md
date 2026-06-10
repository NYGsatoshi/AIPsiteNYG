# Operations

This is the active runbook for smoke tests, backup, restore, production checks, and incidents. Deployment setup lives in `docs/DEPLOYMENT.md`.

## Readiness Rule

Do not treat an environment as pilot-ready until these pass in that environment:

- App starts.
- `/health/live` and `/health/ready` pass.
- Migrations have applied.
- Login works.
- Tenant resolution works.
- TenantA/TenantB isolation is verified.
- File upload/download authorization works.
- Backup and restore drill is recorded.

## Smoke Test

Run this before a local demo, internal pilot handoff, or on-prem school demonstration.

1. Start PostgreSQL and the app.
2. Apply migrations.
3. Check `/health/live` and `/health/ready`.
4. Sign in as PlatformAdmin.
5. Create or verify a tenant.
6. Add a tenant owner/admin.
7. Sign in as tenant admin.
8. Confirm tenant admin cannot call `/api/platform/*`.
9. Confirm a TenantA user cannot access TenantB records by URL or API.
10. Invite/register a normal user.
11. Create a workspace, group, channel, post, project, task, and comment.
12. Upload a valid file and download it through an authorized user.
13. Try invalid extension, invalid MIME type, oversized upload, and unauthorized download.
14. Trigger a notification and verify another user cannot mark it read.
15. Stop and restart the app; verify login, tenant context, uploaded files, and project/task data persist.

OnPremSingleTenant checks:

- `Tenancy:AppMode=OnPremSingleTenant`.
- Configured default tenant exists.
- Tenant switching is hidden/disabled.
- Local file storage root is writable and backed up.
- Plans/subscriptions are treated as license/configuration data, not payment.

SaaS checks:

- Tenant resolution uses host/subdomain/session outside development.
- Development tenant header is disabled in production.
- PlatformAdmin and TenantAdmin separation works.
- Suspended tenants cannot resolve normal tenant routes.

## Production Checklist

- HTTPS enabled at reverse proxy or hosting layer.
- Secure cookies enabled in production.
- CSRF protection enabled for cookie-authenticated unsafe browser requests.
- Data Protection keys persisted outside the container/process.
- Production connection string configured through environment variables or secrets.
- File storage path, volume, or bucket configured and backed up.
- Database backup configured.
- Restore tested.
- Admin account created through controlled bootstrap.
- Default passwords removed.
- Allowed upload extensions and MIME types reviewed.
- Upload size reviewed.
- Audit logs enabled.
- Error responses do not expose stack traces.
- CORS reviewed.
- Rate limiting reviewed for login, invite, file upload, search, and token endpoints.
- Server firewall and reverse proxy configured.
- Raw passwords, tokens, invite tokens, signed URLs, and message/file contents excluded from logs.

## Backup

AIP Portal recovery has two layers:

- Full-system backup and restore for operators.
- Tenant metadata export for school-by-school portability and future migration.

The MVP implements tenant metadata export only. It does not implement full tenant restore.

Back up:

- PostgreSQL database.
- File storage root, NAS path, MinIO bucket, S3/object bucket, or Docker upload volume.
- Non-secret configuration.
- Secrets through the approved vault/secret-manager recovery process.
- Docker Compose files, reverse proxy config, TLS renewal config, and operator runbooks.

PostgreSQL backup example:

```bash
pg_dump --format=custom --file=aipportal.backup "$AIPPORTAL_DATABASE_URL"
```

Recommended SaaS schedule:

- Database: daily full backup plus point-in-time recovery if available.
- Object storage: versioning or daily bucket backup.
- Configuration: on every deployment change.
- Secrets: secret-manager recovery enabled and tested.
- Audit logs: retain according to contract and platform policy.

## Restore Drill

Untested backups are not backups. Each pilot environment must record at least one successful restore drill before real school data is relied on.

1. Create an isolated restore environment.
2. Restore PostgreSQL from the backup.
3. Restore file storage from the same recovery point.
4. Restore configuration and secrets.
5. Confirm the app version and apply pending migrations only when appropriate.
6. Start the app.
7. Check `/health/live` and `/health/ready`.
8. Sign in as an admin test account.
9. Verify tenant selection, project lists, file metadata, authorized download, and audit continuity.
10. Run manual TenantA/TenantB isolation checks.
11. Record restore time, operator, failures, and follow-up actions.

Future tenant-level restore must never overwrite another tenant, must import into a staging area before merge, and must audit every restore operation.

## Incident Notes

Capture:

- Time and tenant.
- Actor user if known.
- Affected resources.
- TraceId or correlation ID.
- Audit/security event IDs.
- Operator actions taken.

Do not paste passwords, raw tokens, invite token values, API token raw values, webhook secrets, signed URLs, or sensitive message bodies into incident notes.

## Known Operational Gaps

- Production object storage adapter is not implemented.
- Full tenant restore is not implemented.
- Backup/restore must be rehearsed per environment.
- Background job health checks are not complete.
- API smoke examples are placeholders until run against a seeded target environment.
