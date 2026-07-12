# Qodana project model

Last updated: 2026-07-12.

## Canonical roots

- Repository root: `.`.
- Backend solution: `AipPortal.slnx`.
- Backend projects:
  - `src/AipPortal.Domain/AipPortal.Domain.csproj`
  - `src/AipPortal.Application/AipPortal.Application.csproj`
  - `src/AipPortal.Infrastructure/AipPortal.Infrastructure.csproj`
  - `src/AipPortal.Web/AipPortal.Web.csproj`
  - `tests/AipPortal.Tests/AipPortal.Tests.csproj`
- Active Angular workspace: `frontend/`.
- Legacy Angular scaffold: `aipsite-frontend/`; this is not the active frontend and is excluded from Qodana first-party analysis.

## Required toolchain

- .NET SDK: `10.0.301`, from `global.json`.
- Target framework: `net10.0`.
- Node.js: `24.x`; active development docs require `24.15+`.
- npm: `11.17.0`, matching `frontend/package.json`.
- Qodana action: `JetBrains/qodana-action@v2026.1`.
- Full-stack linter: `qodana-dotnet` in native mode through the GitHub-hosted runner.
- Token-optional fallback linter: `jetbrains/qodana-cdnet:2026.1-eap-privileged`, .NET-only.

## Bootstrap sequence

Qodana runs `scripts/quality/qodana-bootstrap.sh` inside the Qodana execution environment.

The script:

1. Reads the required SDK from `global.json`.
2. Installs that SDK only when the Qodana environment does not already provide it.
3. Prints `dotnet --list-sdks`, `dotnet --info`, and `dotnet msbuild -version`.
4. Runs `dotnet restore AipPortal.slnx --verbosity normal`.
5. Runs `dotnet build AipPortal.slnx --configuration Release --no-restore`.
6. When npm is available, runs root `npm ci`, `npm --prefix frontend ci`, and `npm --prefix frontend run build`.
7. Fails if `QODANA_FRONTEND_REQUIRED=true` and npm is unavailable.

No generated OpenAPI, NSwag, Kiota, protobuf, GraphQL, or custom source-generation step is required. EF migrations and normal compiler-generated files are produced by restore/build.

## Solution selection

The workflow passes `--solution AipPortal.slnx` to the Qodana action. This is the documented Qodana CLI/action mechanism for selecting a .NET solution.

The repository previously used a `dotnet.solution` YAML key without passing `--solution` for the `qodana-dotnet` job. The documented Qodana YAML reference does not list that key, so the workflow now makes solution selection explicit in the action arguments.

## Exclusion rationale

Qodana must analyze first-party source and tests, but not generated output, dependency folders, runtime data, or inactive scaffold source.

Configured exclusions:

- `**/bin/**`, `**/obj/**`, and concrete project `bin`/`obj` paths: build and compiler-generated output.
- `**/node_modules/**`: external npm dependencies.
- `**/dist/**`, `**/.angular/**`, and `**/storybook-static/**`: Angular and Storybook generated output/cache.
- `**/coverage/**`, `**/TestResults/**`, `**/test-results/**`, `**/playwright-report/**`, and `**/.playwright/**`: test output and browser artifacts.
- `**/.qodana/**` and `.tmp`: scanner and local diagnostic output.
- `src/AipPortal.Web/wwwroot`: hosted Angular build output; source of truth is `frontend/`.
- `src/AipPortal.Web/data`: local runtime data such as Data Protection keys.
- `aipsite-frontend`: legacy/inactive Angular scaffold; active frontend analysis is `frontend/`.

Tests are not excluded.

## Interpreting `Cannot resolve symbol`

Small numbers of unresolved-symbol findings can be genuine source defects. A large cross-cutting burst is a project-model failure.

Use the first unresolved dependency to classify the failure:

- Backend platform failure: `Microsoft`, `Microsoft.AspNetCore`, `Microsoft.EntityFrameworkCore`, `ControllerBase`, `DbContext`, `IdentityUser`.
- Frontend dependency failure: `@angular/core`, `@angular/common`, `@angular/router`, `rxjs`, `typescript`, `Component`, `Injectable`.
- Internal project failure: `AipPortal.*`, `Application.*`, `Infrastructure.*`, `Domain.*`.
- Generated-code failure: generated clients, DTOs, source-generator output, EF generated artifacts.

The CI guard `scripts/quality/check-qodana-project-model.mjs` parses `qodana.sarif.json` and fails if unresolved-symbol findings exceed `200` total findings or `40` affected files, or if SARIF reports SDK, restore, package, build, bootstrap, solution-load, or project-model failures.

## Baseline and quality gate policy

Do not create a baseline from a failed restore, failed build, missing frontend dependency tree, or unresolved-symbol cascade.

After the project model is healthy:

1. Use the Qodana report to separate unchanged existing findings from newly introduced findings.
2. If a baseline is needed, create it only from a successful full-stack `qodana-dotnet` run.
3. Keep new Critical findings at zero.
4. Keep new High findings at zero unless a temporary exception is explicitly documented with an owner and expiry.
5. Keep restore, build, bootstrap, and project-model failures as hard CI failures.

## Local reproduction

Backend:

```powershell
dotnet --info
dotnet --list-sdks
dotnet restore AipPortal.slnx --verbosity normal
dotnet build AipPortal.slnx --configuration Release --no-restore
```

Frontend:

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
```

Community .NET-only Qodana container:

```powershell
$project = (Get-Location).Path
$results = Join-Path $project ".tmp/qodana/results"
$cache = Join-Path $project ".tmp/qodana/cache"
docker run --rm `
  -e QODANA_FRONTEND_REQUIRED=false `
  -v "${project}:/data/project" `
  -v "${results}:/data/results" `
  -v "${cache}:/data/cache" `
  jetbrains/qodana-cdnet:2026.1-eap-privileged `
  --project-dir /data/project `
  --repository-root /data/project `
  --results-dir /data/results `
  --cache-dir /data/cache `
  --config qodana.yaml `
  --solution AipPortal.slnx `
  --configuration Release

node scripts/quality/check-qodana-project-model.mjs .tmp/qodana/results/qodana.sarif.json
```

Full-stack Qodana runs in GitHub Actions with `QODANA_TOKEN` using `qodana-dotnet --within-docker false`; the token is not stored in source-controlled files.

## Validation evidence

Local environment:

- `dotnet --info`: SDK `10.0.301`, MSBuild `18.6.4`, ASP.NET Core runtime `10.0.9`.
- `dotnet --list-sdks`: `10.0.301`.
- `node --version`: `v24.13.0`.
- `npm --version`: `11.6.2`.

Commands run on 2026-07-12:

- `dotnet restore AipPortal.slnx --verbosity normal`: passed after enabling NuGet network access; `0` warnings, `0` errors.
- `dotnet build AipPortal.slnx --configuration Release --no-restore`: passed; `0` warnings, `0` errors.
- `npm --prefix frontend ci`: passed after enabling npm registry access; `1058` packages installed.
- `npm --prefix frontend run build`: passed; emitted the existing initial bundle budget warning.
- Patched Community Qodana run: passed with Qodana Community for .NET `2026.1.503`.
- Patched Qodana SARIF guard: passed; `0` unresolved-symbol findings and `0` project-model failures.

Accessible local Qodana metrics:

| Metric | Before | After |
| --- | ---: | ---: |
| Total Qodana findings | Not available; current pre-fix local run was stopped after more than 83 minutes and produced incomplete SARIF | 1640 |
| Critical | Not available | 0 |
| High | Not available | 919 |
| Moderate | Not available | 721 |
| Cannot resolve symbol | Not available | 0 |
| Unique affected files | Not available | 143 |
| Genuine production-source findings | Not available | 1640 Qodana warning/note findings; no project-model collapse detected |

The local Community run is .NET-only. Representative ASP.NET Core, EF Core, and internal AIP project references are validated by the successful Qodana solution load/build. Representative Angular symbols are validated by `npm --prefix frontend ci` and the production Angular build locally, and by the `qodana-dotnet` full-stack workflow when `QODANA_TOKEN` is available in GitHub Actions.
