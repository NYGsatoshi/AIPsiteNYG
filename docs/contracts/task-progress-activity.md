# Task Progress and Activity contract

Issues: #369, #370

## Authorities

- The configured `WorkflowStage` on `TaskItem` is the sole authority for the Task's **current phase**.
- `TaskExecutionRun.Status` is the sole durable authority for an execution run's **major execution state**. UI code must not infer execution state from Workflow Stage names, Activity text, event volume, elapsed time, checklist completion, or percentage fields.
- `ActivityLog` is durable Task-linked **history**. It is not an authority for current phase or current execution state.

## Major execution states

The stable user-facing state vocabulary is:

- `Accepted`
- `Queued`
- `Running`
- `Succeeded`
- `Failed`
- `Stopped`
- `Redirected`

`TaskExecutionRunStatus` is the canonical lifecycle and the API projects it
directly to the corresponding major state. Normal execution progresses as
`Accepted` -> `Queued` -> `Running` -> (`Succeeded` | `Failed`). An authorized
user intervention may instead move any non-terminal Run to either `Stopped` or
`Redirected`. Historical provider-none rows are migrated safely; the current
contract has no `RuntimeUnavailable`, `Prepared`, `Waiting`, or `NeedsInput`
state.

A terminal Run is immutable and cannot be revived. `Stopped` and `Redirected`
are intentionally different terminal facts:

- `Stopped` means the current Run was deliberately ended and no successor Run is created by that command.
- `Redirected` means the immutable current Run was ended for direction correction and a new successor Run is created from the latest saved Task state.

The V1 first-party Project Files runtime has no durable intra-run checkpoint.
Therefore a direction correction exposes the truthful resume point
`NewRunFromLatestTaskState`: the successor starts as a new Run with the latest
saved Research Plan revision and Active Source Scope snapshot. UI text must not
claim that work resumes inside the prior Run.

## Intervention authorization and persistence

- Stop and direction correction are server-authorized commands. Browser visibility or disabled state is not an authorization boundary.
- The actor must retain Project management authorization for the Task at command time; unauthorized and cross-Task Run identifiers fail closed without disclosing Run existence.
- Every accepted intervention records a Task-linked Activity fact and an Audit entry in the same Task command persistence boundary as the authoritative Run/Task mutation.
- Direction correction never edits the old Run snapshot. It creates a successor immutable snapshot from current server-owned state.
- Runtime materialization must not hold the Run row lock across slow source reads. Before result/provenance commit it must re-lock the Run and confirm that the Run is still `Running`; if Stop/Redirect won, the old Run cannot publish a result.

## Phase history

Every accepted change of `TaskItem.WorkflowStageId` must append one Task-linked Activity entry in the same EF Core save boundary as the Task transition. The current phase is still read from `TaskItem.WorkflowStageId`; Activity rows are history only.

Phase-change history must be visually distinguishable from ordinary Activity events. Existing Activity types remain backward compatible; the production phase writer uses the status-update class and a canonical `Workflow phase changed...` message rather than synthesizing historical changes from current data.

## Progress UI

- Progress renders the current configured Workflow Stage without opening or reading the Activity surface.
- Major execution state is rendered from the latest authorized `TaskExecutionRun` projection when a run exists.
- Activity remains a secondary, independently loaded surface.
- No 0-100 completion percentage may be derived for Progress unless a separate authoritative product contract is introduced later.
- State/phase updates must be exposed through semantic headings and a polite atomic live region so keyboard and screen-reader users can perceive authoritative changes.
- `Correct direction` and destructive `Stop Task` are separate controls. The correction surface identifies the saved Task surfaces that can change the successor snapshot and explicitly states the resume point. Stop requires a deliberate confirmation step.
- Unavailable intervention controls are hidden or disabled according to authorization and terminal Run state; where a control remains visible, the UI explains why it is unavailable.

## Security and failure behavior

- Activity authorship is server-owned. A Workflow Stage mutation that cannot identify an authenticated author must not silently create unauthored history.
- Execution-scope/run reads remain authorization-gated and fail closed. Realtime events are invalidation hints only; the next authorized HTTP projection remains authoritative.
