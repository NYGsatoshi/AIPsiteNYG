# Deployment

This document is the active source for local setup, Docker, configuration, environment variables, and migrations. Operational runbooks live in `docs/OPERATIONS.md`.

## Requirements

- .NET 10 SDK/runtime matching the project target.
- PostgreSQL 18 or another PostgreSQL version supported by the configured Npgsql provider.
- A writable file storage directory for local/on-prem storage.
- Docker and Docker Compose when using containerized startup.

## Deployment Profiles

- `Development`: local development with safe setup switches and development tenant header resolution only when enabled.
- `SaaS`: hosted multi-tenant deployment with platform tenant lifecycle APIs.
- `OnPremSingleTenant`: installed single-tenant deployment using a configured default tenant.
- `OnPremMultiTenant`: installed multi-tenant deployment; treat as pre-pilot until the same isolation checks pass.
- `Test`: repeatable automated test profile.

Profiles are selected through ASP.NET Core configuration files and environment variables. Environment variables override JSON configuration.

## Local Development

Restore, build, and test:

```powershell
dotnet restore AipPortal.slnx
dotnet build AipPortal.slnx
dotnet test AipPortal.slnx
```

Run migrations:

```powershell
dotnet tool restore
dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

If PowerShell does not pick up the local EF tool, use the restored tool DLL:

```powershell
dotnet $env:USERPROFILE\.nuget\packages\dotnet-ef\10.0.8\tools\net8.0\any\dotnet-ef.dll database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

Run locally:

```powershell
$env:ConnectionStrings__DefaultConnection='Host=localhost;Port=5432;Database=aip_portal_dev;Username=aip_portal;Password=<local-password>'
dotnet run --project src/AipPortal.Web
```

Use development tenant headers only in development.

## Docker Compose

Local development:

```powershell
Copy-Item .env.example .env
docker compose -f docker-compose.local.yml up --build
```

Default app URL: `http://localhost:8080`, unless `AIP_PORTAL_PORT` is overridden.

On-prem single-tenant defaults:

```powershell
$env:POSTGRES_PASSWORD='<strong-password>'
docker compose -f docker-compose.onprem.yml up --build
```

The Compose connection string uses `Host=postgres` because the web and migration containers connect to PostgreSQL on the Compose network. For direct Windows execution with `dotnet run`, use `Host=localhost` and expose PostgreSQL with `POSTGRES_PORT`.

Reset the local Docker database:

```powershell
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml up --build
```

PostgreSQL 18 stores Docker data below `/var/lib/postgresql`; reset older local volumes initialized through `/var/lib/postgresql/data` before starting again.

## Configuration

Important configuration groups:

- `Tenancy`: app mode, default tenant slug, resolution strategy, tenant switching, development header policy.
- `FileStorage`: provider, root path or object storage settings, max size, extensions, MIME types, signed URL settings.
- `Security`: HTTPS, HSTS, secure cookie policy, CSRF, rate limiting, login lockout.
- `DataProtection`: persisted key path for production and multi-instance deployments.
- `Platform`: platform admin enablement, setup mode, tenant creation, plans/subscriptions, usage quotas.
- `Features`: feature flags for radial menu, docking, forms, events, production tracking, webhooks, API tokens.

Startup validation fails fast for invalid app mode, unsafe production tenant header resolution, unsafe production cookies/HTTPS/HSTS, missing production Data Protection key persistence, weak detectable production secrets, missing file storage settings, invalid upload limits/extensions/content types, and production setup mode.

## Environment Variables

Use double underscores to override nested configuration keys.

Required or commonly used:

- `ASPNETCORE_ENVIRONMENT`
- `ConnectionStrings__DefaultConnection`
- `DataProtection__KeysPath`
- `Tenancy__AppMode`
- `Tenancy__DefaultTenantSlug`
- `Tenancy__TenantResolutionStrategy`
- `Tenancy__AllowTenantSwitching`
- `Tenancy__AllowDevelopmentHeaderTenantResolution`
- `Tenancy__AllowDevelopmentHeaderInProduction`
- `FileStorage__Provider`
- `FileStorage__RootPath`
- `FileStorage__BucketName`
- `FileStorage__Endpoint`
- `FileStorage__Region`
- `FileStorage__MaxFileSizeBytes`
- `FileStorage__AllowedExtensions__0`
- `FileStorage__AllowedContentTypes__0`
- `FileStorage__UseSignedUrls`
- `FileStorage__UsePathStyle`
- `Security__CookieSecurePolicy`
- `Security__RequireHttps`
- `Security__EnableHsts`
- `Security__EnableCsrfProtection`
- `Security__EnableRateLimiting`
- `Security__LoginLockoutEnabled`
- `Security__MaxFailedLoginAttempts`
- `Security__LoginLockoutDurationMinutes`
- `Platform__EnablePlatformAdmin`
- `Platform__PlatformAdminSetupMode`
- `Platform__AllowTenantCreationFromAdmin`
- `Platform__EnablePlansAndSubscriptions`
- `Platform__EnableUsageQuota`

Docker Compose variables:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`
- `AIP_PORTAL_PORT`
- `FILE_STORAGE_MAX_FILE_SIZE_BYTES`

Do not commit object storage keys, database passwords, API keys, or production secrets. Use environment variables, protected `.env` files, a vault, or deployment-platform secrets.


## Supported Configuration Notes

This section records configuration switches that are accepted by configuration binding versus switches that are enforced by the current implementation.

Supported and enforced at startup:

- `Tenancy:AppMode`, `Tenancy:DefaultTenantSlug`, `Tenancy:TenantResolutionStrategy`, development tenant-header switches, and production tenant-header safety checks.
- `Security:CookieSecurePolicy`, `Security:RequireHttps`, `Security:EnableHsts`, `Security:EnableCsrfProtection`, `Security:EnableRateLimiting`, and login lockout limits.
- `DataProtection:KeysPath` in Production.
- `FileStorage:Provider=LocalFileSystem`, `FileStorage:RootPath`, upload size, extensions, and MIME types.
- `Platform:PlatformAdminSetupMode` must remain disabled in Production.

Deferred or non-enforcing switches:

- `FileStorage:Provider=ObjectStorage`, `S3Compatible`, and `OCIObjectStorage` are placeholders only. Production startup fails if one is configured because object storage adapters are not implemented in this build.
- `FileStorage:UseSignedUrls` is a placeholder only. Startup fails when it is enabled because signed URL generation is not implemented in this build.
- `FileStorage:BucketName`, `FileStorage:Region`, `FileStorage:Endpoint`, `FileStorage:UsePathStyle`, `FileStorage:AccessKey`, and `FileStorage:SecretKey` are reserved for the deferred object storage adapters.
- `Features:EnableWebhooks` and `Features:EnableApiTokens` are global placeholders. Production startup fails if either is enabled because outbound webhook delivery and API token authentication middleware are deferred.
- `Features:EnableRadialMenu`, `Features:EnableDockingLayout`, `Features:EnableForms`, `Features:EnableEvents`, and `Features:EnableProductionTracking` document intended product defaults, but current feature enforcement is tenant-plan driven rather than these global switches.
- `Platform:EnablePlatformAdmin`, `Platform:AllowTenantCreationFromAdmin`, `Platform:EnablePlansAndSubscriptions`, and `Platform:EnableUsageQuota` are bound for future operator policy but are not comprehensive runtime kill switches today.

## SaaS

Use:

- `Tenancy:AppMode=SaaS`
- `Tenancy:TenantResolutionStrategy=Host` or `Subdomain`
- `Tenancy:AllowDevelopmentHeaderInProduction=false`
- `Security:CookieSecurePolicy=Always`
- `Security:RequireHttps=true`
- `Security:EnableHsts=true`
- `Security:EnableCsrfProtection=true`
- `DataProtection:KeysPath=<persisted path>`

Production SaaS should use object storage after an adapter is implemented. Until then, object storage settings intentionally fail Production startup; LocalFileSystem is the only implemented provider and is not recommended for multi-instance SaaS beyond controlled pilots.

## OnPremSingleTenant

Use:

- `Tenancy:AppMode=OnPremSingleTenant`
- `Tenancy:DefaultTenantSlug=<organization-slug>`
- `Tenancy:TenantResolutionStrategy=ConfigDefault`
- `Tenancy:AllowTenantSwitching=false`
- `Tenancy:SeedOnStartup=true` for first startup when the default tenant should be created automatically.
- `FileStorage:Provider=LocalFileSystem`

Confirm `/health/ready` reports ready only after the default tenant exists and database/storage checks pass.

## Reverse Proxy And HTTPS

Configure the reverse proxy to:

- Terminate TLS.
- Redirect HTTP to HTTPS.
- Forward `X-Forwarded-For` and `X-Forwarded-Proto` only when trusted proxy handling is configured.
- Limit request body size consistently with `FileStorage:MaxFileSizeBytes`.
- Preserve host headers when using host/subdomain tenant resolution.

## Migrations

Add a migration:

```powershell
dotnet tool restore
dotnet ef migrations add <MigrationName> --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

Apply migrations:

```powershell
dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

For Docker deployments, run migrations in a controlled SDK container or maintenance job with the same environment variables as the app.

Before production migrations:

1. Back up PostgreSQL and file storage.
2. Stop or drain the app if the migration can lock heavily used tables.
3. Review generated migrations and SQL scripts before applying destructive changes.
4. Verify tenant-owned tables include `TenantId`, tenant-aware indexes, and foreign keys.
5. Run tenant isolation smoke tests after migration.

Generate a script for review:

```powershell
dotnet ef migrations script --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

Tenant backfills are data migrations. Restoring a backup is safer than relying on EF down scripts for destructive or tenant-stamping changes.

## Admin Bootstrap And First Tenant

Do not hardcode production admin passwords.

1. Create a PlatformAdmin through a controlled bootstrap procedure.
2. Disable setup mode after bootstrap.
3. Create the first tenant through platform APIs.
4. Add the first tenant owner/admin.
5. Verify PlatformAdmin cannot see tenant data through normal tenant endpoints.
6. Verify tenant admin cannot access platform APIs.
