# Issue #368 saved Message follow-up verification

## Contract

- A saved Message is a participant-private row unique by Tenant, user, and
  Message. It is not conversation-level `IsLater` and is not read state.
- Save and complete are idempotent, including database uniqueness/deletion
  races, but reauthorize the target before inspecting the private row.
- List rows and totals apply current readable-Conversation authorization before
  paging. Revoked, removed, deleted, nonparticipant, and cross-Tenant targets
  are non-disclosing.
- Opening a row loads an authorized anchor so an older Message is present and
  focused. A reply carries its canonical root, opens the authorized thread, and
  focuses the exact reply. The thread request includes that non-deleted exact
  reply plus the newest 99 other replies when it falls outside the ordinary
  latest-100 window; invalid or mismatched anchors are non-disclosing.
- Reminder scheduling is deferred. There is no reminder timestamp, timezone,
  delivery, retry, or cancellation contract in current source.

## Automated gates

- `dotnet test ... --filter "Scope=Issue368"` covers Kestrel/EF InMemory HTTP
  privacy, idempotency, revocation, exact timeline and reply-anchor behavior,
  deleted/mismatched/cross-Tenant anchor denial, the unchanged 100-reply bound,
  and read-state independence. The PostgreSQL cases are conditional on
  `POSTGRES_TEST_CONNECTION_STRING`.
- Focused Angular specs cover the follow-up facade, Saved messages page, shared
  Message action wiring, anchored thread API request, refresh preservation, and
  truthful bounded-state label.
- `tests/ui/message-follow-ups.spec.ts` covers the forced 320-pixel keyboard,
  exact focus on a reply outside the latest window, CSRF completion, axe, and
  overflow flow.
- Production Angular build and the normal broader Messaging/backend suites are
  required before merge.

## Evidence limits

- Mocked Angular Playwright does not prove browser/backend integration.
- An environment-skipped PostgreSQL run is not database evidence; required CI
  must execute it with the configured service.
- No reminder behavior is claimed or tested.
