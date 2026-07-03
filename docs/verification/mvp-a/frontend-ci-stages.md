# MVP-A P0 Frontend CI Stages

Angular under `frontend/` is the only supported MVP-A P0 frontend implementation.
The repository root `package.json` is retained for repo-level Playwright/E2E
infrastructure only.

## Current CI Gate

1. Backend restore, build, migrations, and tests stay in the existing `.NET`
   CI job and are not weakened by the frontend gate.
2. Root `npm ci` installs the repo-level Playwright runner.
3. `frontend npm ci` installs the Angular workspace dependencies.
4. `frontend npm run build` verifies the production Angular build.
5. `frontend npm run test` runs the configured Angular unit test command
   (currently Angular's Vitest-backed `ng test --watch=false`).
6. `frontend npm run build-storybook` verifies Storybook can build from the
   Angular component source.
7. Root `npm run test:ui:angular:docker` runs the Angular Playwright smoke in
   the pinned Linux Playwright image from `docker-compose.playwright.yml`.

## Staged Playwright Plan

- Stage 1, current: Angular build smoke against static built output.
- Stage 2, next: Angular plus mocked API coverage once FE-07 provides the
  AppShell skeleton and stable mock data seams.
- Stage 3, later: ASP.NET Core host plus built Angular and real or seeded API
  data after the backend-hosted frontend path is ready for deterministic CI.

## Screenshot Regression Status

Blocking Angular-approved screenshot baselines exist for the P0 desktop shell
and mobile shell under
`tests/ui/__angular_snapshots__/angular-smoke.spec.ts/`. CI and local baseline
verification must use `npm run test:ui:angular:docker`, which pins the Linux
Playwright browser/runtime to the repository's locked `@playwright/test`
version. Do not approve screenshot baselines generated from Windows or macOS
host-native Playwright runs.
GitHub Actions screenshot failures remain Conditional Go until the same
regression passes again in this Linux Playwright environment.

Screenshot failures are blocking for hidden action exposure, hidden route
exposure, unusable primary navigation, permission/session screen breakage,
messaging composer/file upload/admin grid unusability, or major shell layout
collapse.

## Legacy Static SPA Handling

Legacy static SPA routes, DOM selectors, mocked route behavior, and screenshot
baselines from `src/AipPortal.Web/wwwroot` are not MVP-A P0 requirements. The
remaining legacy Playwright placeholder is skipped and labeled non-P0. New
Playwright screenshot assertions, if added later, must use the
`tests/ui/__angular_snapshots__/` path configured by `playwright.config.ts` and
must be reviewed as Angular-approved baselines generated in the Docker
Playwright environment.

`/api/*` paths are not Angular routes. The static Playwright server returns JSON
404 responses for unknown `/api/*` paths instead of falling them back to
`index.html`.
