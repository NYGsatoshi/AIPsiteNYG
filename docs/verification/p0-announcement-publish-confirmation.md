# P0 announcement immediate-publish confirmation verification

Status: Issue #378 non-closing implementation candidate. This record covers
only an explicit review and confirmation of an immediate Announcement create.
It is not a scheduling, saved-draft, preview, or delivery-worker design.

## Candidate boundary

The maintained Announcement editor first validates its existing required title,
body, priority, and server-authorized audience selection. A valid submit opens
an accessible confirmation dialog rather than issuing the create request
directly. The dialog presents the trimmed title and body, selected audience
display name, estimated recipient count, mapped priority, and an explicit
"publish immediately" delivery statement. Confirming emits the existing
create submission once; Back, Escape, or backdrop cancellation returns to the
same editable form without a mutation.

The dialog is a browser review, not a source of authority. Its busy state and
the facade's in-flight guard suppress duplicate simultaneous POSTs, but they do
not provide a durable idempotency or replay guarantee. After a generic create
failure the form remains editable in the current browser tab. A selected-scope
authorization failure refreshes the server-authorized audience options and
does not reveal names or counts for a newly unavailable scope.

## Current server contract

`GET /api/announcements/audiences` returns the current actor's authorized
audience options only. Each option contains an opaque key, scope type, exact
scope IDs, display name, and `estimatedRecipientCount`; it does not return
recipient identities. The Angular adapter accepts only complete, valid option
records and maps priority to the numeric `AnnouncementPriority` request value.

The immediate candidate sends the existing `POST /api/announcements` shape:
selected `workspaceId`/`groupId`/`channelId`, title, body, numeric priority,
`isPinned: false`, and `requiresReadConfirmation`. It intentionally sends no
`publishedAt`, `expiresAt`, schedule, or timezone value. The cookie-authenticated
POST remains CSRF-protected and currently succeeds through the shared
controller mapper with HTTP 200 and an `AnnouncementDetailResponse`.

Immediately before creation, `AnnouncementsController` asks the audience
service to re-resolve only the selected submitted scope. This checks current
Tenant context, active parent lifecycle, and current scope authority without
re-enumerating every available audience or recipient count. The service then
performs its existing create validation and persistence. The browser must not
treat a prior audience list or the confirmation dialog as an authorization
decision.

## Explicit exclusions and Issue status

Issue #378 remains open. This candidate has no:

- schedule picker, timezone input, or approved scheduled-publication contract;
- persistent or saved drafts; the retained editor state is current-tab only;
- standalone content preview; the confirmation review is not a preview feature;
- `Idempotency-Key`, replay response, automatic retry, or unknown-outcome recovery;
- scheduler, worker, deferred-delivery behavior, or delivery completion contract.

The browser therefore must describe only immediate publication. A future
scheduling or retry feature requires a separately approved persistent server
contract and cannot be inferred from optional backend timestamp fields or UI
view-model labels.

## Required final-head verification

No real-backend confirmation result is recorded by this documentation patch.
Before promoting this candidate, run and record on its exact integrated head:

- focused Angular editor and facade tests for confirmation, cancellation,
  preserved failures, selected-audience refresh, and duplicate-submit guard;
- production Angular build plus a representative 320-pixel keyboard/focus and
  accessibility browser check; mocked browser responses prove UI behavior only;
- a Compose-backed real-browser check against ASP.NET Core and PostgreSQL for
  cookie/CSRF handling, selected-scope reauthorization, the actual HTTP 200
  create response, and persisted immediate publication;
- relevant server authorization regression evidence for stale or revoked
  Workspace, Group, and Channel scopes.

A successful mocked test or a source inspection alone does not establish
server authorization, persistence, recipient isolation, CSRF, or replay
behavior.
