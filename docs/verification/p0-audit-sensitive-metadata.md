# P0 Audit exact-event sensitive metadata (Issue #349)

Status: implementation candidate; exact-head CI and merge required.

## Contract

The existing `/app/admin/audit` list and safe row drawer remain the initial
surface. They contain no raw metadata field, metadata count, or metadata-derived
error. An authorized user can explicitly select **Show sensitive metadata** for
one loaded event. Only then does the browser call:

`GET /api/admin/audit-grid/{auditId}/sensitive-metadata`

The response is `AuditSensitiveMetadataResponse`:

- `auditId`: the exact selected event ID;
- `metadata`: a parsed JSON object, never the persisted JSON string; and
- `redactionApplied`: whether the defensive read policy removed data.

The use case requires both `audit.view` and
`audit.sensitive_metadata.view` before lookup. It applies current Tenant or
explicit platform scope before comparing the ID. Malformed, absent, and
cross-Tenant IDs share `404 AuditEventNotFound`; denied capability is `403`.
Errors are canonical fixed envelopes and contain no stored metadata.

Normal Audit writes already store redacted metadata. The disclosure path also
recursively removes prohibited keys from legacy/imported JSON, including
credentials, secrets/tokens, storage paths, message/comment/file bodies,
personal or medical contact content, raw search/export content, and
Claims/Evidence. This issue does not define or consume the separate #340
Claims/Evidence contract.

## Browser behavior

- `/api/audit/capabilities` gates the disclosure control; hiding a control is
  presentation only and the exact endpoint independently authorizes every GET.
- Metadata is neither prefetched nor retained across event selection, drawer
  close, or Hide. An in-flight request is unsubscribed and every completion is
  generation checked.
- The response ID and object shape are validated before display. JSON is
  formatted locally and rendered by Angular text interpolation in a labelled,
  keyboard-scrollable `pre`; no HTML injection path is used.
- The same button toggles Show/Hide and retains keyboard focus. Loading, empty,
  denied, missing, and error states use fixed local status text.
- The drawer remains one column below 860 pixels and its JSON surface wraps and
  scrolls inside its own width.

## Local verification

Candidate evidence on 2026-08-29 JST:

- Focused backend Audit/controller and Tenant-isolation selection: 37 passed.
- Full backend solution: 975 passed, 247 skipped because the conditional
  PostgreSQL connection string is not configured, 0 failed.
- Application and spec TypeScript checks passed.
- Focused `admin-ui.spec.ts`: 32 passed.
- Full Angular: 953 passed and two unrelated Files-page cases exceeded the
  suite-wide five-second limit; the complete Files-page file then passed 14/14
  in isolation.
- Production Angular build passed; only pre-existing bundle and unrelated
  component-style warnings were reported.
- Frontend architecture check and its four rule tests passed.
- Focused static Angular Playwright, Chromium mobile: 1 passed. It covers the
  320-pixel drawer, explicit keyboard disclosure/hide, escaped markup-shaped
  JSON text, focus retention, horizontal containment, and axe.

The backend tests use EF Core InMemory. This change adds no migration or
provider-specific query. Static Playwright responses are mocked and establish
frontend behavior only; server authorization is established by the focused
backend tests and remains subject to exact-head CI.
