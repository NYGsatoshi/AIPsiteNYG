# AI Context

This is the primary entry point for future Codex work on AIPsiteNYG.

Last repository audit: **2026-07-31**.

## Documentation authority

Use this order when claims conflict:

1. Current implementation and configuration under `src/`, `tests/`, `.github/`, and the root deployment files.
2. Active status documentation: this file and `docs/KNOWN_ISSUES.md`.
3. Focused active documentation under `docs/`.
4. `docs/ROADMAP.md` for intended future direction.
5. `docs/archive/` only as historical context.

Do not infer that an entity, configuration property, controller route, or archived plan proves a complete product workflow.

## Status labels

- **Implemented**: wired into the application with direct source evidence.
- **Partially implemented**: some layers exist, but an important workflow, UI, adapter, test, or enforcement layer is missing.
- **Planned**: no current implementation.
- **Deprecated**: compatibility-only or historical.
- **Needs verification**: environment or runtime evidence is missing.
- **Inferred**: conclusion drawn from code, explicitly identified as such.

“Implemented” does not mean production-ready.

## Verified stack

- .NET 10 / ASP.NET Core: project files under `src/`.
- EF Core 10 with Npgsql/PostgreSQL: `src/AipPortal.Infrastructure/AipPortal.Infrastructure.csproj`.
- Cookie authentication: `src/AipPortal.Web/Program.cs`.
- Angular browser UI source: `frontend/`; hosted build artifacts are copied to `src/AipPortal.Web/wwwroot/`.
- xUnit tests: `tests/AipPortal.Tests/`.
- Playwright and axe UI tests: `tests/ui/`, with static Angular/mock coverage
  plus an isolated Compose-backed MVP0 real-backend smoke for cookie, CSRF, and
  seeded workflow compatibility.
- Docker and Docker Compose: `Dockerfile`, `docker-compose*.yml`.

## Architecture

The application is one deployable ASP.NET Core process split into four projects:

- `AipPortal.Domain`: entities, enums, and shared domain types.
- `AipPortal.Application`: service interfaces, use cases, DTOs, authorization, feature/quota logic.
- `AipPortal.Infrastructure`: `AppDbContext`, migrations, repositories, local files, audit, notifications, search, hashing.
- `AipPortal.Web`: startup, middleware, controllers, authentication, tenant resolution, and hosted frontend artifacts.

Project references enforce a conventional dependency direction. See `docs/ARCHITECTURE.md`.

## Implementation status matrix

| Capability | Status | Source evidence and qualification |
| --- | --- | --- |
| Host, controllers, middleware, hosted Angular frontend | Partially implemented | `src/AipPortal.Web/Program.cs`, `Controllers/`, `AngularSpaFallback.cs`, `frontend/`; Angular build artifacts are required in `wwwroot/` for user-facing routes |
| Cookie auth, login/logout, password change | Implemented | `Application/Auth/`, `Web/Controllers/AuthController.cs` |
| Database-backed session revocation/expiry/user-state checks | Implemented | `Auth/UserSessionService.cs`, `Web/Security/DbSessionCookieAuthenticationEvents.cs` |
| Login lockout | Implemented | `Auth/AuthService.cs`; production defaults enable it |
| Password reset | Planned | Admin reset endpoint only records an audit event |
| Initial admin bootstrap | Implemented | `Program.cs` reads `AIP_SEED_ADMIN_ENABLED`; `AppDbContextSeed.SeedLocalAdminAsync` creates or updates a platform administrator through `IPasswordHasher` and default-tenant owner membership |
| Invite registration | Partially implemented | User/session creation exists; tenant/workspace membership creation is missing |
| Tenant resolution | Implemented | Host, subdomain, session, development header, and config-default strategies in `HttpTenantResolver.cs` |
| Tenant query isolation and save stamping | Implemented | Global filters and save rules in `AppDbContext.cs` |
| Tenant isolation confidence | Partially verified | In-memory HTTP tests and conditional PostgreSQL tests exist; target-environment verification is still required |
| Platform and tenant administration APIs | Implemented | `PlatformTenantsController`, `TenantAdministrationController`, application services |
| `Platform:*` configuration switches | Partially implemented | Properties are bound; only setup mode is consulted by startup validation |
| Database tenant feature flags and quotas | Partially implemented | File uploads, exports, integrations, and UI shell use them; broad module gating is incomplete |
| `Features:*` appsettings switches | Documentation mismatch | Bound in DI but not used to gate controllers/services |
| Workspaces/groups/channels/posts | Backend implemented; browser UI planned/partial | REST layers exist; routes render placeholders |
| Messaging | Partially implemented | REST, direct-message recipient search, direct conversation creation, browser send/read persistence, and PR07 durable realtime message/unread events with Angular reconciliation exist; safe attachment ownership and production PostgreSQL verification remain incomplete |
| Announcements | Partially implemented | REST and UI exist; scoped visibility and frontend role/user-ID behavior have confirmed defects |
| Projects/tasks/milestones/assignments/comments/Gantt data | Partially implemented; PR06 current code-bearing remediation passed ordinary Hosted gates | PR02 adds versioned Task workflow, relationship, review, Claim, and FS-authoring command routes. PR05 adds the canonical Project Kanban snapshot/config/move flow. PR06 upgrades the existing Project Detail Schedule tab and Gantt route with a bounded scheduled/unscheduled projection, manual schedule/progress/FS dependency commands, canonical Task-only parent derivation and terminal parent/child guards, optimistic concurrency, explicit conflict Retry/Discard, structured warnings, accessible/mobile alternatives, lazy vendor isolation, and authoritative realtime refetch. Current test-only remediation candidate `f2d3805466b2a9bce3e2a7bf8392069330a1d6fd` validates the exact safe Project-detail denial and current protected-state status instead of suppressing arbitrary failures. Its Documentation CI, CI, Code Quality, and npm Security Audit runs succeeded. A fresh Real Backend rerun completed all six smoke scenarios, including 30 PR06 steps, with no failure/skip or secret match and uploaded a valid artifact; its workflow conclusion is still Pending while post-job cleanup runs. The numeric graph-limit owner decision and post-documentation exact-final-HEAD Gates also remain pending. See `docs/TASK_V1_PR02.md`, `docs/TASK_V1_PR05.md`, and `docs/TASK_V1_PR06.md`. |
| Events/attendance/calendar | Backend implemented; browser UI planned | Controller/service/repository/tests exist; calendar route is a placeholder outside dashboard summary |
| Forms/surveys | Backend implemented; browser UI planned | Controller/service/repository/tests exist; `/forms` is a placeholder |
| Notifications | Implemented with polling UI | Database-backed; no realtime push |
| Search | Partially implemented | `DbSearchService` exists, but project/comment visibility is broader than canonical authorization; `/search` UI remains unavailable |
| Local filesystem files | Partially implemented | Authorization, policy, repository, and storage exist; upload/database failure cleanup and controlled missing-file handling are incomplete |
| Object storage | Planned | Unsupported adapter is selected for object-storage provider names |
| Tenant export | Partially implemented | Metadata ZIP only; excludes file bodies; no restore |
| API token records and validator | Foundation only | No request authentication handler, tenant binding, or scope middleware |
| Webhook records and validation | Foundation only | “Test” validates configuration and sends no outbound request |
| UI shell data model | Foundation only | Modules/panels/layouts/commands/radial-menu APIs exist; radial UI control is disabled |
| SignalR and transactional Outbox | Messaging, Project Kanban, and PR06 Schedule integration implemented; final PR06 real-transport Gate pending | Authenticated `/hubs/app`, server-authorized subscriptions, durable Outbox persistence, dispatcher retry/dead-letter/retention, diagnostics, and Angular reconnect/catch-up exist. PR07 adds messaging create/update/delete/unread reconciliation; PR05 uses committed Task/Project invalidations for Kanban. PR06 transactionally queues Task/Project schedule invalidations and treats them as version hints for authoritative Gantt HTTP refetch, including active-edit queuing, reconnect, degraded HTTP behavior, and synchronous protected Kanban/Gantt clear plus generation invalidation when Project subscription reauthorization is denied. Current `f2d3805` licensed smoke execution passed all six scenarios, including revocation and degraded HTTP, with 0 failed/skipped; the workflow is still running post-job cleanup, and the documentation-bearing exact-final-HEAD rerun remains required. |
| Billing/payments, SSO/MFA, background jobs | Planned | No implementation found |

## Status groups

### Implemented

- Modular ASP.NET Core host and REST controllers.
- EF Core/PostgreSQL model and migrations.
- Cookie login/logout/password change, CSRF, lockout, and database session validation.
- Tenant resolution, global query filters, tenant stamping, and inactive-tenant write rejection.
- Broad application services for collaboration, projects, forms, events, files, notifications, search, audit, and administration.
- Local filesystem storage and metadata-only tenant export.

### Partially implemented

- Invite registration and tenant user invitation.
- Tenant feature flags and quotas.
- Platform/tenant administration workflows.
- Browser UI outside auth, dashboard, messaging, announcements, notifications, and projects.
- Deployment profiles, object-storage configuration, tenant export, API tokens, webhooks, and UI-shell customization.
- End-to-end tenant isolation and frontend/backend integration verification.

### Planned

- Password reset delivery, object storage, API token authentication, outbound webhooks, background jobs, tenant restore, SSO/MFA, billing, automatic/advanced planning, and full docking/radial UI.

### Deprecated

- `SystemRole.SystemAdmin` is a compatibility alias for `PlatformAdmin`.
- Documents under `docs/archive/` are historical and may describe superseded behavior.

### Unknown or needs verification

- Provisioning method used by any existing deployment.
- Real Compose startup and target-environment behavior.
- Reverse-proxy scheme/host handling.
- Latest CI status.
- Backup retention and successful restore evidence.
- Production data volume, performance, PostgreSQL version, and storage topology.

## Critical current constraints

- A fresh environment can create the first login user or PlatformAdmin only through the explicit `AIP_SEED_ADMIN_*` startup seed.
- Invite acceptance does not create tenant/workspace membership.
- Object-storage examples are not deployable because the adapter is intentionally unsupported.
- `docker-compose.onprem.yml` does not apply EF migrations.
- Production reverse-proxy support is incomplete because forwarded-header middleware is not configured.
- Angular browser UI coverage is materially smaller than backend API coverage.
- The regular Playwright suite mocks API contracts and does not prove
  frontend/backend compatibility. PR06 adds a real-backend scenario, but its
  licensed exact-final-HEAD hosted evidence is still pending.
- API errors are not standardized repository-wide despite
  `docs/API_CONTRACTS.md` describing a shared shape. PR06 aligns only its Gantt
  snapshot/command/dependency routes with a narrow safe envelope.
- Critical backend logic defects affect scoped announcements, search authorization, conversation persistence, and message attachments.

Details and suggested issue titles are in `docs/KNOWN_ISSUES.md` and `docs/BACKEND_LOGIC_AUDIT.md`.

## Testing facts

The 2026-06-18 local audit observed 123 passing .NET tests. This result needs qualification:

- PostgreSQL integration tests are explicitly skipped locally when `POSTGRES_TEST_CONNECTION_STRING` is absent and fail under CI when it is absent; a passing CI run still supplies the required execution evidence.
- HTTP tests use Kestrel but mostly EF Core InMemory.
- Root Playwright legacy static-SPA specs are obsolete after the Angular migration; future Playwright coverage should target Angular build output or a hosted Angular app.
- CI supplies PostgreSQL and runs migrations before `dotnet test`.

TASK-V1-PR06 final-remediation evidence on 2026-07-31 is not yet final-HEAD
Acceptance evidence:

- Draft PR #259 is open and mergeable. Latest main
  `1739cfcc819174289d858cbacc255527f1ffa047` was incorporated without conflict
  by normal merge commit `0b2d5fc1e99d441e278be1716b9fbb8baed96e90`.
  Current code-bearing candidate is
  `f2d3805466b2a9bce3e2a7bf8392069330a1d6fd`; ahead/behind is 20/0 before the
  later documentation commit.
- Exact `69cc6f0` local evidence passed restore/Release build, PostgreSQL 18.4
  empty apply/PR05 upgrade/data preservation/additive down, PR06 49/49, PR05
  25/25, PR04 8/8, and full backend 494/494 with 0 failed/skipped.
- Exact `69cc6f0` frontend evidence passed separate root and active-frontend
  `npm ci`, Angular 323/323 in 42 files, production build, architecture 4/4,
  Syncfusion license policy 4/4, bundle analysis, raised-heap Storybook, and
  mocked Playwright 63 passed with 3 expected skips. Default 2 GB Storybook
  exited 134 and is not a pass. Gantt remained lazy at approximately 5.42 MB;
  initial bundle was 949.99 kB.
- Main `1739cfc` had regressed the active frontend lockfile from `tar` 7.5.22
  to 7.5.19. Commit `69cc6f0` changes only the three lockfile metadata fields
  needed to retain `tar` 7.5.22. Exact-candidate active-frontend npm audit is
  19 findings (3 low, 6 moderate, 10 high, 0 critical), versus 20 on latest
  main (3 low, 7 moderate, 10 high, 0 critical); no affected path contains
  Syncfusion. Local toolchain was Node
  `v24.13.0` and npm `11.6.2`; the active `frontend/package.json`
  `packageManager` is `npm@11.17.0`, and latest-main .NET test tooling 10.0.10
  is retained.
- Historical candidate `e0e87dd9b4933af8165e472cc02761db0ff3ab6e`
  passed Documentation CI `30612005927`, CI `30612006065` attempt 2, Code
  Quality `30612006010`, and npm Security Audit `30612006220`. Its Qodana
  inventory remained 2,260 findings (1,421 warning, 839 note, 0 error,
  0 critical), model unresolved/failures 0, material PR06 findings 0, and
  PR-introduced findings 0. Its Real Backend run `30625754075`, job
  `91140507111`, was cancelled with no setup steps and is not a pass.
- Earlier candidate `555379db03d076627f04083a43eb07fe7ffa23bc` Real Backend
  run `30611459543`, job `91094951966`, failed before login: JUnit 6 total,
  0 passed, 0 assertion failures, 6 errors, 0 skipped. Trace confirmed internal
  HSTS 307 from `http://app:8080` to `https://app:8080`, then
  `ERR_SSL_PROTOCOL_ERROR`. It executed 0 PR06 steps/commands; artifact
  `8785696348` has digest
  `sha256:e5a102f3263a296f31ce2cf00853800d47d04d5b21a7816a69f32995031f092d`;
  high-confidence secret matches were 0.
- Exact `69cc6f0` Documentation CI run `30626428426`, CI run `30626428493`
  attempt 4, Code Quality run `30626428491` attempt 3, and npm Security Audit
  run `30626428487` all succeeded. CI jobs were build-test `91146858583`,
  security-scan `91146858952`, and frontend-test `91146858537`; Code Quality
  jobs were Qodana `91149477336` and Angular quality `91152690654`. Hosted
  frontend evidence included Angular 323/323, raised-heap Storybook, and mocked
  Playwright 63 passed with 3 expected skips.
- Exact `69cc6f0` Qodana inventory was 2,260 findings (1,421 warning, 839 note,
  0 error, 0 critical), with 0 unresolved model findings/failures, 0 material
  PR06 findings, and 0 PR-introduced findings after added-line and source/base
  triage. Its active-frontend audit artifact reported 19 findings: 5 direct and
  14 transitive. Every finding has a reported `fixAvailable` path, but the
  available changes include major or inconsistent downgrade candidates; no
  forced fix is authorized. Syncfusion affected paths remain 0.
- Exact `69cc6f0` Real Backend run `30630832231`, job `91156526050`, failed:
  JUnit reported 6 total, 4 passed, 2 failed, 0 errors, and 0 skipped. PR05 had a stale UI
  text expectation after protected state was safely cleared; PR06 observed the
  exact safe `GET /api/projects/{projectId}` HTTP 400 denial but had not
  registered that scenario-specific response for console reconciliation.
  Artifact `8793522897` has digest
  `sha256:79841bfa974edfee464256d5415165f53a606eab760e9c2c2887aaa95115033c`;
  high-confidence secret matches were 0. Test-only commit `f2d3805` now asserts
  that exact safe response, protected-value redaction, and the current
  authorization-clear status without adding retries/timeouts or broad 400
  suppression.
- Exact `f2d3805` local PostgreSQL-enabled reruns passed PR06 49/49, PR05 25/25,
  PR04 8/8, and full backend 494/494 with 0 failed and 0 skipped. A preceding
  run without PostgreSQL supplied is not used as Acceptance evidence.
- Exact `f2d3805` Documentation CI `30632549237` / job `91162128837`, CI
  `30632549234` / jobs `91162129484`, `91162129549`, and `91163476861`, Code
  Quality `30632549238` / jobs `91162129048` and `91164686596`, and npm
  Security Audit `30632549183` / job `91162128341` all succeeded. Hosted CI
  again reported backend 494/494, Angular 323/323, raised-heap Storybook, and
  mocked Playwright 63 passed with 3 expected skips. Qodana remained 2,260
  findings (1,421 warning, 839 note, 0 error, 0 critical), short report 0,
  model unresolved/failures 0, and material PR06 findings 0. npm remained 19
  active-frontend findings (3 low, 6 moderate, 10 high, 0 critical).
- The first exact `f2d3805` Real Backend run `30632559051`, job `91162166864`,
  was cancelled before setup and produced no artifact. Fresh run `30634069147`,
  job `91167131007`, has completed its smoke step: 6/6 scenarios passed with
  0 failed/skipped, the PR06 scenario recorded all 30 required steps, artifact
  `8794673197` has digest
  `sha256:660fbe4b8eafc0f967f4fa9ae7915f47b0a01951f16b3634d15d986e665ba814`,
  and high-confidence secret matches are 0. The workflow is still in progress
  during post-job cleanup, so the Real Backend Gate remains Pending until its
  overall conclusion is `success`.
- The exact `f2d3805` review check found 0 unresolved threads. A distinct
  documentation-bearing final-HEAD recheck remains pending.
- After this documentation update, Documentation CI, CI, Code Quality, npm
  Security Audit, and Real Backend must all rerun on the exact new HEAD. That
  post-commit SHA and its run IDs will be recorded in the PR body and final
  report without another source-only self-reference commit.

Historical pre-remediation and earlier-candidate evidence remains in
`docs/verification/task-v1-pr06-gantt.md`; it is not used as final Acceptance
evidence for `f2d3805466b2a9bce3e2a7bf8392069330a1d6fd`.

The PR06 snapshot and command paths use a provisional limit of 500 items,
counted consistently as canonical Task-kind WorkItems plus canonical
Milestones, and 2,000 active dependencies whose endpoints are active
same-Project canonical Tasks, with typed HTTP 400 rejection and no truncation.
This is an implementation safeguard: canonical authority says only that the
snapshot is bounded and provides no numeric values or overflow contract. No
owner decision was found in the PR body/comments. `Resolved: No`;
`DECISION REQUIRED: Yes`.

Read `docs/TESTING.md` before using “tests pass” as evidence.

## What to read by task

Always start with:

- `docs/AI_CONTEXT.md`
- `docs/KNOWN_ISSUES.md`
- `docs/CODING_RULES.md`

Then add:

- Backend controllers, services, validation, files, or business logic: `docs/BACKEND_LOGIC_AUDIT.md`
- Architecture or module boundaries: `docs/ARCHITECTURE.md`
- Local work: `docs/DEVELOPMENT.md`
- Deployment/configuration: `docs/DEPLOYMENT.md`
- Auth, authorization, tenancy, secrets, files: `docs/SECURITY_MODEL.md`
- Schema, migrations, persistence: `docs/DATABASE.md`
- Test changes or verification claims: `docs/TESTING.md`
- Detailed entity fields: `docs/DATA_MODEL.md`
- API conventions: `docs/API_CONTRACTS.md`
- Canonical Gantt implementation/evidence:
  `docs/TASK_V1_PR06.md` and
  `docs/verification/task-v1-pr06-gantt.md`
- Operations and recovery: `docs/OPERATIONS.md`
- Intended future scope: `docs/ROADMAP.md`

Only read `docs/archive/` when historical decisions or earlier claims are relevant. Start at `docs/archive/README.md`.

## Rules for future audits

- Verify a feature across controller, application service, persistence, configuration, UI, and tests as applicable.
- Mark code-derived behavior as **inferred** when it has not been run.
- Mark environment claims as **needs verification** without deployment evidence.
- Treat configuration properties as inert until a code reader is found.
- Treat a route as backend-only unless the bundled UI actually exposes a working flow.
- Treat mocked UI tests as frontend behavior tests, not API integration tests. Do not treat removed legacy static-SPA selectors or mocks as UI contracts.
- Do not call an export a backup or restore mechanism.
- Do not call an archived status snapshot current.
