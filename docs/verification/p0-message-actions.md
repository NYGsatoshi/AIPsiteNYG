# P0 Message Actions: Safe Issue #343 Subset

Status: implementation candidate; explicitly non-closing for Issue #343.

## Implemented current-source slice

- Existing `PATCH /api/messages/{messageId}` is available for an own confirmed
  message while the existing conversation projection permits posting. The
  request is exactly `{ "body": string }`; the returned `MessageResponse`
  reconciles the current row and renders its existing `editedAt` marker.
- Existing `DELETE /api/messages/{messageId}` is available as an own-message
  usability affordance after an accessible destructive confirmation. Current
  list reads filter deleted rows, so success removes the row rather than
  inventing a durable client tombstone.
- Existing `POST /api/messages/{messageId}/report` is available for a visible
  confirmed row. The client sends the deliberately generic `{ "reasonCode":
  "reported" }` request and accurately says only that the current service
  records the request; it does not claim a case, evidence package, or case
  status.
- Controls are plain keyboard-operable buttons in a More overflow (not an ARIA
  menu), use visible labels plus Lucide icons, have 44-pixel minimum targets,
  and include focus recovery for edit completion, cancel, delete, and realtime
  removal when that row is the active action target. Pending, failed, and
  deleted rows do not expose mutations.
- Server authorization remains authoritative. There are no `canEdit` or
  `canDelete` API projection fields. The UI does not infer moderator authority;
  generic 400/403/404 failures use one non-disclosing recovery message and
  never render backend error text.

## Deliberate non-goals and missing contracts

This candidate does **not** close Issue #343. It does not provide Reply,
Save/bookmark, React/reactions, Copy, a moderator capability projection, a new
message endpoint, or an altered authentication contract. The current source
also lacks canonical version-token edit preconditions/history, the 24-hour
sender-delete rule, durable tombstone retention on list reload, quoted replies,
emoji reactions, and report evidence scope/case workflow. The external
messaging product contract must be completed through separately authorized
backend and product work before those behavior claims can be made.

## Verification boundary

Focused Angular tests exercise the exact PATCH/DELETE/Report DTOs, generic
error redaction/retry, confirmation-before-delete, row removal, and edited
marker. Static Playwright exercises both desktop and 320-pixel projects with
CSRF headers, keyboard and touch activation, pointer target/overflow checks,
focus recovery, a generic HTTP 400 sentinel, and no raw error leak. Those mocks
do not establish real backend integration. The existing mandatory MVP0
real-backend browser flow has been extended with report, edit, reload, delete,
and list-exclusion checks; it remains an unexecuted exact-head integration
gate for this candidate.
