# Audit filter and saved-view contract v1

Status: active

Owner: Audit UI and `GET /api/admin/audit-grid`

## Scope

The Admin Audit page provides an apply-based search over the caller's current
Tenant, or the caller's explicit platform Audit scope. The server remains the
owner of authorization, filtering, paging, and `totalCount`; the browser never
filters an already-returned Audit page to produce results or counts.

This contract does not add Claims, Evidence, review, export, or historical
snapshot semantics.

## Query

`GET /api/admin/audit-grid` accepts the existing paging and scope parameters
plus these optional filters:

- `q`: case-insensitive text search over Action, entity type, safe Summary, and
  Workspace display name. Actor display name participates only when the caller
  has `audit.sensitive_metadata.view`. Metadata, request IDs, entity IDs, raw
  paths, Claims, and Evidence never participate.
- `action`: the Audit event Type facet (exact, case-insensitive Action value).
- `entityType`: the Source facet (exact, case-insensitive entity type).
- `actor`: case-insensitive Actor display-name text. Supplying this parameter
  requires `audit.sensitive_metadata.view` before the query is evaluated.
- `severity`: one of `info`, `warning`, or `critical`.
- `result`: the Status facet, one of `success`, `denied`, or `failed`.
- `fromDate` / `toDate`: inclusive UTC bounds. The UI v1 emits `fromDate` from
  relative presets (24 hours, 7 days, or 30 days) and omits `toDate`.

Text inputs are trimmed, bounded to 200 characters (`action` and `entityType`
retain their smaller domain bounds), and rejected rather than truncated.
`fromDate` after `toDate` is invalid. Severity and Status use the same
backend-owned Action classification policy as the returned row projection.

Tenant/platform scope and `audit.view` are checked before data access. Actor
facet authorization is checked before data access. Scope is applied before
all predicates and before the authoritative count, so unauthorized rows cannot
affect items, counts, empty states, titles, snippets, or facet feedback.

The response remains `PagedResponse<AuditGridRowResponse>`. `totalCount` is the
count after every authorized predicate and before paging. UI retry repeats the
same applied query.

## URL state

The page mirrors applied filter inputs in query parameters `q`, `severity`,
`type`, `actor`, `source`, `status`, and `range`. Empty or invalid values are
omitted. `range` is one of `24h`, `7d`, or `30d`; the corresponding UTC bound is
computed when the URL is applied. The existing exact-event `event` parameter is
independent.

URLs contain filter inputs only. They never contain returned rows, result
counts, capability decisions, actor IDs, metadata, or server-derived labels.
Opening a URL always performs a new authorized server request.

## Saved views

Saved views are browser-local presentation preferences in v1. A view contains
only a user-entered name and the seven applied URL filter inputs. Records are:

- versioned and strictly parsed;
- limited to 20 per identity and 80 characters per name;
- partitioned by authenticated user plus Tenant ID, or by authenticated user
  plus the literal explicit platform scope;
- discarded when malformed, over limit, duplicated, or outside the current
  identity partition.

Rows, counts, display labels, permission/capability state, exact-event IDs, and
response data are never persisted. Applying a view updates the URL and issues a
new server-authorized request. A saved view is therefore not an authorization
grant or a frozen Audit result.

## Protected-state invalidation

Session, Tenant, Workspace, or server authorization invalidation cancels or
invalidates in-flight Audit list/detail/metadata requests and clears returned
rows, counts, draft filters, applied filters, exact-event state, and capability
state before further rendering. Browser-local saved-view records remain only in
their identity partition and are reloaded after an active identity is known.
