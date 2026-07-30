# AI Context

This is the primary entry point for future Codex work on AIPsiteNYG.

Last repository audit: **2026-07-30**.

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
| Projects/tasks/milestones/assignments/comments/Gantt data | Partially implemented; PR06 working tree needs final verification | PR02 adds versioned Task workflow, relationship, review, Claim, and FS-authoring command routes. PR05 adds the canonical Project Kanban snapshot/config/move flow. PR06 upgrades the existing Project Detail Schedule tab and Gantt route with a bounded scheduled/unscheduled projection, manual schedule/progress/FS dependency commands, canonical Task-only parent derivation and terminal parent/child guards, optimistic concurrency, explicit conflict Retry/Discard, structured warnings, accessible/mobile alternatives, lazy vendor isolation, and authoritative realtime refetch. Exact final-HEAD hosted/real-browser/review evidence and the numeric graph-limit owner decision remain pending. See `docs/TASK_V1_PR02.md`, `docs/TASK_V1_PR05.md`, and `docs/TASK_V1_PR06.md`. |
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
| SignalR and transactional Outbox | Messaging, Project Kanban, and PR06 Schedule integration implemented; final PR06 verification pending | Authenticated `/hubs/app`, server-authorized subscriptions, durable Outbox persistence, dispatcher retry/dead-letter/retention, diagnostics, and Angular reconnect/catch-up exist. PR07 adds messaging create/update/delete/unread reconciliation; PR05 uses committed Task/Project invalidations for Kanban. PR06 transactionally queues Task/Project schedule invalidations and treats them as version hints for authoritative Gantt HTTP refetch, including active-edit queuing, reconnect, degraded HTTP behavior, and synchronous protected Kanban/Gantt clear plus generation invalidation when Project subscription reauthorization is denied. |
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

TASK-V1-PR06 working-tree evidence on 2026-07-30 is newer but is not yet
final-HEAD acceptance evidence:

- Draft PR #259 is open. Its code-bearing HEAD is
  `ab9a260dd4517d34a2500d5e76369ba241b504ee`; the documentation HEAD and exact
  final-HEAD Gates remain pending.
- Restore succeeded with every project up to date; the Release build passed at
  the code-bearing HEAD with 0 warnings and 0 errors.
- `Scope=TaskV1PR06` passed 45/45 with PostgreSQL 18.4 supplied, with 0 failed
  and 0 skipped.
- `Scope=TaskV1PR05` passed 25/25 and `Scope=TaskV1PR04` passed 8/8, each with
  0 failed and 0 skipped. The full backend suite passed 485/485 at the
  code-bearing HEAD with 0 failed and 0 skipped.
- EF reported no pending model changes.
- `npm ci` succeeded. npm audit reported 18 known vulnerabilities: 3 low,
  7 moderate, 8 high, and 0 critical.
- The full Angular suite passed 318/318, the production build succeeded,
  architecture checks passed including 4/4 Node tests, Syncfusion license
  policy tests passed 4/4, and bundle analysis succeeded. Gantt remained a
  lazy approximately 5.42 MB chunk; the initial bundle was 950.01 kB with a
  budget warning.
- Mocked Playwright passed 63 tests with 3 pre-existing explicitly expected
  skips; the PR06 desktop/mobile subset passed 4/4 with no skips. These results
  still do not establish real backend compatibility.
- The exact local Storybook command exhausted the 2 GB Node heap and is not a
  pass; the same source built successfully with
  `NODE_OPTIONS=--max-old-space-size=4096`.
- The repository projection is measured at seven commands and the authorized
  real Kestrel/PostgreSQL snapshot at exactly 24 commands total, including
  tenant, cookie/session authorization, membership, timezone, and projection
  queries. Exact SQL is emitted in xUnit evidence; bounded/no-N+1 and
  cancellation behavior are asserted.
- Focused backend coverage includes Task-kind-only direct-child derivation,
  terminal-parent subtask rejection, terminal-child reopen guard, parent Done
  requiring terminal children and derived progress 100, and rejection of an
  all-cancelled child set. Review override, restore, and delete preserve those
  terminal hierarchy guards.
- Additional PostgreSQL coverage verifies the post-count read race, canonical
  parent-derived dependency warnings, active bounded dependency filters,
  metadata-safe rejection auditing, compatibility Milestone version/date/409
  behavior, and shared Project-revision protection against a concurrent Task
  delete/dependency add race.
- Reviewer reconciliation reports 0 residual material PR06 findings; exact
  final-HEAD hosted/Qodana/GitHub review evidence remains pending.
- Local real-backend execution is not countable without
  `SYNCFUSION_LICENSE`; exact-final-HEAD hosted execution remains required.

The PR06 snapshot and command paths use a provisional limit of 500 items,
counted consistently as canonical Task-kind WorkItems plus canonical
Milestones, and 2,000 dependencies, with typed rejection and no truncation.
The canonical specification does not define those numbers or overflow
semantics, so this remains `DECISION REQUIRED`.

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
