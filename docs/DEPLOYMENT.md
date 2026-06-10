# Deployment

Use this with `docs/SMOKE_TEST.md`, `docs/FINAL_ACCEPTANCE_TEST_PLAN.md`, and `docs/RELEASE_CHECKLIST.md` for pilot handoff. Do not treat deployment as approved until the environment-specific checklist is complete.

## Requirements

- .NET 10 SDK/runtime matching the project target.
- PostgreSQL 18 or another PostgreSQL version supported by the configured Npgsql provider.
- A writable file storage directory for uploads.

## Configuration

Configure secrets with environment variables, not committed settings files.

- `ConnectionStrings__DefaultConnection`
- `DataProtection__KeysPath`
- `Tenancy__AppMode`
- `Tenancy__DefaultTenantSlug`
- `Tenancy__TenantResolutionStrategy`
- `FileStorage__Provider`
- `FileStorage__RootPath`
- `FileStorage__BucketName`
- `FileStorage__Endpoint`
- `FileStorage__Region`
- `FileStorage__MaxFileSizeBytes`
- `FileStorage__AllowedExtensions__0`, `FileStorage__AllowedExtensions__1`, and so on if overriding extensions.
- `Security__CookieSecurePolicy`
- `Security__RequireHttps`
- `Security__EnableHsts`
- `Security__EnableCsrfProtection`
- `ASPNETCORE_ENVIRONMENT=Production`

See `docs/CONFIGURATION.md` and `docs/ENVIRONMENT_VARIABLES.md` for the full deployment profile matrix.

## Database

Create a PostgreSQL database and user, then run EF migrations from the repository root:

```powershell
dotnet tool restore
dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web
```

## Local Run

```powershell
$env:ConnectionStrings__DefaultConnection='Host=localhost;Port=5432;Database=aip_portal_dev;Username=aip_portal;Password=<local-password>'
dotnet run --project src/AipPortal.Web
```

Local development can use `appsettings.Development.json`, local PostgreSQL, and `FileStorage:Provider=LocalFileSystem`. Use development tenant headers only in development.

## Docker Compose

```powershell
$env:POSTGRES_PASSWORD='<strong-password>'
docker compose up --build
```

The app listens on `http://localhost:8080` by default. Override the host port with `AIP_PORTAL_PORT`.

For on-prem single-tenant defaults:

```powershell
$env:POSTGRES_PASSWORD='<strong-password>'
docker compose -f docker-compose.onprem.yml up --build
```

## XServer VPS Outline

1. Install Docker and Docker Compose.
2. Clone the repository.
3. Create a PostgreSQL database/user or run PostgreSQL through Compose.
4. Set production environment variables in a protected shell profile or `.env` file.
5. Run migrations before serving real users.
6. Run `docker compose up -d --build`.
7. Put the app behind nginx or another reverse proxy with HTTPS.
8. Verify `/health/live`, `/health/ready`, login, tenant resolution, and file upload/download.
9. Create the initial PlatformAdmin account through a controlled bootstrap process.
10. Create the first tenant through `/api/platform/tenants`.

## OCI Deployment Outline

1. Use managed PostgreSQL or a hardened VM PostgreSQL deployment.
2. Use OCI Object Storage when the object-storage adapter is implemented; until then, local filesystem is evaluation-only.
3. Store secrets in OCI Vault or another approved secret manager.
4. Deploy the app container to a VM, container instance, or Kubernetes service.
5. Terminate HTTPS at a load balancer or reverse proxy.
6. Run migrations as a controlled job.
7. Verify health checks and tenant isolation before traffic.

## OnPremSingleTenant Deployment

Use:

- `Tenancy:AppMode=OnPremSingleTenant`
- `Tenancy:DefaultTenantSlug=<organization-slug>`
- `Tenancy:AllowTenantSwitching=false`
- `Tenancy:SeedOnStartup=true` for first startup if the default tenant should be created automatically.

Confirm `/health/ready` reports ready only after the default tenant exists and the database/storage checks pass.

## SaaS Deployment

Use:

- `Tenancy:AppMode=SaaS`
- `Tenancy:TenantResolutionStrategy=Host` or `Subdomain`
- `Tenancy:AllowDevelopmentHeaderInProduction=false`
- `Security:CookieSecurePolicy=Always`
- `Security:RequireHttps=true`
- `Security:EnableHsts=true`
- `Security:EnableCsrfProtection=true`
- `DataProtection:KeysPath=<persisted path>`

SaaS should use object storage once the adapter is implemented. Local filesystem storage is not recommended for production SaaS.

## Reverse Proxy And HTTPS

Configure the reverse proxy to:

- Terminate TLS.
- Redirect HTTP to HTTPS.
- Forward `X-Forwarded-For` and `X-Forwarded-Proto` when trusted proxy handling is configured.
- Limit request body size consistently with `FileStorage:MaxFileSizeBytes`.
- Preserve host headers when using host/subdomain tenant resolution.

## Runtime

For a VM/systemd deployment:

1. Publish the app.
2. Configure environment variables in the service unit or protected env file.
3. Set `ASPNETCORE_ENVIRONMENT=Production`.
4. Run the app as a non-root user.
5. Restart on failure.

For Docker:

1. Keep secrets out of the image.
2. Mount file storage or use object storage.
3. Run migrations separately from app startup.
4. Configure health checks against `/health/ready`.

## Admin Bootstrap And First Tenant

Do not hardcode production admin passwords. For pilot:

1. Create a PlatformAdmin through a controlled bootstrap procedure.
2. Disable any setup mode after bootstrap.
3. Create the first tenant through platform API.
4. Add the first tenant owner/admin.
5. Verify PlatformAdmin cannot see tenant data through normal tenant endpoints.
6. Verify tenant admin cannot access platform APIs.

## Backups

- Back up PostgreSQL with `pg_dump` or managed snapshots.
- Back up the upload volume, NAS path, MinIO bucket, or object storage bucket separately.
- Test restores before relying on the backup plan.

Example PostgreSQL backup command:

```powershell
pg_dump --format=custom --file=aipportal.backup "$env:AIPPORTAL_DATABASE_URL"
```

## Data Lifecycle

- Active records are normal operational records.
- Archived records remain available for audit/history and are marked with archived status where the entity supports it.
- Deleted records use soft-delete timestamps by default.
- Retention policy is TODO and should be finalized before long-term production use.
