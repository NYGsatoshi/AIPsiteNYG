# A-08 Communication Boundary Failure Log

Issue: A-08 - [MVP-A][P0][CommunicationBoundary] Verify conversation, DM, thread, participant, and message access boundary baseline

Date: 2026-06-29

Result: Needs verification

This failure log does not imply production approval, MVP-A Go, production readiness, or acceptance of unrelated MVP-A blockers.

## Summary

No confirmed unauthorized conversation/message body exposure was observed in the final focused A-08 HTTP verification pass. The focused HTTP tenant and communication-boundary test slice passed 11/11, and the full backend suite passed 138/138.

Three source-level communication boundary risks were found and fixed:

- a removed message author could still satisfy edit/delete authorship checks unless the code also required active conversation membership;
- read-state updates accepted a caller-supplied message ID without proving it belonged to the same conversation;
- message notifications embedded private message text in notification bodies for recipients.

The remaining A-08 limitations are verification blockers or missing implementation surfaces, not observed private-body leaks in the tested synthetic paths.

## Resolved During A-08

### Removed Participant Message Mutation

Failure area: message / participant boundary

Endpoint or code area: `ConversationAuthorizationService.CanEditMessage`, `ConversationAuthorizationService.CanDeleteMessage`, `PATCH /api/messages/{id}`, `DELETE /api/messages/{id}`

Actor: removed synthetic conversation participant who authored the seeded message

Expected result: removed participants cannot read, edit, or delete existing private messages unless an explicit product policy says otherwise.

Actual result before fix: author checks did not also require active conversation membership.

Sanitized response summary: no real or private message body copied.

Sanitized log summary: no runtime log body captured.

Data exposure risk: yes, integrity and boundary risk for removed participants.

Required fix: require active conversation visibility for author edit/delete checks and reject already-deleted messages.

Whether this blocks MVP-A: yes until fixed and tested.

Status: Resolved for tested synthetic path.

Evidence: focused HTTP tenant and communication-boundary tests passed 11/11.

### Cross-Conversation Read Cursor

Failure area: read receipt / unread cursor boundary

Endpoint or code area: `ConversationService.MarkReadAsync`, `POST /api/conversations/{id}/read`

Actor: active synthetic conversation participant submitting a message ID from another conversation.

Expected result: read cursor updates must only reference a message from the same conversation and must not reveal other conversation message bodies on denial.

Actual result before fix: the service stored the supplied message ID without loading it and comparing `ConversationId`.

Sanitized response summary: denial response after fix is generic and does not include the other conversation message body.

Sanitized log summary: no runtime log body captured.

Data exposure risk: yes, state integrity risk and possible cross-conversation inference.

Required fix: validate `LastReadMessageId` exists, belongs to the same conversation, and is not deleted before storing it.

Whether this blocks MVP-A: yes until fixed and tested.

Status: Resolved for tested synthetic path.

Evidence: `ConversationReadCursorMustReferenceMessageInSameConversation` passed in the focused test slice.

### Private Message Text In Notification Body

Failure area: notification body

Endpoint or code area: `ConversationService.SendMessageAsync`, `DbNotificationService`, `GET /api/notifications`

Actor: message recipient.

Expected result: message notifications should not embed private message text in notification body evidence or broad notification metadata unless explicitly classified and tested.

Actual result before fix: message notification body used a preview of the message text.

Sanitized response summary: no real message text copied. Synthetic regression now verifies generic notification body text and absence of the synthetic private message body.

Sanitized log summary: no runtime log body captured.

Data exposure risk: yes, notification body minimization risk.

Required fix: use a generic message notification body.

Whether this blocks MVP-A: yes until fixed and tested.

Status: Resolved for tested synthetic path.

Evidence: `MessageNotificationDoesNotEmbedPrivateMessageBody` passed in the focused test slice.

## Remaining Verification Blockers

### Fresh Runtime Communication Smoke

Failure area: live conversation, DM, message, participant, notification, and read-state runtime

Endpoint or code area: communication APIs on a fresh app baseline

Actor: approved synthetic admin, normal tenant member, conversation participant, non-participant, removed participant, and DM participant/non-participant

Expected result: direct runtime evidence for allowed and denied access without disabling auth or weakening authorization.

Actual result: not executed against a fresh running app in this pass.

Sanitized response summary: no live communication response body captured.

Sanitized log summary: no live runtime log captured.

Data exposure risk: unknown.

Required fix: resolve P0-001 with the smallest approved local/dev/test bootstrap path, then rerun A-08 runtime smoke without disabling auth.

Whether this blocks MVP-A: yes for A-08 acceptance.

Status: Needs verification

### Same-Tenant DM Non-Participant And Admin Policy

Failure area: DM body boundary

Endpoint or code area: direct conversations through `ConversationType.Direct`

Actor: DM participant, same-tenant non-DM participant, removed DM participant, admin non-participant, teacher/school admin if implemented

Expected result: only active DM participants can read DM body unless an explicit, tested product policy says otherwise.

Actual result: direct conversations use the same active participant guard, but the full same-tenant actor matrix was not completed in this pass.

Sanitized response summary: no DM body captured.

Sanitized log summary: no DM body captured.

Data exposure risk: unknown until explicit matrix is complete.

Required fix: add synthetic same-tenant DM actor tests and document admin/teacher/school-admin policy.

Whether this blocks MVP-A: yes for complete A-08 acceptance.

Status: Needs verification

### Thread Body Coverage

Failure area: thread body

Endpoint or code area: conversation thread endpoint, or channel post threads if they are intended to satisfy A-08 thread scope

Actor: thread participant and non-thread participant

Expected result: non-participants cannot read private thread bodies and thread IDs cannot be guessed to read private content.

Actual result: no dedicated conversation-thread endpoint was identified in this pass. Channel post threads exist separately but were not accepted as A-08 coverage.

Sanitized response summary: no thread body captured.

Sanitized log summary: no thread body captured.

Data exposure risk: unknown / feature gap.

Required fix: decide whether A-08 requires conversation threads. If yes, implement or map the thread model and add explicit access tests.

Whether this blocks MVP-A: Needs product classification; keep A-08 as Needs verification until resolved.

Status: Needs verification

### Realtime / Polling Delivery Boundary

Failure area: realtime / polling

Endpoint or code area: SignalR, WebSocket, subscribe/join-room, notification stream, or polling implementation

Actor: unauthenticated user, non-participant, removed participant, non-project member

Expected result: server-side membership controls subscription and event delivery; client-supplied conversation/project IDs are not trusted.

Actual result: no SignalR/WebSocket hub or room subscription surface was identified. Normal list endpoints exist and are authorization-gated, but no realtime delivery matrix was verified.

Sanitized response summary: no event body captured.

Sanitized log summary: no event body captured.

Data exposure risk: unknown for future realtime implementation.

Required fix: verify polling endpoints that exist and add realtime membership tests if a realtime hub is introduced.

Whether this blocks MVP-A: Needs verification for A-08 realtime scope; not an observed leak in this repo state.

Status: Missing / Needs verification

### Live Audit / Security Log Review

Failure area: audit/log leakage

Endpoint or code area: denied conversation read, denied message read/post, DM read denied, participant add/remove, thread create, notification read/delete, realtime subscribe denied

Actor: denied synthetic users across communication surfaces

Expected result: logs contain actor/resource/action/result/correlation style metadata only, not message body, DM body, thread body, token, cookie, or session identifier values.

Actual result: source inspection found audit metadata redaction for `body`, `messageBody`, token, cookie, secret, and related keys, but live runtime log capture was not performed in this pass.

Sanitized response summary: no private body copied.

Sanitized log summary: no log body copied.

Data exposure risk: unknown until live log matrix is complete.

Required fix: run sanitized live log review after approved synthetic identities exist.

Whether this blocks MVP-A: yes for complete A-08 acceptance.

Status: Needs verification

## No Observed P0 Communication-Body Leak In Final Focused Tests

The final focused test pass did not show these P0 leak examples in the tested synthetic paths:

- outsider reading seeded conversation message body;
- wrong-tenant context reading another tenant's seeded conversation message body;
- removed participant reading, editing, or deleting an existing seeded message after leaving;
- cross-conversation message ID being accepted as a read cursor;
- private message text being embedded in newly created message notification bodies;
- another user's notification being marked read.

This statement is limited to the tested synthetic paths and does not mark A-08 Accepted.
