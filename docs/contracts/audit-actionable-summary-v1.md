# Audit actionable summary contract v1

Status: canonical for Issue #353.

Owner: Audit UI, `GET /api/admin/audit-grid`, and the authorized Claims & Evidence projection.

## Decision

Audit Summary is an action-oriented navigation surface, not a health score. It exposes three independently meaningful checks:

- `Unverified claims` for the currently opened, already-authorized `ArtifactVersion`;
- `Warning events` in the caller's current authorized Tenant/platform Audit scope;
- `Error events` represented by the existing backend-owned `failed` Audit result classification in that same scope.

A zero in one category never means that an audit is complete. Review completion, export, and future Finding workflow actions remain outside this summary.

## Count ownership

The browser must not filter a previously returned Audit page to invent Warning or Error totals.

- Warning count is the authoritative `totalCount` from `GET /api/admin/audit-grid?severity=warning&page=1&pageSize=1`.
- Error count is the authoritative `totalCount` from `GET /api/admin/audit-grid?result=failed&page=1&pageSize=1`.
- Unverified Claim count is computed only from the bounded Claim projection already returned by `GET /api/admin/audit/claims-evidence?artifactVersionId=...` after `audit.view`, Artifact, and Evidence authorization. It is explicitly labelled as belonging to the currently opened Artifact version.

The summary does not query raw metadata, infer hidden Claims/Evidence, count omitted Evidence, or persist returned totals.

## Drill-down

Each available card is a real control with one-step navigation:

- `Unverified claims` applies the `support=Unverified` URL filter to the current Claims list.
- `Warning events` navigates to `/app/admin/audit?severity=warning`.
- `Error events` navigates to `/app/admin/audit?status=failed`.

The resulting list must render its applied filter as visible text. Claims use an explicit removable Support chip; Audit events reuse the canonical filter chips from Issue #344. URLs contain filter inputs only and always cause a fresh authorized request.

## Failure and permission states

Warning/Error summary requests fail closed. Invalid count payloads, permission denial, or transport failure never render a guessed zero. The Claims card is unavailable until a valid authorized Artifact version is loaded.

## Accessibility and responsive behavior

Cards are keyboard-operable buttons, expose their count and meaning in text, retain visible focus, and reflow to one column on narrow screens. Disabled/loading states are expressed with text and not color alone.

## Security invariants

- no health score or client-derived compliance conclusion;
- no hidden-data counts;
- no raw `metadataJson` dependency;
- no client-side Audit row filtering for totals;
- no cross-Tenant or unauthorized Artifact/Source existence signal;
- no cached count treated as an authorization grant;
- protected detail and export actions remain separate from Summary navigation.
