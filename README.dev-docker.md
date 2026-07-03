# Docker Development Environment

The contributor-facing development guide now lives in [README.dev-env.md](README.dev-env.md).

Use these modes:

- Recommended default: `docker-compose.db.yml` for PostgreSQL only, with host `dotnet run` and host `frontend npm run start`
- Optional full Docker stack: `docker-compose.dev.yml`
- Optional Linux screenshot parity runner: `docker-compose.playwright.yml` plus `Dockerfile.playwright`

Full application Docker is optional and should not be treated as the default contributor workflow.
