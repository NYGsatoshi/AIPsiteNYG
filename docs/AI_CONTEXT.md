# AI Context

This is the primary entry point for future Codex work on AIPsiteNYG.

Last broad repository audit: **2026-08-02**. WPC-02B Workspace-create backend
status update: **2026-08-24**. WS-02 active-Workspace/context-header and WS-03
Workspace-create UI update: **2026-08-24**. Issue #342 Task state-list
candidate update: **2026-08-24**. Issues #350 structured Task Brief and #369
Task progress/activity candidate updates: **2026-08-24**.

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
| Workspaces/groups/channels/posts | Partially implemented; WS-01 dashboard, WS-02 context header, WPC-02B canonical Workspace create, and WS-03 create UI candidate | REST layers exist. WS-02 resolves active Workspace from a valid explicit Workspace route, then a Tenant/user-scoped last-used preference, then the sole authorized active Workspace, otherwise explicit selection; it never selects API row zero. It clears protected feature state and resource subscriptions before activating a different scope. The header separates capability-derived Workspace actions from global Notifications/Account/Logout and presents backend-authorized `Active`/`Review` Project counts as textual Running/Needs review state; legacy `inProgressProjectCount` remains their sum. WPC-02B makes canonical production Workspace creation available to a current Tenant Owner/Admin or a current active Tenant-scoped `workspace.create` grantee. One transaction commits the idempotency claim, active Workspace, creator Owner membership, canonical `WorkspaceGeneral` Conversation and creator participation, `WorkspaceCreated` audit, and authorization Outbox events. The Issue #408 candidate consumes backend `canCreate`, exposes the capability-gated `/workspaces` dialog, keeps one stable `Idempotency-Key` for an unchanged uncertain retry, and activates a verified 201 resource only through the refreshed authorized WS-02 selection boundary. A committed create whose list/selection step fails uses GET/selection-only recovery and never repeats POST. Local preference, hidden controls, and the dialog capability check are not authorization. See `docs/verification/ws-02-workspace-context-header.md` and `docs/verification/ws-03-workspace-create.md`. |
| WPC Project creation/activation | Backend implemented; Issue #409 full create/activation UI candidate | WPC-02A persists canonical Visibility and activation provenance while leaving legacy rows explicitly unknown. WPC-02C implements idempotent, Workspace-scoped `POST /api/workspaces/{workspaceId}/projects`; WPC-02D implements explicit `POST /api/projects/{projectId}/activate` with ProjectGeneral and Task-workflow provisioning under one guarded persistence boundary. Issue #409 adds a backend-owned create-options projection, Workspace-scoped Project list filtering, a named Group/Visibility/date create dialog, a non-operational Draft Overview, and the separately authorized activation action. The browser keeps the same `Idempotency-Key` for an unchanged uncertain retry, records a strict 201 before follow-up reads, and uses GET/navigation-only recovery after a committed create. It never infers Group, Visibility, create, or activation authority from roles or client state. The deprecated unscoped `POST /api/projects` remains disabled. See `docs/verification/wpc-final01-integration-audit.md` and `docs/verification/p0-project-create-activation.md`. |
| Messaging | Partially implemented | REST, direct-message recipient search, direct conversation creation, browser send/read persistence, and durable realtime message/unread reconciliation exist. The Angular Message UI also wires the existing server-authorized Edit, Delete, and generic Report-request endpoints through accessible overflow controls; server responses remain authoritative and generic mutation failures are not rendered verbatim. Reply, Save/bookmark, React/reactions, moderator capability projection, version-precondition/history, 24-hour sender deletion, durable tombstone retention, and report evidence/case workflow are absent product/API contracts. This is an explicitly non-closing Issue #343 slice. Global Message notification delivery is stored per active Tenant membership, while conversation mute state remains conversation-specific; both suppress ordinary and mention notification rows without suppressing conversation activity or realtime delivery. WPC-01 makes Project-scoped direct-message reuse exact; production PostgreSQL conversation pages/counts, unread/update polling, detail, and Message Search share a depth-bounded recursive Thread boundary. Missing/inconsistent/cyclic or deeper-than-32 ancestry fails closed, and creation cannot persist an unreadable level-33 child. Safe attachment ownership remains incomplete. |
| Announcements | Partially implemented | REST and UI exist; scoped visibility and frontend role/user-ID behavior have confirmed defects |
| Projects/tasks/milestones/assignments/comments/Gantt data | Partially implemented; PR06 merged, Issues #342 and #369 candidates, large-project delivery deferred | PR02 adds versioned Task workflow, relationship, review, Claim, and FS-authoring command routes. PR05 adds the canonical Project Kanban snapshot/config/move flow. PR06 upgrades the existing Project Detail Schedule tab and Gantt route with a bounded scheduled/unscheduled projection, manual schedule/progress/FS dependency commands, canonical Task-only parent derivation and terminal parent/child guards, optimistic concurrency, explicit conflict Retry/Discard, structured warnings, accessible/mobile alternatives, lazy vendor isolation, and authoritative realtime refetch. The Issue #342 candidate adds the configured Stage name, string fixed category, independent Blocked state, semantic last-update time, and a backend-authorized boolean-only Task-linked Artifact signal to the maintained desktop and 320-pixel Task list. The Issue #369 candidate makes that configured Stage the Task-detail current phase and exposes already-existing Task-linked ActivityLog records through a separate, lazy, bounded page under the existing Project read boundary; it adds no production Activity writer and does not make Task commands produce execution history. Activity failure is independent of the current phase; realtime remains an invalidation hint for authoritative HTTP reads. Activity does not synthesize historical Stage transitions or percentages and `Issue` is presented as `Needs attention`, not as Task `Failed`. The fixed Task categories remain Backlog/Todo/InProgress/Review/Done/Cancelled; no Task Failed category exists. Large-project pagination and virtualization remain open under `TASK-V1-PR06B`. See `docs/TASK_V1_PR02.md`, `docs/TASK_V1_PR05.md`, `docs/TASK_V1_PR06.md`, `docs/verification/p0-task-state-list.md`, and `docs/verification/p0-task-progress-activity.md`. |
| Structured Task Brief | Implemented in PR #418 (Issue #350) | `TaskItem` has additive nullable Goal, Deliverable, and Constraints storage, each limited to 4,000 characters. Canonical Task detail returns each value with explicit `taskSpecific` or `notSet` provenance; Project context remains separately authorized and is never copied from `Project.Description`. Existing free-form `TaskItem.Description` input and older JSON remain compatible. The maintained Task editor uses a reusable, accessible, responsive Brief component and same-order review, but the product has no integrated Task-create/start surface yet; that orchestration remains owned by Issue #410. Issue #369's separate Activity read and phase presentation sit alongside this detail contract and do not change Brief fields or provenance. Project Task lists stay compact. See `docs/verification/p0-task-brief.md`. |
| Events/attendance/calendar | Backend implemented; browser UI planned | Controller/service/repository/tests exist; calendar route is a placeholder outside dashboard summary |
| Forms/surveys | Backend implemented; browser UI planned | Controller/service/repository/tests exist; `/forms` is a placeholder |
| Notifications | Partially implemented; PR07-D backend/UI foundation present | PR #274 merged the private Workspace digest-preference and logical-key foundation at `c5627eb09ecf19d66146eacdbc3e938c0a1c8563`; PR #275 merged immediate Task Notification production at `93b1c5e260e04c243ff84f7370aca4d869484087`; PR #277 merged the deadline-digest ledger/worker at `8d0b8b20551076ecd73ead06aced4b80c94749e7`. Current target resolution gates Task/digest, Artifact through Project visibility, and Message through recursive Conversation visibility across list/unread/mutation/open and delayed delivery. Task/digest created events alone are reference-only; Artifact/Message retain the legacy embedded shape but are reauthorized before every delivery attempt. The Angular supported-target union still does not bind Artifact/Message navigation. `tasks.notificationsV1` remains default-off. |
| Search | Partially implemented | Project-derived results use the same current SQL-translatable Project read boundary as detail and the non-Archived list scope for Project, Task, Artifact, ActivityLog, Comment, and project-bound Message results. Project list alone preserves current-Workspace explicit-member Archived history; Search, detail, and subordinate reads remain stricter. PostgreSQL Message Search constrains all matching Messages by the shared recursive readable-Conversation relation before deterministic `CreatedAt DESC, Id ASC` ordering and the final bounded result; no arbitrary pre-authorization Conversation cutoff remains. The relation is capped at 32 Thread levels. WPC-02A persisted canonical Visibility is enforced by the shared Project boundary, while legacy `NULL` remains explicitly unclassified. The `/search` UI remains unavailable. |
| Local filesystem files | Partially implemented | Authorization, policy, repository, and storage exist; upload/database failure cleanup and controlled missing-file handling are incomplete |
| Object storage | Planned | Unsupported adapter is selected for object-storage provider names |
| Tenant export | Partially implemented | Metadata ZIP only; excludes file bodies; no restore |
| API token records and validator | Foundation only | No request authentication handler, tenant binding, or scope middleware |
| Webhook records and validation | Foundation only | “Test” validates configuration and sends no outbound request |
| UI shell data model | Foundation only | Modules/panels/layouts/commands/radial-menu APIs exist; radial UI control is disabled |
| SignalR and transactional Outbox | Messaging, Project Kanban, and PR06 Schedule integration implemented; exact final-HEAD PR06 real-transport Gate pending | Authenticated `/hubs/app`, server-authorized subscriptions, durable Outbox persistence, dispatcher retry/dead-letter/retention, diagnostics, and Angular reconnect/catch-up exist. PR05 uses committed Task/Project invalidations for Kanban. PR06 transactionally queues Task/Project schedule invalidations and treats them as version hints for authoritative Gantt HTTP refetch, including active-edit queuing, reconnect, degraded HTTP behavior, and synchronous protected Kanban/Gantt clear plus generation invalidation when Project subscription reauthorization is denied. Historical exact `2fc5910` licensed smoke run `30639800642` passed all six scenarios with 0 failed/skipped; it is not final evidence after latest-main integration and scope cleanup. |
| Billing/payments, SSO/MFA, general-purpose/external job orchestration | Planned | In-process Outbox and PR07-C digest hosted workers exist; no general-purpose external job runner was found |

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

- Password reset delivery, object storage, API token authentication, outbound
  webhooks, general-purpose/external job orchestration beyond the existing
  in-process workers, tenant restore, SSO/MFA, billing, automatic/advanced
  planning, and full docking/radial UI.

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
- Critical backend logic defects still affect scoped announcements,
  conversation persistence, and message attachments. The current PR #281
  candidate closes the
  confirmed Project-derived Search authorization mismatch under the current
  Project read policy.

Details and suggested issue titles are in `docs/KNOWN_ISSUES.md` and `docs/BACKEND_LOGIC_AUDIT.md`.

## Testing facts

The 2026-06-18 local audit observed 123 passing .NET tests. This result needs qualification:

- PostgreSQL integration tests are explicitly skipped locally when `POSTGRES_TEST_CONNECTION_STRING` is absent and fail under CI when it is absent; a passing CI run still supplies the required execution evidence.
- HTTP tests use Kestrel but mostly EF Core InMemory.
- Root Playwright legacy static-SPA specs are obsolete after the Angular migration; future Playwright coverage should target Angular build output or a hosted Angular app.
- CI supplies PostgreSQL and runs migrations before `dotnet test`.

TASK-V1-PR07-C is historical merged prerequisite evidence, not the current
worktree. Its dedicated verification record is
`docs/verification/task-v1-pr07-c-deadline-digest.md`. Conditional PostgreSQL
tests are the authority for migration, five-field identity, concurrent/expired
claims, exact attempt accounting, audited restart, integrated DST identity,
current candidate predicates, Notification/Outbox atomicity, and focused
query-plan evidence. An environment-unset run that reports those tests skipped
must not be promoted to PostgreSQL or completion evidence. Later PR07-D/current
source supplies notification-open and dispatch/replay authorization; those
capabilities must not be inferred from the older PR07-C evidence alone.

Historical TASK-V1-PR06 merge-time evidence from 2026-08-01 follows. It is
retained as evidence of the state before PR #259 merged, not as the current
status:

- Draft PR #259 is open and mergeable. Actual latest main
  `33c35cbc873fcdc78b75663d195ca120e2c01520` was incorporated by normal merge
  commit `1abce6c70d9f665b773d35f75d63c0d05a387cc8`. The active frontend manifest
  and lockfile conflicts were reconciled with Gantt 34.1.30 and main's Grid
  34.1.33 retained. Main queue v2/`queue: max`, Qodana/manual-smoke queue v2,
  Angular 21 architect compatibility, Compodoc 2.0.0, ESLint 10.8.0, globals
  17.8.0, lockfile version 3, and latest test tooling were retained.
- Commit `e8bdf47754ca38b6f4d1b3a31c945ae07432f06f` restored
  `messaging.facade.ts` and `messaging-ui.spec.ts` to actual `origin/main` by a
  forward commit. Both files are absent from `origin/main...HEAD`; the backup
  patch SHA-256 is
  `1099E128C2BBBE43D986C29427F82F2CBDB14371320FEC00E1B402DF628844DD`.
  Ahead/behind is 29/0 before the final documentation commit.
- Exact code-bearing candidate `1abce6c70d9f665b773d35f75d63c0d05a387cc8`
  passed .NET restore and Release build with 0 warnings/errors. PostgreSQL 18.4
  passed empty migration apply through
  `20260730120626_AddCanonicalGanttVersions`, PR05 upgrade/data-preservation/
  additive-down coverage, and pending-model check. PR06 was 49/49, PR05 25/25,
  PR04 8/8, and full backend 494/494, all with 0 failed/skipped.
- The same code-bearing candidate passed root and active/inactive frontend
  `npm ci`. Actual `origin/main` tracks no inspection-workspace lockfile, so
  its requested `npm ci` is unavailable; the documented no-lock install and
  full inventory succeeded. Angular passed 323/323 in 42 files, with production build, architecture 4/4,
  Syncfusion license policy 4/4, lazy-bundle analysis, 4 GB Storybook, and
  mocked Playwright 63 passed with 3 pre-existing expected skips. Default
  Storybook failed with an approximately 2 GB JavaScript heap OOM and is not a
  pass. Gantt remained a 5.42 MB lazy chunk; initial bundle was 949.99 kB.
- Local Node is `v24.13.0` and npm is `11.6.2`. Compodoc 2.0.0 itself supports
  Node 24 and executed, but its nested `@angular-devkit/core` 22.0.4 requires
  Node `^24.15.0`; the inactive workspace install therefore emitted an engine
  warning. No downgrade was made; the repository-specified Hosted Node 24
  toolchain is the Acceptance Gate.
- Local npm audit was root 0; active frontend 15 (3 low, 6 moderate, 6 high,
  0 critical); inactive frontend 8 (0 low, 5 moderate, 3 high, 0 critical).
  No affected audit entry referenced Syncfusion, and no forced fix was run.
- Exact-head attempt `5111784e72054db9501135888e72330672a8c975` passed
  Documentation CI, all CI jobs, npm Security Audit, licensed Real Backend,
  and the Qodana job. Code Quality nevertheless failed because the
  lockfile-free inspection install repeated stale `--prefer-offline` metadata
  resolution and reported `eslint@undefined` / `ERESOLVE`; downstream Angular
  quality steps were skipped, so the workflow is not a pass. Focused commit
  `8efa845dec5c553d5ff2107cf6edef7993141a8b` retains cache-first resolution on
  attempt one and refreshes online metadata on attempt two. No dependency,
  lockfile, queue, Qodana-policy, or test change was made.
- Documentation CI, CI, Code Quality, npm Security Audit, licensed Real Backend
  Browser Smoke, final artifact secret scan, and final review-thread check must
  rerun after the documentation commit on the exact final HEAD. Run IDs will be
  recorded in the PR body without another self-referential source commit.

Historical pre-remediation evidence remains in
`docs/verification/task-v1-pr06-gantt.md`; it is not the current status.

Post-merge resolution on 2026-08-01: PR #259 is merged at
`d5de01cf303c914c2b390346575a22cadb8b4443`. The decision was unresolved at
merge time. The owner subsequently approved the existing 500 combined-item /
2,000 active-dependency / typed HTTP 400 fail-closed safeguards as the
temporary PR06 full-snapshot contract. No successful partial snapshot or
silent truncation is permitted. These are not permanent Project or database
capacity limits; paginated and virtualized large-project delivery remains open
as [`TASK-V1-PR06B` issue #270](https://github.com/NYGsatoshi/AIPsiteNYG/issues/270).

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
- Active Workspace selection/context header:
  `docs/verification/ws-02-workspace-context-header.md`
- Workspace creation dialog/API/retry integration:
  `docs/verification/ws-03-workspace-create.md`
- PR07-C deadline-digest implementation/evidence:
  `docs/decisions/task-v1-pr07-c-deadline-digest-decisions.md` and
  `docs/verification/task-v1-pr07-c-deadline-digest.md`
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
