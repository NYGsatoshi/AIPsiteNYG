# Database Migrations

## Add A Migration

From the repository root:

```powershell
dotnet tool restore
dotnet ef migrations add <MigrationName> --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

If the local tool is not picked up in PowerShell, use the restored tool DLL:

```powershell
dotnet $env:USERPROFILE\.nuget\packages\dotnet-ef\10.0.8\tools\net8.0\any\dotnet-ef.dll migrations add <MigrationName> --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

Review generated migrations before committing.

## Apply Locally

```powershell
dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

Use a local database connection string through `ConnectionStrings__DefaultConnection`.

## Apply On A VPS

1. Back up PostgreSQL and file storage first.
2. Stop or drain the app if the migration can lock heavily used tables.
3. Set production environment variables.
4. Run:

```powershell
dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

For Docker deployments, run the command inside a temporary SDK container or a controlled maintenance job that has the same environment variables as the app.

## Backup Before Migration

PostgreSQL custom-format backup:

```bash
pg_dump --format=custom --file=aipportal-before-migration.backup "$AIPPORTAL_DATABASE_URL"
```

Also back up the configured file storage root, bucket, or volume when the migration affects file metadata.

## Rollback

EF migrations can generate down scripts, but destructive changes may not be safely reversible. Prefer:

- Restore the database backup for failed destructive migrations.
- Use forward-fix migrations for small non-destructive issues.
- Keep data-copy migrations idempotent where possible.

Generate a script for review:

```powershell
dotnet ef migrations script --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

## Tenant Cautions

- Tenant-owned entities must implement `ITenantEntity`.
- Migrations that add tenant-owned tables must include `TenantId`, tenant-aware indexes, and foreign keys where appropriate.
- Backfills must preserve tenant boundaries.
- Do not use a single default tenant backfill for new production data unless the data truly belongs to the default tenant.
- Avoid destructive multi-tenant migrations without a tested restore plan.
