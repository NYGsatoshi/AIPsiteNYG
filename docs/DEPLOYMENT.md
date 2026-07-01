# Deployment

Last implementation audit: 2026-06-18.

This document describes what the repository currently supports. It is not a production certification.

## Deployment readiness

| Profile | Status | Current limitation |
| --- | --- | --- |
| Direct local development | Partially implemented | Requires external PostgreSQL, migrations, tenant data, and a manually provisioned user |
| `docker-compose.local.yml` | Partially implemented | Migrates and seeds a tenant, but no user/admin bootstrap exists |
| `docker-compose.yml` | Partially implemented | Migrates, but default SaaS startup seeds no tenant or user |
| `docker-compose.onprem.yml` | Incomplete | Does not run migrations and expects production HTTPS behavior without including a reverse proxy |
| Broad public SaaS | Not ready | Object storage, bootstrap, API-token auth, recovery evidence, and deployment hardening are incomplete |

## Container files

### `Dockerfile`

- Builds and publishes `AipPortal.Web`.
- Builds the Angular frontend in a Node.js stage and copies the browser artifacts into `src/AipPortal.Web/wwwroot` before publishing `AipPortal.Web`.
- Installs `curl` for health checks.
- Listens on HTTP port 8080.
- Does not apply migrations.

### `docker-compose.local.yml`

- PostgreSQL 18.
- Separate SDK migration service.
- Development app profile.
- `OnPremSingleTenant` with startup tenant seed.
- Local filesystem uploads in a named volume.
- No persistent Data Protection volume in this profile.
- No seeded user/admin.

### `docker-compose.yml`

- PostgreSQL 18.
- Separate SDK migration service.
- Production app profile.
- Local filesystem uploads despite the base app mode being SaaS.
- Persistent Data Protection keys and uploads.
- No tenant or user seed by default.

### `docker-compose.onprem.yml`

- PostgreSQL and app only.
- No migration service and no automatic migration in the app.
- `Tenancy:SeedOnStartup=true`, but seeding cannot work against a fresh database before the schema exists.
- Production HTTPS redirect and secure-cookie settings are enabled.
- No reverse-proxy/TLS service is included.

For a fresh on-prem deployment, apply migrations before starting the app.

## Configuration sources

Effective configuration is composed from:

- `src/AipPortal.Web/appsettings.json`;
- environment-specific `appsettings.*.json`;
- environment variables;
- command-line configuration.

The `*.example.json` files are examples only. ASP.NET Core does not automatically load `appsettings.SaaS.example.json`, `appsettings.OnPremSingleTenant.example.json`, or similar files.

Values such as `${DB_HOST}` inside JSON are not shell-expanded by ASP.NET Core. Copying an example file without replacing placeholders will not produce a working deployment.

## Enforced configuration

Startup validation checks:

- tenancy enum values and development-header policy;
- file provider names and required provider fields;
- upload size, extensions, and MIME types;
- CSRF service/middleware registration;
- production secure cookies, HTTPS, HSTS, persisted Data Protection keys, and disabled setup mode;
- production database password presence and basic placeholder/strength heuristics;
- object-storage secret presence when object storage is selected.

Source: `src/AipPortal.Web/Configuration/StartupConfigurationValidator.cs`.

## Bound but not enforced settings

The following settings should not be treated as runtime gates:

- `Features:EnableRadialMenu`
- `Features:EnableDockingLayout`
- `Features:EnableForms`
- `Features:EnableEvents`
- `Features:EnableProductionTracking`
- `Features:EnableWebhooks`
- `Features:EnableApiTokens`
- `Platform:EnablePlatformAdmin`
- `Platform:AllowTenantCreationFromAdmin`
- `Platform:EnablePlansAndSubscriptions`
- `Platform:EnableUsageQuota`

`Platform:PlatformAdminSetupMode` is read only by production startup validation. It does not implement bootstrap.

Tenant feature enforcement uses database plan/settings data through `FeatureFlagService`, not the `Features:*` section.

## Database migrations

Apply migrations before app startup:

```bash
dotnet tool restore
dotnet ef database update \
  --project src/AipPortal.Infrastructure \
  --startup-project src/AipPortal.Web
```

Generate a review script:

```bash
dotnet ef migrations script \
  --project src/AipPortal.Infrastructure \
  --startup-project src/AipPortal.Web
```

The app checks for pending migrations in `/health/ready` but does not apply them.

## Frontend static hosting

Production static hosting serves Angular build artifacts from
`src/AipPortal.Web/wwwroot`. The Angular source of truth remains under
`frontend/`; the `wwwroot` files are build output for hosting.

Local hosted build:

```bash
cd frontend
npm ci
npm run build:hosted
cd ..
dotnet run --project src/AipPortal.Web
```

Publish build with Node.js available:

```bash
dotnet publish src/AipPortal.Web/AipPortal.Web.csproj -c Release -p:BuildAngularFrontendOnPublish=true
```

The Dockerfile uses a separate Node.js stage and copies
`frontend/dist/aipportal-web` into `src/AipPortal.Web/wwwroot` before
`dotnet publish`.

Angular fallback is limited to safe user-facing GET routes after the Angular
build marker is present. `/api/*` returns backend API 404 behavior and never
serves Angular `index.html`. Backend-owned routes remain outside Angular
fallback: `/health`, `/health/live`, `/health/ready`, `/healthz`, `/metrics`,
`/swagger/*`, `/hangfire/*`, `/signin-google`, `/auth/callback/*`, and
`/favicon.ico`.

## Tenant and administrator bootstrap

Implemented startup seed can create a default tenant and plans.

No supported workflow creates the first user or PlatformAdmin. The following documentation claim is therefore a mismatch: “enable setup mode and create the first administrator.” Setup mode has no corresponding endpoint or seed.

Do not expose a fresh deployment until a reviewed bootstrap procedure is implemented.

## Files

`LocalFileSystem` is the only implemented provider.

The names `ObjectStorage`, `S3Compatible`, and `OCIObjectStorage` pass provider-name validation but resolve to `UnsupportedObjectStorageService`. Readiness returns unhealthy for these providers, saves fail, reads throw, and signed URLs are unavailable.

Tenant metadata export does not include file bodies and cannot replace storage backups.

## HTTPS and reverse proxies

Production startup requires HTTPS redirect, HSTS, and secure cookies.

The current host does not call `UseForwardedHeaders`. Therefore, correct `X-Forwarded-Proto`/host handling behind a TLS-terminating proxy is **needs verification** and may cause redirects or incorrect tenant-host resolution.

Do not claim reverse-proxy readiness until trusted proxy handling is implemented and tested.

## Health endpoints

- `GET /health/live`: process liveness.
- `GET /health/ready`: database connection, no pending migrations, storage readiness, Data Protection path, and default tenant in single-tenant mode.
- `GET /health`: temporary redirect to readiness.

Readiness does not prove:

- an admin user exists;
- login works;
- tenant memberships exist;
- core workflows pass;
- backups can be restored;
- reverse-proxy routing is correct.

## Required pre-deployment audit

Before any pilot:

1. Implement or document a supported first-admin bootstrap.
2. Apply and record migrations.
3. Verify tenant resolution for the exact host/proxy topology.
4. Verify login, tenant membership, and role separation.
5. Run cross-tenant HTTP tests against PostgreSQL.
6. Verify uploads/downloads using the configured storage.
7. Back up and restore PostgreSQL plus file storage.
8. Record the app image/tag and configuration.
9. Confirm no placeholder secrets or example configuration remain.

See `docs/KNOWN_ISSUES.md` and `docs/OPERATIONS.md`.
