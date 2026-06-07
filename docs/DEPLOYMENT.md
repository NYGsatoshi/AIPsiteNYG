# Deployment

## Requirements

- .NET 10 SDK/runtime matching the project target.
- PostgreSQL 18 or another PostgreSQL version supported by the configured Npgsql provider.
- A writable file storage directory for uploads.

## Configuration

Configure secrets with environment variables, not committed settings files.

- `ConnectionStrings__DefaultConnection`
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

## VPS Outline

1. Install Docker and Docker Compose.
2. Clone the repository.
3. Set production environment variables in a protected shell profile or `.env` file.
4. Run `docker compose up -d --build`.
5. Put the app behind a reverse proxy with HTTPS.
6. Run migrations before serving real users.
7. Create the initial SystemAdmin account through a controlled seed or database bootstrap process.

## Backups

- Back up PostgreSQL with `pg_dump` or managed snapshots.
- Back up the upload volume, NAS path, MinIO bucket, or object storage bucket separately.
- Test restores before relying on the backup plan.

## Data Lifecycle

- Active records are normal operational records.
- Archived records remain available for audit/history and are marked with archived status where the entity supports it.
- Deleted records use soft-delete timestamps by default.
- Retention policy is TODO and should be finalized before long-term production use.
