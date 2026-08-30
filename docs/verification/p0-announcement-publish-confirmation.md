# P0 announcement publish confirmation and durable delivery verification

Status: implementation candidate for Issue #378. This supersedes the earlier
immediate-only confirmation note. The local-only Preview surface remains the
separate #382 contract in `p1-announcement-local-preview.md`.

## Canonical lifecycle

The server owns one bounded `AnnouncementDraft` for the author, Tenant, and
one exact persisted audience target. Its only delivery lifecycle is:

```text
Draft -> Scheduled -> Published
```

`Save draft` stores or updates only `Draft` content. A reviewed **Publish now**
command does not create an `Announcement` in the controller or browser; it
records an immediate UTC `Scheduled` due time. A reviewed scheduled command
records the supplied local wall-clock value and IANA zone, resolves the one
UTC due instant server-side, and records `Scheduled`. The bounded in-process
publisher is the only path that creates the real `Announcement` and changes
the draft to `Published`.

The UI therefore distinguishes an accepted immediate request from completed
publication: it reports **Publication queued** until the worker has
reauthorized the saved audience and persisted the actual Announcement. It
does not synthesize a list item, recipient delivery, or success state from a
browser timeout.

## API and concurrency contract

All routes are cookie-authenticated, CSRF-protected unsafe requests:

- `POST /api/announcement-drafts` requires `Idempotency-Key` and stores a
  bounded Draft.
- `PUT /api/announcement-drafts/{draftId}` accepts `expectedVersion` for an
  editable Draft only.
- `POST /api/announcement-drafts/{draftId}/publish` requires
  `Idempotency-Key` and changes Draft to an immediate Scheduled record.
- `POST /api/announcement-drafts/{draftId}/schedule` requires
  `Idempotency-Key`, an IANA `timeZoneId`, an unspecified local datetime, and
  `expectedVersion`.
- `GET /api/announcement-drafts` and its exact-item read return only the
  current authorized author’s drafts.

Create, immediate queue, and schedule each have a Tenant/actor/operation
scoped idempotency identity. Replaying the same normalized command returns
the same logical draft even after its status has changed; reusing a key for a
different payload is a conflict. `VersionNo` is an optimistic concurrency
token for content updates and transition requests. PostgreSQL’s short worker
lease is also fenced by that version, so competing hosts cannot successfully
claim and publish the same Scheduled draft.

For an immediate request, the server records its own `UTC` local/time-zone
representation and UTC due instant. For user scheduling, `TimeZoneInfo`
resolves the IANA local wall-clock time once. Invalid zones, skipped local
times, and unresolved/invalid DST-overlap offsets fail safely. The stored UTC
instant is never recalculated by the worker.

## Authorization and durable publisher boundary

Audience IDs in a request are a requested target, never authority. The server
validates the canonical Workspace/Group/Channel shape and reauthorizes the
author when creating, saving, and accepting either delivery command. Draft
reads are author- and current-target-authorized; cross-Tenant, other-author,
or revoked-target reads use the same redacted not-found path.

At due time the worker establishes the draft Tenant context from its durable
claim and resolves the persisted author and audience again. Lost membership,
deleted/archived parents, or lost scope authority leave the record Scheduled,
clear the lease, and record only a bounded safe retry code. No Announcement,
recipient invalidation, raw exception, recipient identity, or formerly
authorized display name/count is emitted in that case. Parent foreign keys
are restrictive so physical deletion cannot turn a retained Workspace/Group/
Channel target into a global target.

On a successful reauthorization, the worker creates one normal `Announcement`,
records the immutable draft-to-Announcement identity, audits the state change,
and issues the existing authorized invalidation. It never exposes worker lease
tokens, storage keys, credentials, or raw exception text to the browser.

## Worker operation

`AnnouncementPublisherWorker` is a small in-process hosted worker. PostgreSQL
is the coordination boundary; no queue, SaaS dependency, or new service is
introduced. It pages active Tenants in platform scope, claims a bounded due
batch in each Tenant scope, and processes every claim through a fresh scoped
service provider. A failed claim has a bounded retry time; a stale lease is
reclaimable after expiry. Operator configuration is in the
`AnnouncementPublisher` appsettings section:

| Setting | Default | Bound |
| --- | ---: | --- |
| `PollSeconds` | 30 | at least 1 second |
| `TenantPageSize` | 25 | 1–100 |
| `ClaimBatchSize` | 10 | 1–50 |
| `ClaimTimeoutSeconds` | 120 | at least 1 second |
| `RetrySeconds` | 300 | at least 1 second |

Worker logs use fixed safe messages only. They do not contain Tenant, author,
scope, draft, lease, recipient, body, or exception details.

## Deliberate non-goals

This contract does not implement CTA/link payloads, attachment upload or
delivery, cohorts, recipient delivery ledgers, analytics, recurring delivery,
cancel/revoke UI, or new announcement campaign models. It does not alter #382
local Preview, #383 attachment behavior, or #387 analytics.

## Focused verification recorded on this candidate

- `AnnouncementDraftServiceTests` (4/4) covers durable create and replay,
  immediate Draft -> Scheduled -> worker Published, IANA `Asia/Tokyo`
  resolution, scheduled worker publication, publish-time authorization loss,
  optimistic stale edits, and Tenant/author redaction.
- Angular editor tests (15/15) cover explicit Save draft, Preview, confirmation
  of immediate versus scheduled delivery, required local time, focus-safe
  review, and preserved form values.
- Angular facade and API adapter tests cover server-owned Draft endpoints,
  idempotency headers, queued immediate status rather than browser-synthesized
  publication, and exact schedule request serialization.

Final-head promotion still requires the relevant PostgreSQL migration and
concurrency gate plus repository-required CI. Mocked Angular tests prove only
UI interaction; they are not evidence of server authorization or worker
delivery.
