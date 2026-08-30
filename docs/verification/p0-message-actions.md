# P0 Message Actions: Issue #343

Status: implemented through the existing Message, canonical thread, and
participant-private saved Message contracts.

## Current-source action contract

- A visible confirmed Message presents `Reply`, `Save for later`, and `More`
  as direct, labelled buttons. They remain reachable without hover and retain
  44-pixel minimum targets on narrow/touch layouts.
- `Reply` opens the existing exact authorized same-Conversation thread surface.
  It does not create a new reply, invent a quoted-reply model, or bypass the
  thread read/post boundary.
- `Save for later` writes the existing participant-private Message follow-up
  through `PUT /api/me/message-follow-ups/{messageId}`. It is independent from
  read state and Conversation-level `Later`; no other participant can infer or
  manage the marker.
- `More` is a plain keyboard-operable disclosure, not an ARIA menu. It keeps
  lower-frequency `Edit`, `Delete`, and `Report` actions separate from the
  primary row actions. `Delete` remains behind an accessible destructive
  confirmation.
- Existing `PATCH /api/messages/{messageId}` is available only for an own
  confirmed Message while the current conversation projection permits posting.
  Existing `POST /api/messages/{messageId}/report` sends the deliberately
  generic `{ "reasonCode": "reported" }` request and does not claim a case or
  evidence workflow.
- Server authorization remains authoritative. The UI does not infer moderator
  capability; generic denial responses use one non-disclosing recovery message
  and never render raw backend error text.

## Deliberate boundaries

Issue #343 does not add React/reactions, Copy, a moderator capability
projection, a new Message endpoint, version-token edit preconditions/history,
the 24-hour sender-delete rule, general zero-reply tombstone retention, quoted
replies, emoji reactions, or a report evidence/case workflow. Those are
separate product/API contracts.

## Verification boundary

Focused Angular tests assert direct Reply/Save/More order and accessible names,
the private Save request and unchanged read state, exact PATCH/DELETE/Report
DTOs, generic error redaction/retry, confirmation-before-delete, and row
removal. Static Playwright exercises desktop keyboard and 320-pixel touch
activation for the primary actions and More, 44-pixel controls, focus return,
overflow separation, CSRF headers, and no raw error leak. Browser mocks verify
the UI contract only; the existing authorized thread and follow-up backend
tests remain the persistence and authorization evidence.
