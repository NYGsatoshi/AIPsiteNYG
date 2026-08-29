# P0 announcement immediate-publish confirmation verification

Status: Issue #378 non-closing implementation candidate. This record covers
only an explicit review and confirmation of an immediate Announcement create.
It is not a scheduling, saved-draft, or delivery-worker design. The separate
local-only editor preview is recorded in
`docs/verification/p1-announcement-local-preview.md`.

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

A connected client that receives an authorization-state invalidation correctly
clears protected editor and review state before it can submit. The
real-backend stale-client regression deliberately prevents only the Hub
transport in an isolated browser context; cookie, CSRF, DELETE, audience GET,
and POST requests remain real. The final POST must independently reauthorize
the selected scope, reject it without protected-name/count disclosure, and
refresh the editor's authorized audience list.

## Explicit exclusions and Issue status

Issue #378 remains open. This candidate has no:

- schedule picker, timezone input, or approved scheduled-publication contract;
- persistent or saved drafts; the retained editor state is current-tab only;
- a server-backed or delivery-capable content preview; the confirmation review is not itself a preview feature;
- `Idempotency-Key`, replay response, automatic retry, or unknown-outcome recovery;
- scheduler, worker, deferred-delivery behavior, or delivery completion contract.

The browser therefore must describe only immediate publication. A future
scheduling or retry feature requires a separately approved persistent server
contract and cannot be inferred from optional backend timestamp fields or UI
view-model labels.

## Recorded local verification

- Focused Angular editor, facade, and API-adapter suites passed: 3 files / 32
  tests under Node 24.19.0. They cover the review-before-POST boundary,
  confirmation single-flight, command-settled recovery, preserved values,
  selected-audience refresh, and exact immediate request mapping.
- The production Angular build passed. This candidate introduces no new
  Announcement-editor style-budget warning; existing repository bundle and
  unrelated component-style warnings remain.
- The focused static Playwright announcement scenario passed in Chromium
  desktop and mobile at a forced 320-pixel viewport. It exercises validation,
  the confirmation review, Escape/focus return, failure-preserved values,
  successful HTTP-200 handling, no horizontal overflow, and axe checks. Its
  API responses are mocked.
- The real-backend P0 manifest/discovery verification passed locally and
  selects the new Issue #378 title. It has not been executed locally because
  the Compose frontend build requires the externally supplied Syncfusion
  license secret; no credential was written or bypassed.

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
- the stale-client revocation proof with only `/hubs/app` transport
  unavailable; it must not suppress server reauthorization or replace the
  real POST with a mock;
- relevant server authorization regression evidence for stale or revoked
  Workspace, Group, and Channel scopes.

A successful mocked test or a source inspection alone does not establish
server authorization, persistence, recipient isolation, CSRF, or replay
behavior.
