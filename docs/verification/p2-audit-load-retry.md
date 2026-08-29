# P2 Audit initial load and manual retry (Issue #389)

Status: bounded implementation candidate; intentionally non-closing.

## Scope

The maintained `/app/admin/audit` route remains a read-only client of the
server-authorized Audit grid and detail projection. This slice adds only:

- A structural initial-load skeleton at desktop and narrow widths. The
  structural content is marked busy while the existing fixed local status
  region remains outside it for loading and retry announcements.
- A manual, single-flight retry after an absent/0 status, 408, 429, or 5xx
  list failure. It repeats the same GET and never automatically retries or
  backs off.
- Keyboard-safe retry behavior. The control remains available while retrying;
  if its terminal result removes it, focus returns to the Audit page heading.
  A 401 or 403 is shown only as permission-denied and never offers retry.

## Security boundary

Retry does not authorize access and does not change the route, query, tenant,
or selected detail. Every retry is the existing cookie-authenticated
`GET /api/admin/audit-grid`, whose current tenant/platform scope, `audit.view`
check, classifier, and redaction remain server-authoritative. The UI uses
fixed local error/status text and never renders response bodies, request IDs,
raw metadata, actor IDs, target IDs, or server totals.

## Local verification

Candidate evidence on 2026-08-27 JST:

- Application and spec TypeScript checks passed.
- Focused `admin-ui.spec.ts`: 30 passing tests, including initial structural
  loading, fixed status/error text, transient single-flight retry, terminal
  focus restoration, and no retry after a lost audit permission.
- Production Angular build passed. The new Audit component-style budget
  warning is absent; only existing initial-bundle and unrelated component
  warnings remain.
- Focused static Angular Playwright: 2 passed (desktop and mobile). It covers
  the pending skeleton, polite status text, keyboard retry/duplicate guard,
  safe error redaction, 320px overflow, and axe.
- Focused backend audit authorization/isolation regression: 5 passing tests
  covering list/detail denial, cross-tenant detail concealment, and the
  controller 403 boundary. This uses EF InMemory; no hosted HTTP or PostgreSQL
  run was available because `POSTGRES_TEST_CONNECTION_STRING` is unset.

This frontend-only candidate makes no API, migration, or authorization change.
Exact-head CI and real-backend P0 remain required before promotion.

## Deliberate exclusions

Issue #389 remains open. The current route has no approved contract for
server-backed filters or clear-filter behavior, filtered-empty semantics,
search, paging controls, export-job state/retry, stale-data retention or last
refresh timestamps, realtime refresh, saved views, Audit Review save, or
additional/raw audit fields. The browser must not fabricate any of those
semantics from its bounded loaded rows.
