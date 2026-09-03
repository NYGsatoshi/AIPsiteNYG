# P2 Audit loading, empty, error, and recovery states (Issue #389)

Status: completion candidate; exact-head CI required before closing.

## Scope

The maintained Audit surfaces now distinguish the user-visible states required
by Issue #389 without moving authorization decisions into the browser.

### Event log

`/app/admin/audit` already provides:

- a structural initial-load skeleton while the filter/scope context remains
  visible;
- separate filtered-empty and true-empty states;
- applied filter chips plus one-action `Clear all` recovery from filtered-empty;
- fixed local error copy and a guarded manual Retry for retryable list errors;
- a single polite, atomic status region for loading/retry, result count, empty,
  permission-denied, and error transitions;
- server-authorized filtering and authoritative `totalCount`; browser filtering
  never manufactures Audit results or counts.

The event grid's current page control is presentation-only over the already
returned authorized page. It does not issue an asynchronous page request, so
there is no network pagination state to label as `loading`. If server-page
navigation is later bound to the grid, it must use the same operation/status
pattern instead of reusing the initial-load skeleton.

### Audit Package Export

`/app/admin/audit/package-export` already owns the durable `Queued /
Processing / Completed / Failed` job projection from Issue #381. This #389
slice adds:

- one polite, atomic accessible status region that announces scope loading,
  queueing, retry queueing, refresh, job progress/completion/failure, and safe
  terminal errors;
- a separate manual status-refresh busy state so a refresh is not confused with
  export creation/retry;
- single-flight status refresh to avoid overlapping polling/manual refreshes;
- retained last-known job state when status refresh fails;
- an explicit stale-state notice with the last successful status-update time;
- a visible `Refresh status` recovery action while stale data remains on screen;
- stale-state clearing and timestamp replacement after the next successful job
  status response.

## Security boundary

All Audit list/filter/detail behavior remains server-authorized. Retry and
filter changes repeat the existing cookie-authenticated Audit API requests and
do not grant access, infer hidden rows, or expose unauthorized counts.

Audit Package Export continues to rely on the separate `audit.export`
authorization and the server-side source re-authorization added by Issue #381.
The stale UI retains only the last already-authorized job projection. It never
renders the failed HTTP response body, exception text, stack traces, storage
paths, or other internal diagnostics. Permission/authorization failures are
mapped to fixed local copy.

## Test coverage added by this slice

`audit-package-export-page.component.spec.ts` now covers:

- accessible queue and completion status;
- safe failed-job status and Retry action;
- status-refresh failure preserving the last-known Processing state;
- explicit stale-state presentation and last-successful-update timestamp;
- suppression of a simulated server stack trace/exception body;
- stale-state clearing after a successful refresh.

The existing Audit UI tests continue to own the Event Log skeleton,
filtered-empty recovery, safe Retry, focus restoration, and protected-state
invalidation cases.

## Acceptance mapping

- Initial loading skeleton: covered by the maintained Event Log implementation.
- Filtered empty vs true empty: covered by the maintained Event Log implementation.
- Clear filters from filtered empty: covered by the maintained Event Log implementation.
- Retryable error recovery: covered by Event Log Retry and Export Retry/Refresh.
- Search/async operation distinction: filter/search loading remains separate
  from Export queue/process/refresh state; current grid paging is synchronous
  presentation and therefore has no fabricated async state.
- Stale data: Export job state remains visible with last successful update time
  and explicit refresh-failed copy.
- Accessible status changes: Event Log and Export each expose polite atomic
  status regions for their state transitions.
- Sensitive/internal error details: fixed local messages only; server response
  bodies and stack traces are not rendered.

## Promotion gate

Before closing #389, the PR head must pass the repository's normal frontend
static analysis/unit/build checks and the relevant UI/CI gates. No backend API,
database migration, or authorization-policy change is introduced by this slice.