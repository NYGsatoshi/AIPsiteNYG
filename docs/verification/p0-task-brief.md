# P0 structured Task Brief verification

Status: Issue #350 implementation candidate. Focused local backend, Angular,
production-build, EF model/provider-translation, mocked browser, and full
local suite gates are complete. Provider-backed round-trip, hosted, review,
merge, and CI evidence remain pending unless recorded below or in the final
PR.

## Change identity

- Branch: `fix/350-task-brief`.
- Starting `main` baseline: `03850d5`.
- The final PR head and hosted results must be recorded in the PR because this
  file cannot name the commit that first contains itself.

## Canonical contract

`TaskItem.BriefGoal`, `BriefDeliverable`, and `BriefConstraints` are additive
nullable Task-specific values, each capped at 4,000 characters. Migration
`20260824220000_AddStructuredTaskBrief` adds only those three nullable columns
and no indexes or backfill. Existing `TaskItem.Description` remains the
free-form compatibility field.

Create, subtask-create, versioned Task PATCH, and canonical Task detail bind
the structured values. PATCH distinguishes omission (preserve) from explicit
null/blank (clear). Canonical detail exposes each value with exactly
`taskSpecific` or `notSet` provenance; stored null/blank values fail closed to
`notSet`.

No Project default is inferred. `Project.Description` remains separately
labelled, separately authorized Project context and is never copied to Goal,
Deliverable, or Constraints. Project Task lists do not carry Brief bodies.
Audit, notification, realtime, and Search metadata do not contain Brief
values.

## UI and #410 boundary

The maintained Task detail editor uses one reusable `TaskBriefFieldsComponent`.
It marks every field optional, uses live theme tokens, exposes a same-order
Goal, Deliverable, Constraints review, remains keyboard/read-only capable,
and collapses without horizontal overflow at 320 pixels. Free-form Task notes
remain a separate control.

Issue #410 now integrates the same reusable Brief component into its
Project-aware Task-create candidate. That separate canonical create boundary
stores an optional Task Brief with the Task; it does not supply Project Brief
defaults, start a runtime, create an execution run, or change this Issue #350
contract. See `docs/verification/p0-task-create.md` for its separate candidate
evidence and limits.

## Security and validation

All mutations reuse existing server-side Task create/update authorization,
Tenant/Project scope, optimistic concurrency, transaction, audit, and
invalidation boundaries. Unauthorized detail returns safe `TASK_NOT_FOUND`
without values. Over-limit failures are mutation-free HTTP 400
`TASK_BRIEF_FIELD_TOO_LONG` responses targeted to the specific `goal`,
`deliverable`, or `constraints` field.

## Local verification recorded on 2026-08-24

- Focused backend regression: 208 passed, 0 failed. Coverage includes create,
  subtask create, update/detail provenance, Description-only compatibility,
  omission/null PATCH semantics, all three 4,000-character targets,
  authorization redaction, no-value audit/realtime metadata, EF nullability,
  max length, and no-index assertions.
- Focused Angular regression: 4 files / 55 tests passed. Coverage includes API
  request compatibility, provenance fail-closed mapping, reusable field order,
  max lengths and semantic invalid state, clear behavior, review, read-only
  state, and canonical-detail precedence across a compact
  `Projects.ProjectChanged.v1` list refresh.
- Full backend suite: 914 passed, 0 failed, and 241 environment-dependent
  PostgreSQL tests skipped. The new structured-Brief PostgreSQL round-trip was
  among the explicitly skipped tests.
- Full Angular suite: 74 files / 738 tests passed.
- Production Angular build passed with the repository's pre-existing bundle
  budget warnings.
- Focused Playwright Chromium: 1 passed at a forced 320-pixel viewport with
  successful PATCH/refetch, same-order review, no document overflow, and zero
  axe violations within the Task Brief subtree in both light and dark themes.
- `dotnet ef migrations has-pending-model-changes` reported no model changes.
- Npgsql migration script generation from
  `20260823054500_AddMessageNotificationPreference` to
  `20260824220000_AddStructuredTaskBrief` produced exactly three nullable
  `character varying(4000)` additions and the migration-history row.
- Focused PostgreSQL round-trip test was discovered but skipped because
  `POSTGRES_TEST_CONNECTION_STRING` was not available. It must not be counted
  as provider-backed execution.

Mocked Angular/Playwright evidence proves browser behavior, not real-backend
integration. The focused axe assertion intentionally covers the new Task Brief
subtree; it does not claim a whole-page dark-theme accessibility audit of
pre-existing Task-detail surfaces. The pending PostgreSQL and hosted/CI gates
remain explicit.
