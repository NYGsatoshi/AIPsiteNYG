# Issue #334 — Workspace Needs attention lifecycle

Status: Accepted

## Decision

Use **Option B: derive Workspace `Needs attention` exclusively from authoritative target-domain workflow state and project a normalized server-owned summary**.

`Notification.IsRead` is viewing state and is not a completion signal. Reading a Bell item must never remove an actionable Workspace item.

## V1 actionable sources

The current domain has two durable workflows that can safely drive this projection:

1. **Review required**
   - source: `TaskItem.ReviewStatus == Submitted` with no `ReviewResolvedAt`;
   - recipient: the current `ReviewerUserId`;
   - processed when the review is resolved or otherwise leaves the submitted workflow.
2. **Research failed**
   - source: the latest `TaskExecutionRun` for a Task is `Failed`;
   - recipient: the run requester or current primary assignee;
   - processed when a later execution run exists, or the Task becomes Completed/Cancelled.

A permission/access request is intentionally not fabricated in V1. The repository does not currently have an authoritative pending permission-request aggregate with a durable resolution lifecycle. When such a workflow exists, it can add another normalized `WorkspaceNeedsAttentionKind` without changing the read/processed semantics established here.

## Authorization and data minimization

The Workspace projection returns only:

- stable attention id;
- normalized kind;
- canonical internal Task route;
- occurrence timestamp.

It does **not** return Task title, notification body, comment text, Research failure code, source content, participant identity, or other protected detail.

Every item is constrained by the canonical `VisibleProjectsFor(userId)` read scope. Review items additionally require the current user to be the reviewer. Failed Research items additionally require the current user to be the requester or primary assignee. Revoking Project/Workspace visibility therefore removes the item from the next projection.

The Angular mapper accepts only the known normalized kinds and canonical `/projects/{projectId}/tasks/{taskId}` UUID route shape. Arbitrary or external routes fail closed and are not rendered.

## UI behavior

The Workspace body contains only the `Needs attention` section, not an Activity history feed. Ordinary Activity remains outside this surface.

The section shows the authoritative unresolved count and direct Task links. A zero state is explicit. Resolved domain items disappear automatically on refresh; no separate browser-owned processed flag is introduced.

## Non-goals

- Do not reinterpret `Notification.IsRead` as processed.
- Do not introduce a duplicate acknowledgement table for V1.
- Do not surface general Activity history in the Workspace body.
- Do not expose target titles/bodies merely to make the attention row more descriptive.
