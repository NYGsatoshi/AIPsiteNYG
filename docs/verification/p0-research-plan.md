# P0 Research Plan (`#364`)

## Canonical contract

A Research Plan is a Task-owned, server-authorized aggregate. Its content is
represented by append-only immutable revisions; editing, adding, deleting, or
reordering steps creates one complete next revision instead of changing prior
steps. The aggregate stores only the current-revision pointer and an optimistic
version token.

The v1 routes are:

- `GET /api/tasks/{taskItemId}/research-plan`
- `PUT /api/tasks/{taskItemId}/research-plan`

`PUT` accepts a server-version precondition and a bounded complete ordered step
list. A step has a title, optional objective, optional scope summary, and the
bounded `Planned`, `Ready`, `Blocked`, or `Deferred` planning status. It never
accepts tenant, workspace, project, task, revision, user, source, provider, or
storage identifiers from the browser.

The response exposes only the current saved revision and its authorized step
content. A missing plan is a normal authorized Task response with a null current
revision; a missing, cross-tenant, deleted, or unauthorized Task is the same
metadata-safe not-found response after the parent Task boundary.

## Authorization and immutability

Current Project readers may read the current plan. Only the existing
status/visibility-sensitive `CanManageProject` boundary may create a plan or
replace it with its next revision. Frontend control visibility and Task-assignee
state are not authority. Every persisted record carries the Tenant, Workspace,
Project, and Task ownership copied from the authoritative Task.

The persistence boundary rejects direct modification or deletion of revisions
and steps. It also rejects plan deletion. A stale aggregate version returns a
refetchable conflict and creates no partial revision, audit record, or realtime
invalidation.

The current-revision pointer has a composite, commit-deferred PostgreSQL
foreign key to `(ResearchPlanRevision.Id, ResearchPlanRevision.ResearchPlanId)`.
This makes it impossible to redirect a plan to a revision owned by another
plan, even through a raw persistence caller, while permitting the legitimate
plan-and-first-revision cycle to be committed atomically.

## Execution relationship

The Task-detail Research Plan summary is the current persisted plan used for
execution-start review. Snapshot schema version 2 captures its exact revision
identifier and positive revision number inside the idempotent execution-run
acceptance transaction; this remains a single extension of the canonical Task
execution snapshot rather than a second snapshot mechanism. A composite
foreign key binds its revision identifier, revision number, and ownership scope
to one revision row. It prevents a raw persistence caller from referencing a
revision from another Tenant, Workspace, Project, or Task, or claiming a
different positive revision number for a valid revision. Existing
schema-version-1 runs remain valid with null plan provenance.
Research Plans do not define provider behavior, source materialization,
cancellation, Diff/Impact, or Revert behavior.

## Verification

- `ResearchPlanServiceTests`: immutable revision creation, explicit reorder,
  stale-version rejection, authorization redaction, and direct-EF immutability.
- `task-research-plan.component.spec.ts`: authorized display, non-drag
  keyboard/touch move controls, atomic save body, and conflict reload.
- `ResearchPlanPostgreSqlTests`: real PostgreSQL composite-FK regressions
  reject both a current-revision pointer from another plan and an execution
  run snapshot from another ownership scope; the latter also rejects an
  incomplete or mismatched revision-id/number pair. The accepted-run snapshot
  guard separately rejects raw-SQL changes to either plan field, including a
  complete valid same-Task revision swap. They require
  `POSTGRES_TEST_CONNECTION_STRING`.
- `dotnet ef migrations has-pending-model-changes`: no pending model changes
  after `AddResearchPlanRevisions`,
  `AddResearchPlanCurrentRevisionConstraint`, and
  `AddTaskExecutionResearchPlanSnapshot`.
