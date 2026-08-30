# Message advanced-filter contract v1

Status: Issue #367 implementation candidate; additive to the #359 base contract.

## Purpose and scope

The Messages search surface adds compound, server-evaluated filters for an
authorized Message result set. These filters are separate from Issue #355's
Conversation-level All / Unread / Mentions / Later inbox views:

- From filters Message authors;
- Date range filters Message creation timestamps;
- Read / Unread evaluates each Message against the current user's server read
  cursor;
- With / Without attachment evaluates canonical Message-owned file links.

The existing bounded `GET /api/search` response remains the result projection.
Advanced fields are legal only when `type=Message`. A text query is optional
when at least one non-default advanced filter is present.

## Request contract

The additive query fields are:

```http
GET /api/search?type=Message&authorUserId={uuid}&fromDate={utc}&toDateExclusive={utc}&messageRead=Unread&messageAttachment=With&page=1&pageSize=50
```

The endpoint accepts the symbolic enum names used by the maintained browser:

- `messageRead`: `All`, `Read`, or `Unread`;
- `messageAttachment`: `All`, `With`, or `Without`.

Undefined values, an empty author UUID, reversed/empty dates, both legacy
`toDate` and `toDateExclusive`, or Message-only fields with another search type
are rejected through the fixed, non-reflective Search error envelope. The
browser maps the selected local start day to its UTC instant and the local day
after the selected end day to an exclusive UTC instant. This half-open range
includes PostgreSQL sub-millisecond values at the end of the selected day and
remains correct across daylight-saving transitions.

`Unread` means the Message was authored by somebody else and the current
user's server-validated Conversation cursor does not cover it. A non-null
`LastReadMessageId` is authoritative, including legacy rows whose
`LastReadSequence` is zero: the cursor must resolve to the same Tenant,
Workspace, and Conversation, and coverage compares the pair
`(CreatedAt, Id)`. A non-null cursor that is missing or scope-inconsistent
fails closed and does not fall back to an action timestamp. For legacy state
with no cursor ID, the established Conversation-open behavior falls back to
`LastReadAt >= Message.CreatedAt`. `Read` is the exact complement inside the
authorized, non-deleted candidate set; the current user's own Messages are
therefore read. This compatibility behavior is scoped to Message search and
does not change Conversation inbox counts, dashboard state, or the selected
Conversation inbox view.

`With` requires all of the following server-side relationships:

- a `MessageAttachment` linked to the exact Message;
- a non-deleted `Attachment` owned as `Message` by that exact Message and in
  the Conversation's Workspace, with a `Clean` scan result;
- a non-empty canonical `FileObjectId` resolving to a non-deleted, active
  `FileObject` in that Workspace, with no Project scope and a present
  classification other than `UnknownSensitive`.

`Without` is the negation of that safe relationship. Legacy or malformed
metadata-only rows from BE-004, quarantined/unsafe scan states, missing or
unknown-sensitive classifications, and scope-inconsistent links never satisfy
`With`; no filename, storage key, path, attachment count, scan state,
classification, or invalid-link detail is returned by Search. The current MVP0
composer still disables attachment upload, so this filter describes only
already-canonical server records and does not claim an end-user upload journey.

## Authorized author options

The bounded current-user endpoint is:

```http
GET /api/search/message-authors?q={at-least-two-characters}&limit={1..20}
GET /api/search/message-authors?selectedUserId={uuid}
```

It returns only `{ userId, displayName }` options and no total or per-author
count. A query requires two to 120 trimmed characters. Exact selected-ID
resolution supports validated URL replay; malformed IDs are rejected, while
missing, cross-Tenant, and unauthorized IDs all return the same empty success
projection.

An author is eligible only when at least one non-deleted Message by that user
belongs to a Conversation in the caller's current recursive readable-
Conversation relation, and the user has structural historical membership in
both the current Tenant and that exact Conversation. Current membership
lifecycle does not erase a legitimate historical display name. Search result
author names use the same structural proof.

The opaque `authorUserId` predicate is distinct from display-name attribution.
The server validates the selected identity once against the current Tenant,
then applies its exact historical Conversation-member set to the already-
authorized Message relation before ordering or limiting. Without an author
filter, a readable historical Message remains a result when its author lacks
exact Conversation attribution, but that row's author display name is `null`.
After the result is capped at 100, one bounded set-based attribution query
supplies names only through exact Tenant-user and Conversation-member
relationships. This prevents cross-Tenant name disclosure and an authorship
oracle without placing repeated correlated membership subqueries on the
recursive Message authorization plan. Email addresses, roles, lifecycle state,
Conversation identities, counts, and matching Message content are not
projected by the author-options endpoint.

## Authorization and ordering

PostgreSQL resolves the complete shared cycle-safe, scope-consistent, 32-level
readable-Conversation ID set first, then intersects every Message predicate
with that set before deterministic `CreatedAt DESC, Id ASC` ordering and the
final bound. The authorized ID set has no arbitrary pre-authorization cutoff;
keeping the recursive Project/Workspace graph in a separate query prevents
optional advanced predicates from producing a pathological combined SQL plan.
Filters, author options, result totals, empty states, and errors disclose no
inaccessible Conversation, Message, author, read state, or attachment metadata.
Browser chips and drawer visibility are presentation only and never authorize
a result.

A Message must also carry the same Tenant and Workspace as its joined
Conversation. Malformed cross-scope rows are excluded before text matching,
author-option projection, totals, or pagination.

## Browser state and accessibility

- An explicit Advanced filters button opens a focus-contained drawer; Escape
  cancels draft edits and returns focus to the trigger.
- Draft fields do not query until Apply. Reset clears the draft; Clear all and
  individual chips immediately rerun the authoritative search when another
  condition remains.
- Applied From, date, Message status, and attachment conditions are rendered as
  separate removable chips from the Conversation inbox-view chip.
- Only validated, non-sensitive filter identities are reproducible in URL
  query state. Free-text Message content remains memory-only under Issue
  #359's privacy contract. A URL author UUID is not displayed or applied until
  the authorized author endpoint resolves it.
- Back / Forward restores validated applied filters and reruns the server
  search. Malformed or unauthorized URL fields are removed without rendering
  their raw values.
- Protected state and in-flight requests are cancelled on identity,
  authorization, route, or scope loss. Late responses cannot restore it.
- At 320 CSS pixels the drawer uses the available width without horizontal
  scrolling; labels, errors, active state, and results do not rely on color.

## Non-goals

- repairing or enabling Message attachment upload;
- returning attachment metadata, counts, or download links;
- per-Message save/reminder workflow owned by Issue #368;
- changing Conversation inbox counts or Later state;
- storing free-text queries or result snippets in URLs or browser storage;
- implementing any contract owned by Issues #340 or #357.
