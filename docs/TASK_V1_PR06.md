# TASK-V1-PR06: Canonical Project Gantt Adapter

TASK-V1-PR06 upgrades the existing Project Detail Schedule tab from its
read-only compatibility projection to an authorized, versioned projection and
manual-edit surface over canonical WorkItems.

Status: implemented in the working tree and partially verified locally. The
exact final-HEAD suites, hosted Gates, licensed real-backend browser scenario,
Qodana triage, and review are still pending, so this document does not claim
acceptance. Detailed evidence belongs in
[`docs/verification/task-v1-pr06-gantt.md`](verification/task-v1-pr06-gantt.md).

## Identity and authority

- Branch: `task/v1-pr06-gantt-adapter`
- Main start SHA: `0a8a1f58b8365e9ffc54daafceca99864ae5f63f`
- Code-bearing HEAD: `ab9a260dd4517d34a2500d5e76369ba241b504ee`
- Draft PR: `#259`
- Final documentation HEAD: Pending
- Canonical specification revision:
  `20aa5a2e015ae8fb68e5ba2b257a416dfcad5c3f`
- Primary prompt:
  `docs/specs/aip-core-v4/12-implementation-kickoff/task-v1-pr06-gantt-adapter-prompt.md`
- Core authority:
  `01-core/12-task-work-management.md`,
  `01-core/11-task-work-planning-scope.md`,
  `01-core/04-permission-data-access-security.md`,
  `01-core/03-efcore-postgresql-design.md`, and
  `01-core/api-error-contract.md`
- Realtime/persistence authority:
  `01-core/realtime-event-catalog.md`,
  `01-core/signalr-group-authorization-matrix.md`,
  `01-core/outbox-delivery-contract.md`, and
  `01-core/reconnect-catchup-sequence.md`
- API mapping:
  `06-implementation-mapping/task-work-planning-api-realtime-contract.md`

The specification repository is read-only implementation input and is not
copied or staged into this repository.

## Existing seam and source of truth

PR06 retains:

- `GET /api/projects/{projectId}/gantt`;
- the existing Project Detail Schedule tab;
- canonical `TaskItem`/WorkItem schedule, progress, hierarchy, workflow,
  Blocked, assignment, and version state; and
- canonical `TaskDependency` persistence and PR02 dependency routes.

It does not introduce a Gantt Task table, dependency table, authoritative
date/progress copy, vendor model, parallel route, or parallel client store.

The existing separate `Milestone` persistence and routes may remain
compatibility surfaces. The AIPsite adapter still presents canonical Milestone
semantics: mandatory date, zero duration, progress 0 or 100, stable identity,
and current authorization. Compatibility records must not be copied into
vendor-owned rows or emitted twice as one logical item.

## Target snapshot

The existing route is upgraded in place to return a bounded, deterministic,
vendor-neutral projection:

```text
projectId, projectTitle
projectVersion, workflowVersion, calendarVersion where supported
workspaceTimeZone, workingCalendarSummary
scheduledItems[], unscheduledItems[], milestones[]
dependencies[], warnings[], permissions

item:
  taskId, kind, parentTaskId, milestoneId, title
  plannedStartDate, plannedEndDate, milestoneDate
  progressPercent, progressIsDerived
  workflowStageId, workflowStageName, stageCategory
  priority, isBlocked, primaryAssignee
  version/etag, scheduleEditPermissions, warnings[]

dependency:
  dependencyId, predecessorTaskId, successorTaskId
  type, editable, version where required, warnings[]
```

Projection rules:

- use each authorized canonical WorkItem once;
- derive parent planned bounds and progress from direct canonical
  `WorkItemKind.Task` children only and deny direct parent edits;
- show Milestones as required-date, zero-duration items;
- place undated Tasks in `unscheduledItems` without inferred dates;
- exclude or safely reject cross-Project edges;
- show legacy non-FS edges as read-only warning inventory; and
- use bounded, set-based PostgreSQL queries with deterministic ordering and
  cancellation propagation.

Because the canonical sources do not provide a numeric graph limit, the
working-tree implementation uses an explicitly provisional maximum of 500
items counted consistently as canonical Task-kind WorkItems plus canonical
Milestones, and 2,000 dependencies. The same count gate applies to snapshot,
schedule, progress, and dependency operations. Overflow returns a typed HTTP
400 error (`GANTT_ITEM_LIMIT_EXCEEDED` or
`GANTT_DEPENDENCY_LIMIT_EXCEEDED`) before returning a partial graph. It never
silently truncates. The projection rechecks the combined item count after its
bounded reads to close a count-then-read race. Owner approval of those values
and that overflow contract remains `DECISION REQUIRED`.

## Manual commands

| Operation | Route | Required contract |
| --- | --- | --- |
| Schedule | `PATCH /api/tasks/{taskId}/schedule` | Required-but-nullable `plannedStartDate` and `plannedEndDate` keys, `milestoneDate` where applicable, and required `expectedVersion`; owns schedule fields only. |
| Progress | `PATCH /api/tasks/{taskId}/progress` | Required integer 0-100 and required version; omission is rejected and only leaf Task progress is directly editable. |
| Dependency add | `POST /api/tasks/{taskId}/dependencies` | Reuse PR02 authority; required predecessor and canonical string `dependencyType: "FinishToStart"`; same Project only. |
| Dependency remove | `DELETE /api/tasks/{taskId}/dependencies/{dependencyId}` | Reuse PR02 authority; remove only the edge and never move dates. |

Schedule rejects end-before-start and direct parent override. Clearing both
Task dates is valid and makes the Task unscheduled. A Milestone date is required
and its duration remains zero. The maintained compatibility Milestone update
contract also requires a positive `expectedVersion`, preserves the date
invariant, and maps a stale aggregate to the same safe HTTP 409/refetch
behavior.

Progress remains consistent with Workflow Stage, Review, completion, Done=100,
parent derivation, and Milestone 0/100 rules. Dependency writes reject self,
duplicate, cycle, cross-Project, non-FS, lag/lead, deleted, unknown-neighbor,
revoked-membership, and unauthorized requests without disclosing hidden data.
Unknown dependency request members are rejected, so lag/lead cannot be smuggled
into an otherwise valid Finish-to-Start command. Bounded dependency reads
include only active canonical Task neighbors. Visible rejected dependency
attempts produce metadata-safe audit records without recording hidden-neighbor
details. Dependency and Task-lifecycle transactions advance the shared Project
revision so a concurrent Task deletion cannot race a dependency add into a
committed invalid edge.

Canonical terminal-parent invariants remain shared with Task Detail and Kanban:

- a Done/Cancelled parent rejects new subtasks until explicitly reopened;
- a terminal child cannot reopen while its parent remains terminal;
- completing a parent as Done requires every direct canonical Task child to be
  terminal and canonical derived progress to equal 100; and
- an all-cancelled child set derives progress 0 and cannot complete the parent
  as Done.

Milestones and any non-Task compatibility rows do not participate in parent
Task derivation. Review override completion uses the same parent completion
guard, and restoring or deleting a child beneath a terminal parent is rejected
until the parent is reopened.

Stale versions return HTTP 409 and trigger authoritative refetch. After that
refetch, the safe preserved edit intent is explicit: the actor can Retry it
against the latest version or Discard it. Dependency violations and
active-work missing-end conditions are non-blocking warnings; they never
cascade dates.

## Authorization and safe errors

Snapshot visibility follows current Tenant, Workspace membership, and Project
visibility. Viewers receive read-only data. Schedule edits require
`project.gantt.edit` or the canonical equivalent; progress and dependency
capabilities are also backend-projected and rechecked on every command.
Feature flags and hidden controls are never authorization.

Archived/deleted Projects, revoked membership, cross-Tenant IDs, cross-Project
IDs, and unknown neighbors follow the established safe rejection policy. PR06
separates 401, 403, safe 404, 409, and validation failures using the repository
error envelope:

```text
requestId
error.code, error.message, error.target, error.details
error.redactionApplied
```

Responses exclude stack traces, SQL, Tenant internals, hidden titles or
neighbors, and raw exceptions.

Request cancellation continues to propagate as cancellation rather than being
rewritten as a server failure. An unexpected snapshot exception returns a safe
HTTP 500 envelope with `GANTT_REQUEST_FAILED`; unexpected command failures use
their Gantt/dependency command code.

## Date, calendar, warnings, and atomicity

Planning dates use `DateOnly` day precision and the canonical Workspace timezone
resolver. The browser timezone does not reinterpret stored Project dates.
`DeadlineAt` remains a separate UTC timestamp and is never changed implicitly
by a Gantt edit.

The current system has Workspace timezone persistence/fallback but no complete
working-day or holiday service. PR06 returns only an available canonical
summary/version and does not fabricate holidays, weekends, or a school
timetable. This limitation remains explicit in final verification.

Warnings are vendor-neutral and separate from blocking API errors:

```text
code, message, severity, targetType, targetId, field, blocking=false
```

Required codes are `DEPENDENCY_VIOLATION`,
`MISSING_ACTIVE_PLANNED_END`, `PARENT_DERIVED`,
`LEGACY_DEPENDENCY_TYPE`, `MILESTONE_DATE_REQUIRED`, and `UNSCHEDULED`.
A warning alone does not reject an otherwise valid command. Dependency-date
warnings use derived parent dates where an edge references a parent Task.

Every successful schedule, progress, dependency-add, and dependency-remove
mutation records a metadata-safe audit entry and inserts Task/Project
invalidations into the transactional Outbox. Mutation, audit, and Outbox commit
in one transaction; a failed save leaves no partial persistence. HTTP remains
authoritative and SignalR carries invalidation/version hints only.

Migration `20260730120626_AddCanonicalGanttVersions` adds only optimistic
concurrency tokens to Project and canonical Milestone aggregates. It performs
no Task progress or other data normalization. The additive Down path removes
only those two new columns and preserves existing Project, Milestone, Task, and
dependency rows.

## Angular adapter, rollout, and realtime

`AipGanttContract` is extended with vendor-neutral items, dependencies,
calendar, edit intents/results, warnings, permissions, busy/focus/feedback, and
adapter states. Syncfusion records, events, enums, selectors, DOM contracts, and
models do not enter feature code, and the Gantt vendor bundle remains lazy.

The existing Schedule tab uses `tasks.ganttV1` as a presentation rollout flag.
Disabled mode keeps the maintained read-only compatibility schedule/list on the
same route. The enabled workflow supplies:

- loading, ready, empty, permission-denied, error, conflict, rollback, and
  degraded states;
- pointer and accessible keyboard/form paths that emit the same edit intent;
- optimistic presentation, rollback, conflict refetch, safe intent retention,
  and logical focus restoration;
- visible hierarchy, warnings, Blocked, priority, and status without color-only
  meaning;
- focus-trapped forms where Escape/Cancel sends no command;
- a 320 px ordered schedule/Milestone/unscheduled mobile projection; and
- manual refresh and HTTP editing while SignalR is unavailable.

Realtime Task, Stage, Blocked, dependency, hierarchy, Milestone, workflow,
membership, and authorization events invalidate by version. Duplicate/stale
events are coalesced; an active edit is not silently overwritten. Reconnect
reauthorizes before refetch, and revocation clears protected state before a
stale response can restore it.

If the Project realtime subscription is denied during reconnect, the facade
synchronously clears both protected Kanban and Gantt projections, increments
authorization/load/request generations to invalidate every in-flight response,
and only then starts authoritative HTTP revalidation.

## Explicit non-goals

- PR07 Notifications, digest, or realtime finalization
- PR08 integrated cutover
- automatic scheduling or cascading date movement
- Critical Path, baseline comparison, or Resource Leveling
- automatic workload balancing
- cross-Project dependencies or Task movement
- SS, FF, or SF authoring; dependency lag or lead
- personal or recurring Tasks
- Calendar/Scheduler/school-timetable or attendance features
- multiple Boards, timesheet inference, or portfolio management
- changing PR04 My Tasks into a Gantt view
- changing package/license policy
- merging PR06

## DECISION REQUIRED

The canonical sources require a bounded snapshot but define neither its numeric
maximum nor overflow behavior. The owner must select the maximum
WorkItem/Milestone/dependency graph size and whether overflow returns a typed
error, explicit truncation metadata, or pagination.

The provisional implementation uses 500 items counted as canonical Task-kind
WorkItems plus canonical Milestones and 2,000 dependencies, applies that count
consistently to snapshot and every PR06 command path, rejects overflow with a
typed HTTP 400 response, and does not return a truncated snapshot. These values
and semantics are implementation safety limits, not a canonical owner
decision.

This is the only independent specification omission identified at
implementation start.

## Current status

- Implementation: Working-tree implementation complete; review and final Gate
  stabilization remain
- Restore: succeeded; all projects were up to date
- Release build at code-bearing HEAD: Passed with 0 warnings and 0 errors
- Backend focused PostgreSQL/HTTP/service/controller tests:
  `Scope=TaskV1PR06` 45/45 passed, 0 failed, 0 skipped
- PostgreSQL query evidence: seven commands for the bounded repository
  projection and exactly 24 commands for the authorized real HTTP snapshot;
  exact SQL is emitted in xUnit evidence, with no N+1/unbounded graph load
- PR05 regression: 25/25 passed, 0 failed, 0 skipped; PR04 regression:
  8/8 passed, 0 failed, 0 skipped
- Full backend at code-bearing HEAD: 485/485 passed, 0 failed, 0 skipped
- EF pending-model check: no pending model changes
- Frontend install/audit: `npm ci` succeeded; audit reported 18 known
  vulnerabilities (3 low, 7 moderate, 8 high, 0 critical)
- Angular full suite: 318/318 passed; production build succeeded
- Architecture: application check succeeded and architecture tests passed 4/4
- Syncfusion license policy: 4/4 passed
- Bundle analysis: succeeded; Gantt remained lazy at approximately 5.42 MB
  and the initial bundle was 950.01 kB with its existing budget warning
- Mocked Playwright: 63 passed, 0 failed, with 3 pre-existing explicitly
  expected skips; PR06 Schedule desktop/mobile subset 4/4 passed with no skips
- Real-backend browser: local run is not countable because
  `SYNCFUSION_LICENSE` is unavailable; exact-HEAD hosted execution is required
- Storybook: the exact local default command exhausted the available 2 GB Node
  heap and is not counted as passing; the same source succeeded with
  `NODE_OPTIONS=--max-old-space-size=4096`
- Package lock: final npm 11.17 regeneration and focused diff review are
  pending; no lockfile-scope claim is final yet
- Reviewer residual material findings: 0; hosted Gates, Qodana, exact final-HEAD
  evidence, and GitHub review-thread evidence remain Pending
- Draft PR: #259 open
- TASK-V1-PR06 acceptance: Incomplete
- PR06 Merge: No-Go; merge performed: No
- TASK-V1-PR07 and PR08: No-Go
