# Task v1 PR02 command boundary

`ITaskCommandService` is the authoritative HTTP command boundary for Task
workflow transitions, blocked state, assignment relationships, review, and
Team Queue Claim.  The legacy project/task assignment and dependency routes
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

The PR02 migration adds durable review-outcome metadata on `task_items` and
defaults existing rows to `None`; it adds the command query index for project,
group, assignee, and workflow stage.  Task changes are audited and enqueue the
existing transactional invalidation before the unit of work commits.
