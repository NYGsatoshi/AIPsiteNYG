# Development

Last verified: 2026-06-18.

## Prerequisites

- .NET 10 SDK.
- PostgreSQL supported by the current Npgsql package.
- Node.js 24 for the CI-equivalent UI test workflow.
- Docker/Compose when using container profiles.

The repository pins `dotnet-ef` 10.0.8 in both `dotnet-tools.json` and `.config/dotnet-tools.json`.

## Restore and build

```bash
dotnet restore AipPortal.slnx
dotnet tool restore
dotnet build AipPortal.slnx
```

If an execution sandbox blocks MSBuild named pipes, use a single worker and disabled build servers:

```bash
dotnet build AipPortal.slnx --disable-build-servers -m:1
```

## Database setup

Set a real local PostgreSQL connection string:

```bash
export ConnectionStrings__DefaultConnection='Host=localhost;Port=5432;Database=aip_portal_dev;Username=aip_portal;Password=<local-password>'
```

Apply migrations:

```bash
dotnet ef database update \
  --project src/AipPortal.Infrastructure \
  --startup-project src/AipPortal.Web
```

The application does not automatically apply migrations.

## Run the application

```bash
ASPNETCORE_ENVIRONMENT=Development \
dotnet run --project src/AipPortal.Web
```

Development defaults use:

- `HeaderForDevelopmentOnly` tenant resolution;
- `X-Tenant-Slug` when explicitly allowed;
- non-secure local cookies;
- no HTTPS redirect or HSTS;
- CSRF enabled;
- rate limiting and lockout disabled;
- `PlatformAdminSetupMode=true`.

Important: setup mode does not create an administrator. It is currently only a configuration value rejected in production.

## Local Compose

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up --build
```

This profile:

- starts PostgreSQL;
- runs EF migrations in a separate SDK container;
- starts the app as `OnPremSingleTenant`;
- seeds the default tenant and plans;
- stores uploaded files in a Docker volume.

It does not seed users or a first administrator. A fresh environment therefore lacks a supported login/bootstrap path.

## Seed behavior

`AppDbContextSeed` can create:

- one default tenant;
- four plan records;
- optional UI-shell modules, panels, commands, and radial profiles.

It does not create:

- users or passwords;
- PlatformAdmin/TenantAdmin memberships;
- workspaces, groups, channels, projects, or demo data;
- invite links.

Do not document seeded demo users unless code is added.

## Tests

Run .NET tests:

```bash
dotnet test AipPortal.slnx
```

Run PostgreSQL-backed assertions by supplying a migrated test database:

```bash
export POSTGRES_TEST_CONNECTION_STRING='Host=localhost;Port=5432;Database=aip_portal_test;Username=aip_portal;Password=<test-password>'
dotnet test AipPortal.slnx --filter 'Category=PostgreSQLIntegration'
```

Without that variable, the current PostgreSQL tests return early and are reported as passed.

Run UI tests:

```bash
npm ci
npx playwright install chromium
npm run test:ui
```

The UI suite serves `wwwroot` directly and mocks APIs. It does not run the ASP.NET Core backend.

See `docs/TESTING.md`.

## Adding a feature

Follow the existing slice:

1. Domain entity/enums if persistent state is needed.
2. Application DTOs, interfaces, service, and resource authorization.
3. Repository contract and infrastructure implementation.
4. EF configuration and migration.
5. Thin Web controller.
6. Unit/service and HTTP tests.
7. Browser UI only when the feature is intended to be user-accessible there.
8. Update the implementation status in `docs/AI_CONTEXT.md` and open issues in `docs/KNOWN_ISSUES.md`.

Do not call a backend-only feature complete when the intended workflow requires the bundled UI.

## Configuration audit rule

Before adding documentation for a setting, search for both:

- where the setting is bound; and
- where its value is read to change behavior.

`FeatureOptions` and most of `PlatformOptions` are examples of settings that are bound but not currently enforced.

## Documentation maintenance

- Active truth belongs under `docs/`.
- Historical snapshots belong under `docs/archive/`.
- Do not update an archived status report to make it look current; update the active docs and annotate the archive index.
- Use exact repository paths for implementation claims.
