# Issue #134 Notification / ReadState closure audit

Audit date: 2026-09-02

Baseline: `main` at `42b8e9e88b2474ed778ef07dcd0dc6d052b8b706`

Legacy umbrella: #134 `[P0][Notification/ReadState] 通知・未読管理・既読化を完成させる（実装デバッグ後）`

## Scope decision

Issue #134 was closed as `not_planned` after its work was decomposed into narrower communication, notification, announcement, feedback, and frontend work. This audit does not reopen the old umbrella as a new feature bucket. It checks the original P0 boundary against the current implementation, distinguishes implemented requirements from explicitly superseded legacy scope, and fixes the remaining notification-persistence blocker found by that audit.

Later P1/P2 enhancements are not promoted into the old P0 closure. In particular, later task-comment notification work is tracked separately and remains governed by its own issue/priority.

The original #134 bullet for feedback-post notifications is not claimed as implemented here. Feedback creation/list/UI/notification work was consolidated into #142, and #142 was subsequently closed as `not_planned`. Current source retains the `Feedback` entity and legacy notification type mapping, but this audit found no current Feedback API/notification producer. It is therefore recorded as **SUPERSEDED**, not PASS and not silently reintroduced by this PR.

## Acceptance matrix

| Original #134 acceptance boundary | Current evidence | Audit result |
| --- | --- | --- |
| Current in-scope producers notify relevant recipients | DM/message delivery, Announcement publish/delivery, Task notification producer, and Artifact notification producer feed the shared notification service | PASS, subject to persistence-limit fix below |
| Legacy Feedback-post notification hook | Consolidated into #142; #142 is closed `not_planned`; no current Feedback API/producer is claimed | SUPERSEDED |
| A user can list only their own notifications | `DbNotificationService.ListAsync(userId, ...)` scopes by recipient and current target authorization | PASS |
| A user can mark a notification read | `DbNotificationService.MarkAsReadAsync` requires both notification ID and current user ID and rechecks target visibility | PASS |
| Notification target navigation is reauthorized | `NotificationOpenService` / current target resolution and communication polling fail closed when a target is no longer available | PASS |
| DM/conversation unread state is persisted per participant | `ConversationMember` / `ReadState`, participant-state API, `ConversationService.MarkReadAsync` | PASS |
| A supplied read cursor belongs to the same conversation | `ConversationService.MarkReadAsync` validates the cursor through `ValidateReadableConversationMessageAsync` before advancing state | PASS |
| Marking read does not mutate another user's state | conversation/member and notification mutations are keyed by the current user | PASS |
| Unread polling includes only actor-readable conversations | `MessagingRepository.ListForUserAsync` composes the authoritative readable-conversation relation; `CommunicationPollingService` rechecks readability and active participation | PASS |
| Channel/announcement read state can be saved | project-channel conversations use participant read state; announcements use `AnnouncementRead` and `AnnouncementService.MarkReadAsync` | PASS |
| Notification/unread UI has an API binding | current Angular binding verification maps the app-shell notification surface to list/unread/open/read/read-all/delete/polling APIs | PASS |

## Producer audit

The original umbrella mixed the shared notification mechanism with several domain-specific producers. The current-source audit found:

- **DM/message:** `ConversationService` invokes notification delivery for message recipients.
- **Announcement:** `AnnouncementDraftService` creates recipient-specific logical notifications on publication; `AnnouncementService` also supports unread reminders.
- **Task assignment/status/deadline family:** `TaskNotificationProducer` and the Task notification staging primitives are present with dedicated regression coverage.
- **Artifact:** `ArtifactService` invokes notification delivery for authorized project roles.
- **Feedback:** no current producer is claimed; the feature bucket was moved to #142 and later closed `not_planned`.

This distinction matters: the current #134 closure is a closure of the **canonical surviving P0 boundary**, not a statement that every bullet in the abandoned June umbrella was eventually implemented unchanged.

## Audit finding fixed by this candidate

### Notification text could exceed persistence limits

`NotificationConfiguration` persists:

- `Title` with maximum length 200;
- `Body` with maximum length 2000.

The notification creation path historically trimmed producer text but did not guarantee those persistence limits. Event/form source fields can legally exceed the notification columns, and other producers share the same persistence primitive, so an otherwise valid business mutation could fail while deriving its notification.

This candidate makes the `Notification` entity enforce the same limits at the persistence/domain boundary for every producer, including direct construction paths. Truncation is Unicode-scalar aware so it does not cut a UTF-16 surrogate pair in half.

`Notification.TitleMaximumLength` and `Notification.BodyMaximumLength` are also checked against EF model metadata by regression tests so the policy cannot silently drift from the database mapping.

## Regression coverage

`NotificationPersistenceLimitTests` verifies:

1. `DbNotificationService.CreateAsync` accepts over-limit Unicode title/body input and the tracked notification is clamped to the configured limits;
2. truncation preserves complete Unicode scalar values;
3. the domain constants match EF Core `HasMaxLength` metadata;
4. the clamped entity can be saved by the test persistence provider.

Existing communication polling tests continue to cover removed-participant exclusion, recipient-only notification shaping, private-message body minimization, cursor scope, and restricted notification targets.

## Defense-in-depth note

`CommunicationPollingService.GetUnreadCountsAsync` returns the repository page's `TotalCount`. The production `MessagingRepository.ListForUserAsync` computes that total after applying the authoritative readable-conversation relation, so no production count leak was found. The service also reauthorizes each returned row. A fake repository can deliberately violate the repository contract and make the service-level `Items` defense filter a row while preserving the fake total; that is a defense-in-depth test opportunity, not a confirmed current production blocker for #134.

## Stale audit note

`docs/BACKEND_LOGIC_AUDIT.md` still describes BE-008 as an active cross-conversation read-cursor gap, but the current `ConversationService.MarkReadAsync` validates the supplied cursor before advancing participant/read state. The older A-08 failure log also records that fix and its focused regression.

BE-011 is the remaining notification-persistence issue addressed by this candidate. Treat this closure record plus the candidate diff/test evidence as the current Issue #134 audit result; the broad historical audit file should be refreshed in a later audit-maintenance pass rather than expanding this bounded P0 closure PR with unrelated BE findings.

## Exit decision

Current canonical Issue #134 P0 boundary: **PASS after this candidate's notification-persistence regression is green.**

Literal historical Feedback-post coverage is **SUPERSEDED**, not implemented-by-claim. Non-blocking later work remains in its own issues and is not silently absorbed into #134.
