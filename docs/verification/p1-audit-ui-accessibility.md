# P1 Audit UI accessibility hardening (Issue #386)

Status: merged non-closing slice; Issue #386 remains open.

## Scope

The maintained Audit route at `/app/admin/audit` remains a read-only client of
the server-authorized `AuditGridRowResponse` list and detail routes. This slice
hardens the existing high-density inspection flow without adding an Audit
Review command, client filtering, export, saved view, realtime, or raw-metadata
feature.

- Desktop and mobile show readable column/status text rather than internal
  field keys or color-only classifications.
- Unexpected severity or result text is converted at the HTTP boundary to a
  fixed neutral presentation. The unrecognized wire value is not rendered or
  announced.
- One persistent polite status region uses only fixed local text plus the
  currently displayed row count. It never claims an unavailable server total
  or includes server errors, request IDs, names, summaries, or other protected
  values.
- The existing non-modal drawer keeps its current semantics: opening focuses
  Close, Escape/Close restores the originating action and scroll context, and
  it does not trap focus.
- Desktop AG and flagged Syncfusion row actions have a minimum 24 by 24 CSS
  pixel target. Syncfusion action configuration is stable between unrelated
  Angular change-detection cycles, and its rendered button handles Enter and
  Space locally before the vendor grid can consume the key.

## Security boundary

The browser still requests only `/api/admin/audit-grid` and
`/api/admin/audit-grid/{auditId}`. Server-side `audit.view`, tenant/platform
scope, redaction, and the generic detail-not-found policy remain authoritative.
The slice does not parse `metadataJson`, actor IDs, target IDs, raw metadata,
duration, Claim/Evidence, or new detail fields.

## Focused verification

Local candidate evidence on 2026-08-27 JST:

- `admin-ui.spec.ts`: 25 passing tests covering safe status text, named
  headers, fixed unknown-enum fallback, and redaction-preserving error/empty
  states.
- `syncfusion-data-grid.adapter-options.spec.ts`: 3 passing tests covering
  stable vendor settings, local keyboard intent, and row activation.
- Focused server audit authorization/tenant-isolation regression: 35 passing
  tests, including the redacted list/detail response boundary and generic
  cross-tenant/malformed detail behavior.
- Application and spec TypeScript checks passed.
- Production Angular build passed. It reported only pre-existing budget
  warnings outside the Audit stylesheet.
- Static Angular Playwright Audit selection: 6 passed, 2 desktop-only tests
  skipped on the mobile project. It covered 320px, axe on the active AG route,
  semantic headers, target sizing, sticky-header visibility, keyboard
  open/Escape focus return, and a pre-bootstrap flagged Syncfusion rendered
  keyboard/header/action check.

The optional Syncfusion path stays disabled by default. Its isolated smoke
checks the adapter-owned rendering and keyboard contract; the active AG path
is the page-level axe gate. PR #436 passed its exact-head CI and real-backend
P0 acceptance before merging. The corresponding main CI/security/onboarding
gates also passed after the merge; #386 intentionally remains open for its
separate contract gaps below.

## Deliberate exclusions

Issue #386 remains open because the current repository has no approved command
or projection for Audit Review save, server-backed audit filters, export
completion, realtime updates, saved views, or extra/raw audit detail fields.
Those features must not be fabricated by client-side filtering or status text.
