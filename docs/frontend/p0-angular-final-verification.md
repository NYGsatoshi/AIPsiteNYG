# MVP-A P0 Angular Final Frontend Verification

Date: 2026-07-03

Scope: Angular frontend under `frontend/`, repo-level Angular Playwright wrapper, and backend test coverage required by CI. Legacy static SPA behavior, selectors, and screenshot baselines were not used as acceptance evidence.

## P0 Status

Conditional Go.

The automated Angular gate is green after the CSRF retry fix: production build, unit tests, Storybook build, Angular Playwright smoke, and backend tests all passed on valid reruns. The status remains Conditional Go rather than full Go because no Angular-approved screenshot baselines exist yet, so screenshot regression was intentionally not activated or updated in this pass.

## Pass/Fail Summary

| Area | Status | Evidence |
| --- | --- | --- |
| Root Playwright dependencies | Pass | `docs/evidence/mvp-a/frontend-final-2026-07-03/01-root-npm-ci.log` |
| Angular dependencies | Pass | `docs/evidence/mvp-a/frontend-final-2026-07-03/02-frontend-npm-ci.log` |
| Angular production build | Pass | Initial sandbox run hit the known `Cannot read directory "../../../..": Access is denied.` issue; valid post-fix unsandboxed run passed in `13-frontend-build-after-csrf-fix.log`. |
| Angular unit tests | Pass | Post-fix rerun passed 17 files / 125 tests in `14b-frontend-test-after-csrf-fix-rerun.log`. The previous post-fix attempt timed out in existing tests under host load; it is retained as `14-frontend-test-after-csrf-fix.log`. |
| Storybook build | Pass | Post-fix unsandboxed run completed and emitted `frontend/storybook-static`; see `15-frontend-build-storybook-after-csrf-fix.log`. |
| Angular Playwright smoke | Pass | Post-fix run passed 46 tests with 2 skipped non-P0 legacy static SPA placeholders; see `16-root-angular-playwright-after-csrf-fix.log`. |
| Backend tests | Pass | Unsandboxed rerun passed 234/234 tests; see `07-backend-dotnet-test-rerun-unsandboxed.log`. The sandbox attempt was blocked by NuGet network access. |
| AG Grid Enterprise absence | Pass | Source/package scan found no package or import usage; only tests asserting absence matched. See `08-ag-grid-enterprise-scan.log`. |
| AG Grid wrapper boundary | Pass | `AgGridAngular` is used by `AppDataGridComponent`; route pages import the wrapper. See `09-ag-grid-wrapper-scan.log`. |
| Global search boundary | Pass | Route/nav scan found page-local search only, no global DB search route. See `10-search-route-scan.log`. |
| CSRF/session/storage scan | Pass after fix | Unsafe same-origin API requests attach CSRF, token fetch failure blocks mutation, third-party requests do not receive CSRF, and retry is now covered once. See `11-csrf-storage-scan.log` and updated unit test. |
| Screenshot regression | Not run by design | No Angular-approved baselines or snapshot images exist; see `12-screenshot-baseline-scan.log`. |
| Lint/format scripts | Not configured | Root and frontend package scripts do not define `lint` or `format`; final whitespace check is `git diff --check`. |

## Commands Run

| Command | Working directory | Result |
| --- | --- | --- |
| `npm.cmd ci` | repo root | Pass |
| `npm.cmd ci` | `frontend/` | Pass |
| `npm.cmd run build` | `frontend/` | Sandbox blocked first; valid unsandboxed reruns passed. |
| `npm.cmd run test` | `frontend/` | Sandbox blocked first; valid pre-fix run passed 124 tests; post-fix rerun passed 125 tests. |
| `npm.cmd run build-storybook` | `frontend/` | Sandbox blocked first; valid unsandboxed reruns passed. |
| `npm.cmd run test:ui:angular` | repo root | Pass; served `frontend/dist/aipportal-web`. |
| `dotnet test AipPortal.slnx --configuration Release --verbosity normal --disable-build-servers -m:1` | repo root | Sandbox restore blocked by NuGet network; valid unsandboxed rerun passed 234 tests. |
| `rg` guardrail scans for AG Grid, search, CSRF/storage, screenshots | repo root | Pass. |
| `git diff --check` | repo root | Pass. |

## Screens Verified

Playwright verified these Angular routes in desktop and mobile projects:

- `/`
- `/login`
- `/app/workspaces`
- `/app/workspaces/fictional-workspace-1/members`
- `/app/announcements`
- `/app/workspaces/fictional-workspace-1/channels/fictional-conversation-main`
- `/app/dm/fictional-dm-1`
- `/app/files`
- `/app/projects`
- `/app/tasks`
- `/app/admin/audit`
- `/app/admin/export-diagnostics`
- `/app/account`
- `/register/invite`
- `/permission-denied`
- `/not-a-real-angular-route`
- `/api/playwright-angular-smoke` as backend-owned JSON 404, not Angular fallback

Storybook build covered the Angular story bundles for app shell, navigation, right panel, shared states, workspace, announcements, messaging, files, projects/tasks, account, invite registration, audit log, and export diagnostics pages.

## Tests Added Or Updated

- Updated `frontend/src/app/core/auth/auth-session.interceptor.ts` so likely CSRF `403` responses on unsafe first-party API requests clear the stale token, fetch a fresh token, retry once with the refreshed header, and then stop.
- Added `retries unsafe CSRF failures once with a refreshed token` in `frontend/src/app/core/auth/auth-session.interceptor.spec.ts`.

## Screenshot Baseline Decision

No screenshot baselines were used or added.

Reason: `docs/verification/mvp-a/frontend-ci-stages.md` says this Angular smoke lane has no blocking screenshot baselines yet, and `playwright.config.ts` points future approved snapshots to `tests/ui/__angular_snapshots__/`. The scan in `12-screenshot-baseline-scan.log` found no Angular snapshot images. Creating new baselines during this verification would make unreviewed images authoritative, so this pass kept screenshot regression pending.

Generated Playwright artifacts:

- `playwright-report/index.html`
- `test-results/playwright-results.xml`

No failure screenshots, traces, or videos were required by the final passing run.

## Remaining Backend Blockers

No backend automated test blocker remained in this pass: the full backend test command passed 234/234 after rerunning outside the sandbox.

Backend authorization remains mandatory and is not replaced by UI hiding. Live product Go still depends on keeping the backend authorization, tenancy, CSRF, file, messaging, audit, and PostgreSQL checks green in CI and on closing any separate live API-binding gaps tracked outside this final Angular mock verification.

## Remaining Frontend Blockers

- Screenshot regression is pending until Angular-approved baselines are reviewed and committed.
- The production Angular build still reports a non-fatal initial bundle budget warning: initial bundle is about 663 kB against the 500 kB budget.
- The first post-fix unit run timed out in four existing specs under host load, then the exact rerun passed 125/125. Treat this as an environment-performance warning unless it repeats in CI.

## Evidence Paths

- Logs: `docs/evidence/mvp-a/frontend-final-2026-07-03/`
- Angular build output: `frontend/dist/aipportal-web`
- Storybook output: `frontend/storybook-static`
- Playwright report: `playwright-report/index.html`
- Playwright JUnit: `test-results/playwright-results.xml`
