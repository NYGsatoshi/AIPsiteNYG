# Backup And Restore

AIP Portal recovery has two layers:

- Full-system backup and restore for operators.
- Tenant metadata export for school-by-school portability and future migration.

The MVP implements tenant metadata export only. It does not implement a full restore engine.

## SaaS Mode

SaaS backups must include:

- PostgreSQL database backups with point-in-time recovery where the hosting platform supports it.
- Object storage bucket backups or versioning for uploaded file bodies.
- Application settings backup, including deployment configuration and non-secret feature configuration.
- Secret or vault backup using the cloud provider secret-management recovery model.
- Audit log retention according to the tenant contract and platform policy.
- Tenant-level metadata export through `POST /api/tenant/export`.

Tenant exports include metadata JSON in a ZIP file. File bodies are not exported in the MVP. File metadata includes storage keys so a future file-body export or restore can reconcile database records with object storage.

## On-Prem Mode

For PostgreSQL:

```bash
pg_dump --format=custom --file=aipportal.backup "$AIPPORTAL_DATABASE_URL"
```

For local file storage, back up the configured `FileStorage:RootPath` using the organization's normal filesystem backup tooling. If Docker volumes are used, back up the named database and storage volumes while the application is stopped or while storage snapshots are consistent.

Back up:

- Database.
- Local file storage root, NAS mount, MinIO bucket, or S3-compatible bucket.
- `appsettings.*.json` and environment-specific configuration.
- Secrets stored outside appsettings, such as connection strings and storage credentials.
- Docker Compose files, Docker volume definitions, and deployment scripts if used.

Restore into a test environment first:

1. Restore PostgreSQL from the backup.
2. Restore file storage to the configured path or bucket.
3. Restore configuration and secrets.
4. Start the app against the restored database and storage.
5. Verify login, tenant selection, project lists, file metadata, and file download authorization.
6. Check audit logs for continuity.

Untested backups are not backups. Every production backup policy must include scheduled restore drills.

## Full-System Restore Outline

A future full-system restore should:

- Restore the complete database and storage set from the same recovery point.
- Verify storage keys referenced by `FileObject` records exist.
- Rebuild derived search indexes or caches.
- Preserve tenant IDs exactly.
- Append operator audit records after the restored system starts.

## Future Tenant Restore

Tenant-level restore is intentionally not implemented yet. A future design must:

- Never overwrite another tenant.
- Validate the source tenant ID and destination tenant ID mapping.
- Import into a staging area before merge.
- Reconcile users, memberships, workspaces, groups, projects, tasks, comments, artifacts, files, settings, feature flags, usage records, and audit references.
- Audit every restore operation.

## Other Restore Types

Future restore types:

- Project-level restore.
- File restore.
- Accidental deletion recovery.
- Tenant migration import.

File restore must verify both `FileObject` metadata and the underlying storage object.
