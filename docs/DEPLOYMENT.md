# Deployment

Last implementation audit: 2026-06-18.

This document describes what the repository currently supports. It is not a production certification.

## Deployment readiness

| Profile | Status | Current limitation |
| --- | --- | --- |
| Direct local development | Partially implemented | Requires external PostgreSQL and migrations; initial administrator seed is opt-in |
| `docker-compose.local.yml` | Partially implemented | Migrates and can opt in to initial administrator seed |
| `docker-compose.yml` | Partially implemented | Migrates and can opt in to initial administrator seed |
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
- Initial administrator seed is available through `AIP_SEED_ADMIN_ENABLED`.

### `docker-compose.yml`

- PostgreSQL 18.
- Separate SDK migration service.
- Production app profile.
- Local filesystem uploads despite the base app mode being SaaS.
- Persistent Data Protection keys and uploads.
- Initial administrator seed is available through `AIP_SEED_ADMIN_ENABLED`; it is disabled by default.
- The development-only `LocalAdmin:*` compatibility seed is not enabled by default in this profile.

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

For container deployments, the application reads the PostgreSQL connection string from `ConnectionStrings__DefaultConnection`. The production Compose files in this repository assemble that value from `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`, and they provision the PostgreSQL container with the same `DB_NAME` / `DB_USER` / `DB_PASSWORD` values to keep the migration and web containers aligned.

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

Implemented startup seed can create a default tenant, plans, and an explicit initial administrator.

Set the following environment variables only when intentionally bootstrapping or reconciling the first administrator:

```bash
AIP_SEED_ADMIN_ENABLED=true
AIP_SEED_ADMIN_EMAIL=admin@example.local
AIP_SEED_ADMIN_USERNAME=admin
AIP_SEED_ADMIN_PASSWORD=<strong-password>
```

The seed uses the existing `IPasswordHasher` and `User` model rather than writing password hashes directly. The account receives the platform administrator system role and an active owner membership in the default tenant. This project has no separate role table, so role creation maps to those existing enum-backed roles.

Do not keep bootstrap credentials in committed Compose files. Store the password in `.env`, deployment environment variables, or a secret manager, and disable `AIP_SEED_ADMIN_ENABLED` after first startup unless continued reconciliation is intentional.

## Files

`LocalFileSystem` is the only implemented provider.

The names `ObjectStorage`, `S3Compatible`, and `OCIObjectStorage` pass provider-name validation but resolve to `UnsupportedObjectStorageService`. Readiness returns unhealthy for these providers, saves fail, reads throw, and signed URLs are unavailable.

Tenant metadata export does not include file bodies and cannot replace storage backups.

## HTTPS and reverse proxies

Production startup requires HTTPS redirect, HSTS, and secure cookies.

The host now enables `UseForwardedHeaders` when `ReverseProxy:TrustForwardedHeaders=true` (for example `ReverseProxy__TrustForwardedHeaders=true` in Compose or environment variables). This opt-in path applies `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host`, which fixes secure-cookie and HTTPS detection for TLS-terminating proxies such as Caddy or Cloudflare Tunnel.

Do not enable `ReverseProxy:TrustForwardedHeaders` when the app is directly reachable from untrusted clients. The current implementation clears the ASP.NET Core proxy allowlists and assumes the app is network-isolated behind the trusted proxy or tunnel.

Focused automated coverage now verifies that `GET /api/security/csrf-token` succeeds with `Security:CookieSecurePolicy=Always` when `X-Forwarded-Proto: https` is trusted.

Do not claim reverse-proxy readiness until the exact deployment topology is tested end to end.

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

1. Apply or explicitly disable the supported first-admin bootstrap.
2. Apply and record migrations.
3. Verify tenant resolution for the exact host/proxy topology.
4. Verify login, tenant membership, and role separation.
5. Run cross-tenant HTTP tests against PostgreSQL.
6. Verify uploads/downloads using the configured storage.
7. Back up and restore PostgreSQL plus file storage.
8. Record the app image/tag and configuration.
9. Confirm no placeholder secrets or example configuration remain.

See `docs/KNOWN_ISSUES.md` and `docs/OPERATIONS.md`.
