# Docker Development Environment

This compose profile starts PostgreSQL, the ASP.NET Core backend, and the Angular dev server for local development. It is separate from the existing deployment compose files.

## Prerequisites

- Docker Desktop with Linux containers enabled
- Docker Compose v2
- Git

No host PostgreSQL, .NET SDK, or Node.js install is required for this workflow.

## First Setup

The stack can start without a local `.env` file because development defaults are defined in `docker-compose.dev.yml`.

To customize ports or development seed values:

```bash
cp .env.example .env
```

Edit `.env` only with local development placeholders. Do not put production secrets in it.

## Startup Command

```bash
docker compose -f docker-compose.dev.yml up --build
```

On first startup, the backend container restores .NET tools/packages, applies EF Core migrations to the `postgres` service, then runs `dotnet run`. The frontend container installs `frontend/node_modules` into a named volume, then runs Angular on `0.0.0.0:4200`.

`dotnet watch` is available as an opt-in:

```bash
BACKEND_USE_WATCH=true docker compose -f docker-compose.dev.yml up --build
```

Keep the default `BACKEND_USE_WATCH=false` on Windows Docker Desktop if `dotnet watch` hits static-web-assets path issues.

## Service URLs

- Frontend: http://localhost:4200
- Backend: http://localhost:8080
- Backend liveness: http://localhost:8080/health/live
- Backend readiness: http://localhost:8080/health/ready
- PostgreSQL host port: `localhost:5433`
- PostgreSQL compose hostname: `postgres`

## Stop Command

```bash
docker compose -f docker-compose.dev.yml down
```

## Database Reset Command

This deletes the development database volume and dependency cache volumes for this compose profile:

```bash
docker compose -f docker-compose.dev.yml down -v
```

Then start again:

```bash
docker compose -f docker-compose.dev.yml up --build
```

## Run Backend Tests

```bash
docker compose -f docker-compose.dev.yml run --rm backend dotnet test AipPortal.slnx
```

To run PostgreSQL-backed tests against the compose database, pass the test connection string explicitly:

```bash
docker compose -f docker-compose.dev.yml run --rm -e POSTGRES_TEST_CONNECTION_STRING="Host=postgres;Port=5432;Database=aip_portal_dev;Username=aip_portal;Password=aip_portal_dev_password" backend dotnet test AipPortal.slnx
```

## Run Frontend Tests

```bash
docker compose -f docker-compose.dev.yml run --rm frontend sh -lc "if [ ! -x node_modules/.bin/ng ]; then npm ci; fi && npm test"
```

## Known Limitations

- The compose stack is for local development only. It does not replace production deployment settings.
- The backend container runs migrations before starting the ASP.NET Core host; migration failures stop the backend.
- The default backend command is `dotnet run` because `dotnet watch` can fail on Windows Docker Desktop with a Linux container static-web-assets path issue. Set `BACKEND_USE_WATCH=true` to opt in when the local Docker/runtime combination supports it.
- File watching uses polling for Windows Docker Desktop compatibility, which can be slower than host-native watch mode.
- First startup downloads NuGet packages and npm packages into named volumes, so it can take several minutes.
- Playwright screenshot regression is still preferably run from the host unless a dedicated Playwright runner container is later added.
- The development database password and optional local admin values are placeholders only. Replace them locally if needed, and never reuse them outside development.
