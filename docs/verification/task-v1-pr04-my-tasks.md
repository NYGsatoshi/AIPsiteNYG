# TASK-V1-PR04 My Tasks verification

## Baseline and authoritative sources

- Main start SHA: `2d2d410fdbdbd13cbf47b0a0b97df4e27fa86563`
- Branch: `task/v1-pr04-my-tasks-acceptance`
- Final branch HEAD: the commit containing this evidence document; the exact
  SHA is recorded in the draft PR and final handoff
- Main push CI: run `30410498290`, success, head `2d2d410fdbdbd13cbf47b0a0b97df4e27fa86563`
- Main push Code Quality: run `30410498299`, success, head `2d2d410fdbdbd13cbf47b0a0b97df4e27fa86563`
- Canonical repository source: `docs/TASK_V1_PR04.md`
- Supporting contracts: `docs/API_CONTRACTS.md`, `docs/SECURITY_MODEL.md`, `docs/DATABASE.md`,
  `docs/TESTING.md`, `docs/TASK_V1_PR02.md`, and the current Task command,
  authorization, Watch, migration, controller, Angular, and test sources
- External specification sources were used read-only for Task planning acceptance,
  API/realtime mapping, and stable ordering. Repository source/tests remain the
  implementation authority.

## Implementation gap audit

### Complete in the starting implementation and retained

- Canonical `GET /api/me/tasks` and `GET /api/me/tasks/counts` routes
- Seven relationship views and the two explicit Workspace scopes
- Server paging DTOs and the project, stage, priority, blocked, search, and
  urgency filters
- `task_items`-rooted projection, active Workspace membership predicate,
  Project visibility predicate, and relationship predicates
- One batched label lookup for the current page
- Grouped Angular list at `/tasks`
- Realtime event coalescing and authorization-state row clearing
- Existing PR04 Task, collaborator, assignee, reviewer, creator, and sort indexes

### Partially complete in the starting implementation, now closed

- Multiple-Workspace users now always send the AppShell/session active Workspace ID
- Workspace changes clear protected rows/counts, reset page 1, cancel the prior
  request, and refetch the selected Workspace
- All six filters and server previous/next/page-size controls are connected to
  canonical HTTP query parameters
- Seven accessible relationship tabs show counts and support arrow/Home/End keys
- Search is debounced and stale responses are generation-guarded
- 401/403, invalid scope, safe not-found, network, and server errors have distinct
  safe frontend handling; 401/403 clear rows and counts
- Manual HTTP refresh remains available while SignalR is degraded

### Missing in the starting implementation, now added

- `Scope=TaskV1PR04` focused real-PostgreSQL projection, migration, SQL-count,
  cancellation, and browser-seed coverage
- HTTP contract coverage for sole/multiple Workspace selection, string enums,
  safe errors, Project visibility roles, cross-Tenant denial, and revocation
- A forward migration for the canonical effective-Watch predicate
- A real-backend PR04 Playwright scenario using ASP.NET Core, PostgreSQL,
  latest migrations, built Angular, cookie auth, CSRF, real My Tasks endpoints,
  and the authorization-state refresh path

### Incorrect in the starting implementation, now corrected

- Undefined relationship enums could fall through to an unfiltered projection
- Public PR04 enums were not consistently serialized as stable strings
- All `PlanningController` failures were flattened to a generic 400
- Priority text was ordered lexicographically instead of canonical severity
- `Today` overlapped `Overdue`; the seven-day calendar boundary was off by one
- Watching trusted legacy `IsWatching` rather than the effective-Watch formula
- Team Queue did not enforce Backlog/Todo eligibility
- quick-edit permission flags could overstate derived-field, deadline, or Claim
  commands
- active/deleted Workspace state was not included in the projection predicate
- Project filter preauthorization did not use the exact My Tasks visibility rule
- counts used thirteen separate count queries instead of two set-based queries
- Session Workspace discovery retained suspended memberships, so an
  authorization-state refresh could reselect a revoked Workspace
- The durable realtime validator required RFC UUID version/variant bits even
  though the backend contract and deterministic Tenant IDs use canonical,
  non-empty .NET GUIDs
- Project list DTO authorization checks were run concurrently over the same
  scoped EF Core `DbContext`

### Unverified until hosted gates complete

- The real-backend Compose scenario cannot start locally because the required
  `SYNCFUSION_LICENSE` Docker secret is not present. It failed before application
  build/start or any browser test. A local equivalent using the published
  ASP.NET Core application, built Angular, PostgreSQL 18.4, cookie auth, CSRF,
  and real SignalR passed all four real-backend tests; the canonical Compose
  scenario is still required on the protected hosted runner.
- Final-head CI, Code Quality, Real Backend Browser Smoke, and review-thread state
  are recorded after the draft PR is pushed.

### Out of scope and unchanged

- PR05 Kanban
- Prompt 3
- Gantt
- notification finalization
- Workspace-local timezone materialization
- Project/browser timezone inference

## API and authorization contract

- List: `GET /api/me/tasks`
- Counts: `GET /api/me/tasks/counts`
- Views: `assigned`, `participating`, `reviews`, `created`, `watching`,
  `teamQueue`, `completed`
- Scopes: default `currentWorkspace`; explicit `allWorkspaces`
- A sole active Workspace may be selected server-side. Multiple active
  Workspaces require an explicit `workspaceId`.
- Resolution order is authentication/query validation, active Workspace scope,
  Project visibility, relationship, filters, and paging.
- Project visibility covers Project owner/member/group and active Workspace
  Owner/Admin/Adviser without bypassing active membership.
- Cross-Tenant Project IDs are safe 404; unavailable explicit Workspace IDs are
  safe 403; ambiguous current scope is safe 400.
- Model-binding validation uses safe ASP.NET Core ValidationProblemDetails.
  Application failures use a request-ID-bearing, redacted error envelope.
- Page metadata uses normalized page `>= 1` and page size `1..100`.
- Stable order is blocked, canonical priority severity, UTC deadline, planned
  end, updated timestamp, and Task ID.

## Relationships, urgency, and DTO

- Assigned uses `PrimaryAssigneeUserId`.
- Participating uses `WorkItemCollaborator`.
- Reviews uses `ReviewerUserId`.
- Created uses `CreatedByUserId`.
- Watching uses
  `IsManualWatch || (!IsExplicitOptOut && AutomaticSources != None)`.
- Team Queue is unassigned, targets a current group, and is Backlog/Todo.
- Completed is Done/completed plus any canonical current-user relationship.
- The projection remains rooted at `task_items`; it never uses
  `TaskAssignment` as its source and cannot duplicate rows within a view.
- UTC deadlines take precedence over date-only planned end. The groups are
  mutually exclusive `Overdue`, `Today`, `Next7Days`, `Later`, and
  `NoDeadline`. No Workspace/browser/Project timezone was introduced.
- The canonical projection includes Task/Tenant/Workspace/Project identity,
  workflow, priority, blocked/planning/deadline/progress fields, assignee/group/
  reviewer, labels/checklist, relationships, time group, version, permissions,
  and warnings.
- quick-edit permissions are computed in the backend. Unsupported deadline edit
  and uncertain permissions fail closed. Claim additionally requires current
  Project membership, matching the command service.
- Storage keys, paths, grant tokens/hashes, other users' private Watch intent,
  and authorization internals are not projected.

## PostgreSQL and query evidence

- PostgreSQL: `18.4` (`postgres:18-alpine`)
- Latest migration:
  `20260729010000_AddMyTasksEffectiveWatchIndex`
- Clean apply: passed from an empty ephemeral PostgreSQL database
- Upgrade: passed from `20260719071017_MyTasksProjectionIndexes` to latest
- Pending migrations: none
- Pending model changes: none
- Forward effective-Watch index:
  `IX_work_item_watch_states_effective_watch`
  on `(TenantId, UserId, TaskItemId)` with the canonical partial predicate
- List query count: 4 total (count, paged projection, one label batch, available
  Workspace metadata); no row-level relationship query and no legacy assignment query
- Counts query count: 3 total (all seven view counts in one `UNION ALL`, all five
  urgency counts in one `UNION ALL`, and available Workspace metadata)
- Captured SQL asserts the label batch, collaborator predicate, absence of
  `task_assignments`, and set-based counts.
- `pg_indexes` confirmed the primary-assignee, reviewer, creator, collaborator,
  tenant/Workspace sort, and effective-Watch index definitions. The small
  acceptance fixture was not used to justify hints or artificial indexes.

## Local verification

All counts below exclude the two intentionally obsolete legacy-static Playwright
skips, which are not PR04 acceptance tests.

- `Scope=TaskV1PR04` run 1: 7 passed, 0 failed, 0 skipped
- `Scope=TaskV1PR04` run 2: 7 passed, 0 failed, 0 skipped
- Post-hosted-fix diagnostic `Scope=TaskV1PR04`: 8 passed, 0 failed, 0 skipped
- `Scope=TaskV1PR03C`: 29 passed, 0 failed, 0 skipped
- `Scope=TaskV1Prompt2C`: 35 passed, 0 failed, 0 skipped
- `Scope=TaskV1Prompt2D`: 19 passed, 0 failed, 0 skipped
- `Category=PostgreSQLIntegration`: 66 passed, 0 failed, 0 skipped
- Full backend: 407 passed, 0 failed, 0 skipped
- Angular unit: 242 passed, 0 failed
- Angular production build: passed; pre-existing non-blocking size warnings remain
- Frontend architecture check: passed
- Storybook static build: passed; pre-existing size warnings remain
- Mock Angular Playwright: 52 passed, 0 failed; 2 obsolete legacy-static tests skipped
- Real-backend Compose: environment-blocked before tests because
  `SYNCFUSION_LICENSE` is absent locally
- Local published real-backend diagnostic after hosted fixes: 4 passed,
  0 failed, 0 skipped (mandatory MVP0, Hub degraded, PR04, and PR03C)

## Realtime, concurrency, and protected changes

- `Projects.TaskChanged.v1`, `Projects.ProjectChanged.v1`, and
  `Security.AuthorizationStateChanged.v1` coalesce to HTTP refresh.
- Authorization-state invalidation cancels the active request and clears rows,
  counts, total count, message, and error before refetch.
- HTTP remains the source of truth and manual refresh remains available when the
  Hub is degraded.
- The shared heavy group remains `aipsite-self-hosted-frontend-heavy` with
  `cancel-in-progress: false` for Qodana, Code Quality frontend, CI frontend
  (Angular/Storybook/Playwright), and the manual real-backend Playwright job.
- No timeout increase, unit retry, or frontend parallelism change was made.
- User-owned `qodana.yaml`, `.aip-spec-source/`, and `.tools/` remain untouched
  and must not be staged.

## Hosted gate and verdict

- Draft PR: `#254`, open and unmerged
- Prior candidate CI: run `30419612749`, success
- Prior candidate Code Quality: run `30419612722`, success
- Prior candidate Real Backend Browser Smoke: run `30423352968`, failed
  because Project list authorization used concurrent operations on one scoped
  `DbContext` and the valid deterministic Tenant GUID was rejected before the
  authorization-state event reached the facade
- The two hosted failures are covered by deterministic unit/PostgreSQL tests
  and the four-test local real-backend diagnostic; final-candidate hosted gates
  remain pending
- Unresolved review threads: 0 at the prior candidate head
- Current verdict: `PR04 acceptance: Incomplete`
- Current merge verdict: `PR04 Merge: No-Go`
- PR05: `No-Go`
- Prompt 3: `No-Go`
