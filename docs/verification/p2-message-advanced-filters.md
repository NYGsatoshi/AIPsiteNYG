# Issue #367 advanced Message-filter verification

Status: implementation candidate on `feat/367-message-advanced-filters`.

## Implemented slice

- The maintained Messages surface adds one explicit, focus-contained Advanced
  filters drawer for an authorized sender, local-calendar date range,
  Message-level Read/Unread, and safe attachment presence.
- Applied fields are independent removable chips. Text remains memory-only;
  validated non-sensitive filters use URL state, while recognized free-text
  keys are scrubbed on initial load and every later navigation.
- Sender lookup and exact URL replay use the bounded
  `GET /api/search/message-authors` projection. Raw UUIDs are never rendered or
  applied before server authorization, and held/late responses cannot restore
  stale route state.
- Search accepts advanced-only requests and evaluates every facet inside the
  recursive current-readable Conversation relation before deterministic
  ordering and limiting.
- Date end is the next local calendar day's UTC instant and is exclusive, so
  PostgreSQL sub-millisecond values and DST transitions do not create a gap.
- Message read coverage uses the exact `(CreatedAt, Id)` cursor pair. Legacy
  cursor IDs remain authoritative with sequence zero; only a null ID uses the
  established action-time fallback, while invalid non-null cursors fail closed.
- `With` recognizes only clean, classified, active, non-deleted,
  scope-consistent Message-owned file relationships. Unsafe or malformed rows
  count as `Without`, and Search returns no attachment metadata or count.

The exact contract and non-goals are in
`docs/contracts/message-advanced-filters-v1.md`. The critical BE-004 upload and
persistence defect remains open; the composer still disables attachments, and
this work does not claim a production attachment-upload journey.

## Authorization and privacy evidence

The PostgreSQL provider resolves the complete canonical recursive readable-
Conversation ID set and intersects it with matching Messages before projection,
ordering, or the final bound. This retains no arbitrary pre-authorization
Conversation cutoff while avoiding one pathological combined authorization /
advanced-predicate SQL plan. Exact Tenant/Workspace consistency remains
mandatory for Messages, cursor Messages, and file relationships. Author
filters validate the opaque identity once against the current Tenant and use
its exact historical Conversation-member set before the result bound; names
are added only after the authorized 100-row bound through the same historical
Tenant-user and Conversation-member proof. Restricted, cross-Tenant, corrupt
cross-Workspace, deleted,
unsafe, and malformed rows cannot disclose content, sender options, totals,
counts, file attributes, or error details. Malformed UUID/enum/date query
binding returns one fixed `SearchRequestInvalid` envelope without echoing the
input marker.

URL state carries no Message query or result content. Back/Forward replay
resolves an opaque sender ID through the authorized endpoint before display or
search. Every local Apply, chip removal, and Clear all synchronously cancels
route-author hydration and invalidates its generation before committing state.

## Local verification record

- Release backend test-project build: passed, with only existing warnings.
- Fresh PostgreSQL 18 database with every migration applied: `Scope=Issue367`
  passed 3/3 with zero skips. This run proves actual Npgsql UUID pair
  translation, timestamp ties, legacy/null/corrupt cursor behavior,
  authorization, exact historical author attribution (including a same-Tenant
  nonparticipant), attachment complements, date boundary, and HTTP envelope.
- The existing 125-Conversation WPC-01 authorization-before-limit regression
  passed with structurally valid historical authors. PostgreSQL slow-statement
  diagnostics measured the formerly combined Message query at 21.756 seconds;
  after separating the complete readable-ID set, no Search statement crossed
  the same 500 ms diagnostic threshold.
- Full PostgreSQL-backed backend suite: 1,243/1,243 passed with zero skips.
- Focused Angular component suite: 9/9 passed under Node 24.19.0.
- Angular production build: passed. Existing bundle/style budget warnings,
  including the expanded Message-filter stylesheet, remain warnings.
- Focused static Playwright: the forced-320-pixel advanced flow passed 1/1;
  the complete Message discovery spec passed its applicable desktop/mobile
  cases. It covers keyboard selection/trapping, focus return, URL
  privacy/history, exact query fields, a 23-hour daylight-saving calendar day,
  horizontal overflow, and axe.

Static browser responses are mocked. Exact-head CI remains required for the
authoritative backend, full frontend, Linux Playwright, and PostgreSQL gates.
