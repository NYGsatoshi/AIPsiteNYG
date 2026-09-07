# Qodana project model

Last updated: 2026-09-07.

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
- Legacy Angular scaffold: `aipsite-frontend/`; it is inactive and excluded from Qodana analysis.

## Required toolchain

- .NET SDK: `10.0.400`, pinned by `global.json` with roll-forward disabled.
- Target framework: `net10.0`.
- Node.js: `24.x` for the SARIF/project-model guard.
- Qodana action: `JetBrains/qodana-action` v2026.2.1, pinned to commit `10be11607eb323a180e2b76b26c9c5cdceac3e77`.
- Community linter image: `jetbrains/qodana-cdnet:2026.2-privileged@sha256:21bbbfeac0e61fe8790cc27d5754b87d57b8032c0c32f84ddeb887027f83ec4f`.

Qodana Community for .NET is intentionally the .NET lane. Frontend policy is enforced independently by SonarQube Cloud, ESLint/angular-eslint and Stylelint, so the Qodana bootstrap sets `QODANA_SKIP_FRONTEND_BOOTSTRAP=true` in CI instead of spending Community-linter time building an unsupported frontend analysis surface.

## Inspection policy

`qodana.yaml` starts from `qodana.recommended` and additionally enables every inspection whose default JetBrains IDE severity is:

- `ERROR`
- `WARNING`
- `WEAK WARNING`

This keeps the profile deliberately strict while avoiding the previous unrestricted `ALL` inventory, which also enabled low-value typo/information-only inspections and could add substantial noise and scan cost.

Generated output, dependencies, runtime data, test artifacts and the inactive legacy frontend remain excluded. First-party backend source and tests remain in scope.

## Solution and configuration

The canonical .NET project model is configured in `qodana.yaml`:

```yaml
dotnet:
  solution: AipPortal.slnx
  configuration: Release
```

Keeping these values in `qodana.yaml` makes local Docker runs and GitHub Actions consume the same solution/configuration instead of duplicating command-line flags.

## Bootstrap sequence

Qodana runs `scripts/quality/qodana-bootstrap.sh` before inspections. For the Community .NET CI lane the script:

1. Reads the required SDK from `global.json`.
2. Installs that exact SDK if the image does not provide it.
3. Prints the active SDK/MSBuild information.
4. Runs `dotnet restore AipPortal.slnx --verbosity normal`.
5. Runs `dotnet build AipPortal.slnx --configuration Release --no-restore`.
6. Skips the frontend bootstrap because `qodana-cdnet` does not analyze the active Angular/TypeScript application.

Restore, build, SDK, package-resolution, solution-load and project-model failures are hard failures.

## Pull-request quality gate

The Qodana workflow runs on pull requests targeting `main` with full Git history and checks out the actual pull-request HEAD for analysis.

For PRs:

- `pr-mode: true` limits Qodana findings to changed files.
- `--fail-threshold 0` rejects any Qodana finding in changed code.
- Qodana execution failure is not masked with `continue-on-error`.
- Repository permissions remain `contents: read`.
- Qodana comments, annotations and quick-fix pushes are disabled.
- No `QODANA_TOKEN` is required for the Community linter.
- Repository-owner PRs may exercise proposed Qodana policy changes directly.
- For every other PR, `qodana.yaml`, the Qodana bootstrap/guard, and the repository helper scripts executed by this job are restored from the PR base SHA before execution; the guard is restored again after analysis before it consumes SARIF.

This preserves analysis of submitted source while preventing an external PR from replacing the quality-policy scripts that enforce the result.

## Full-repository quality gate

Pushes to `main`, the weekly schedule and manual dispatch run a full inventory with `pr-mode: false`.

The repository currently has historical non-critical Qodana debt, so an absolute repository-wide `failThreshold: 0` would make the lane permanently red and would not distinguish regressions from existing findings. Instead the SARIF guard enforces hard invariants while preserving the full report:

- Critical findings: `0` allowed.
- Unresolved-symbol findings: `0` allowed.
- Files affected by unresolved-symbol findings: `0` allowed.
- Project-model/restore/build/SDK/package-resolution failures: `0` allowed.
- Missing or invalid SARIF: hard failure.
- Qodana process failure: hard failure.

All non-critical findings remain visible in the uploaded inventory and can be retired incrementally. Because PRs reject every changed-code finding, new debt is prevented at the merge boundary.

## Exclusion rationale

Qodana analyzes first-party source and tests, but not generated output, dependencies, runtime data or inactive source.

Configured exclusions include:

- `**/bin/**`, `**/obj/**`: build/compiler output.
- `**/node_modules/**`: external npm dependencies.
- `**/dist/**`, `**/.angular/**`, `**/storybook-static/**`: frontend generated output/cache.
- `**/coverage/**`, `**/TestResults/**`, `**/test-results/**`, `**/playwright-report/**`, `**/.playwright/**`: test/browser output.
- `**/.qodana/**`, `.tmp`, `**/artifacts/**`: scanner and CI/local artifacts.
- `src/AipPortal.Web/wwwroot`: hosted frontend build output; source of truth is `frontend/`.
- `src/AipPortal.Web/data`: local runtime data.
- `aipsite-frontend`: inactive legacy frontend scaffold.

Tests are not excluded.

## Local reproduction

Backend preparation:

```powershell
dotnet --info
dotnet --list-sdks
dotnet restore AipPortal.slnx --verbosity normal
dotnet build AipPortal.slnx --configuration Release --no-restore
```

Community Qodana Docker run:

```powershell
$project = (Get-Location).Path
$results = Join-Path $project ".tmp/qodana/results"
$cache = Join-Path $project ".tmp/qodana/cache"

docker run --rm `
  -e QODANA_SKIP_FRONTEND_BOOTSTRAP=true `
  -v "${project}:/data/project" `
  -v "${results}:/data/results" `
  -v "${cache}:/data/cache" `
  jetbrains/qodana-cdnet:2026.2-privileged@sha256:21bbbfeac0e61fe8790cc27d5754b87d57b8032c0c32f84ddeb887027f83ec4f `
  --project-dir /data/project `
  --repository-root /data/project `
  --results-dir /data/results `
  --cache-dir /data/cache `
  --config qodana.yaml

$env:QODANA_CRITICAL_THRESHOLD = "0"
$env:QODANA_UNRESOLVED_THRESHOLD = "0"
$env:QODANA_UNRESOLVED_FILE_THRESHOLD = "0"
node scripts/quality/check-qodana-project-model.mjs .tmp/qodana/results/qodana.sarif.json
```

A PR-equivalent local scan can additionally pass `--fail-threshold 0` while restricting analysis to the intended changed-code range.
