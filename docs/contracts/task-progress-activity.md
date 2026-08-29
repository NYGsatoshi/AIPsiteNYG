# Task Progress and Activity contract

Issue: #369

## Authorities

- The configured `WorkflowStage` on `TaskItem` is the sole authority for the Task's **current phase**.
- `TaskExecutionRun.Status` is the sole durable authority for an execution run's **major execution state**. UI code must not infer execution state from Workflow Stage names, Activity text, event volume, elapsed time, checklist completion, or percentage fields.
- `ActivityLog` is durable Task-linked **history**. It is not an authority for current phase or current execution state.

## Major execution states

The stable user-facing state vocabulary is:

- `Running`
- `Waiting`
- `NeedsInput`
- `Failed`
- `Completed`

`TaskExecutionRunStatus` may retain lower-level runtime lifecycle values for compatibility. The API projects them to one of the stable major states. In particular, the existing fail-closed `RuntimeUnavailable` outcome projects to `Failed`; the existing accepted `Prepared` outcome projects to `Running`.

## Phase history

Every accepted change of `TaskItem.WorkflowStageId` must append one Task-linked Activity entry in the same EF Core save boundary as the Task transition. The current phase is still read from `TaskItem.WorkflowStageId`; Activity rows are history only.

Phase-change history must be visually distinguishable from ordinary Activity events. Existing Activity types remain backward compatible; the production phase writer uses the status-update class and a canonical `Workflow phase changed...` message rather than synthesizing historical changes from current data.

## Progress UI

- Progress renders the current configured Workflow Stage without opening or reading the Activity surface.
- Major execution state is rendered from the latest authorized `TaskExecutionRun` projection when a run exists.
- Activity remains a secondary, independently loaded surface.
- No 0-100 completion percentage may be derived for Progress unless a separate authoritative product contract is introduced later.
- State/phase updates must be exposed through semantic headings and a polite atomic live region so keyboard and screen-reader users can perceive authoritative changes.

## Security and failure behavior

- Activity authorship is server-owned. A Workflow Stage mutation that cannot identify an authenticated author must not silently create unauthored history.
- Execution-scope/run reads remain authorization-gated and fail closed. Realtime events are invalidation hints only; the next authorized HTTP projection remains authoritative.
