# Task v1 PR02 command boundary

`ITaskCommandService` is the authoritative HTTP command boundary for Task
ordinary-detail updates, workflow transitions, blocked state, assignment relationships, review, and
Team Queue Claim. `PATCH /api/tasks/{taskId}` now uses the detail-update command
with a required `expectedVersion`; it does not carry legacy status changes.
The legacy project/task assignment and dependency routes
remain compatibility surfaces; new Task command routes use a required
`expectedVersion` and return the canonical task error envelope.

The command service rechecks Project visibility and relationship/capability
authorization on every operation.  Project managers own assignment, deletion,
and review override authority; creators and primary assignees can make ordinary
Task updates; a reviewer can resolve review without receiving broad Task-body
authority.  Reviewers and primary assignees must differ.

Workflow stages map to fixed categories.  Entering active work requires an
assignee, Done records completion/progress, cancellation needs a reason, and
Blocked remains independent from stage.  A version mismatch returns
`TASK_STALE_VERSION`.  Non-Finish-to-Start dependency authoring is rejected as
`TASK_DEPENDENCY_TYPE_DEFERRED` while existing rows remain readable.

Terminal Tasks may only reopen directly to Backlog or Todo.  Reopening clears
terminal metadata and resets progress to zero; direct Done/Cancelled-to-active
transitions are rejected with `TASK_TRANSITION_GUARD_FAILED`.  Task command
saves preserve a PostgreSQL unique-constraint name, so only the TaskAssignment
identity index maps to `TASK_ALREADY_ASSIGNED`; other unique conflicts map to
the general `TASK_CONFLICT` code.

The PR02 migration adds durable review-outcome metadata on `task_items` and
defaults existing rows to `None`; it adds the command query index for project,
group, assignee, and workflow stage.  Task changes are audited and enqueue the
existing transactional invalidation before the unit of work commits.

Task V1 Watch state persists manual intent separately from automatic Creator,
PrimaryAssignee, Collaborator, and Reviewer sources. Its canonical value is
`IsManualWatch || (!IsExplicitOptOut && AutomaticSources != None)`. Relationship
commands reconcile against their effective in-request relationship set, and
Task/File removal soft-deletes only the association Attachment, never its
FileObject.

## Task/File open and download-grant boundary

Task detail file state is display-only. Opening a Task/File association and
issuing or using its canonical `FileDownloadGrant` each re-check the current
actor, tenant, active workspace access, Task owner scope, active association,
and FileObject tenant/workspace/project scope. Task associations require an
active, non-deleted FileObject and a `Clean` attachment scan result. A grant is
short-lived, actor/tenant/scope-bound, and uses a persisted token hash only.
After a membership, association, scan, or file-state change, the request is
denied before any storage read. Audit metadata records only safe identifiers,
operation, decision, and bounded reason codes; it excludes grant tokens,
token hashes, storage keys, paths, and policy-stamp values.
