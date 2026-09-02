# Issue #134 Notification / ReadState closure audit

Audit date: 2026-09-02

Baseline: `main` at `42b8e9e88b2474ed778ef07dcd0dc6d052b8b706`

Legacy umbrella: #134 `[P0][Notification/ReadState] 通知・未読管理・既読化を完成させる（実装デバッグ後）`

## Scope decision

Issue #134 was closed as `not_planned` after its work was decomposed into narrower communication, notification, announcement, and frontend work. This audit does not reopen the old umbrella as a new feature bucket. It checks the original P0 acceptance boundary against the current implementation and fixes only a remaining notification-persistence blocker found by that audit.

Later P1/P2 enhancements are not promoted into the old P0 closure. In particular, later task-comment notification work is tracked separately and remains governed by its own issue/priority.

## Acceptance matrix

| Original #134 acceptance boundary | Current evidence | Audit result |
| --- | --- | --- |
| Relevant recipients can receive notifications | `Notification`, `NotificationUserState`, `DbNotificationService`, preference-aware message delivery, task notification producers | PASS, subject to persistence-limit fix below |
| A user can list only their own notifications | `DbNotificationService.ListAsync(userId, ...)` scopes by recipient and current target authorization | PASS |
| A user can mark a notification read | `DbNotificationService.MarkAsReadAsync` requires both notification ID and current user ID and rechecks target visibility | PASS |
| Notification target navigation is reauthorized | `NotificationOpenService` / current target resolution and communication polling fail closed when a target is no longer available | PASS |
| DM/conversation unread state is persisted per participant | `ConversationMember` / `ReadState`, participant-state API, `ConversationService.MarkReadAsync` | PASS |
| A supplied read cursor belongs to the same conversation | `ConversationService.MarkReadAsync` reloads the cursor message and rejects missing/deleted/cross-conversation cursors | PASS |
| Marking read does not mutate another user's state | conversation/member and notification mutations are keyed by the current user | PASS |
| Unread polling includes only actor-readable conversations | `MessagingRepository.ListForUserAsync` composes the authoritative readable-conversation relation; `CommunicationPollingService` rechecks readability and active participation | PASS |
| Channel/announcement read state can be saved | project-channel conversations use participant read state; announcements use `AnnouncementRead` and `AnnouncementService.MarkReadAsync` | PASS |
| Notification/unread UI has an API binding | current Angular binding verification maps the app-shell notification surface to list/unread/open/read/read-all/delete/polling APIs | PASS |

## Audit finding fixed by this candidate

### Notification text could exceed persistence limits

`NotificationConfiguration` persists:

- `Title` with maximum length 200;
- `Body` with maximum length 2000.

The notification creation path historically trimmed producer text but did not guarantee those persistence limits. Event/form source fields can legally exceed the notification columns, so an otherwise valid business mutation could fail while deriving its notification. That violates the old #134 requirement that relevant operations actually create their notifications.

This candidate makes the `Notification` entity enforce the same limits at the persistence/domain boundary for every producer, including direct construction paths. Truncation is Unicode-scalar aware so it does not cut a UTF-16 surrogate pair in half.

`Notification.TitleMaximumLength` and `Notification.BodyMaximumLength` are also checked against EF model metadata by regression tests so the policy cannot silently drift from the database mapping.

## Regression coverage

`NotificationPersistenceLimitTests` verifies:

1. `DbNotificationService.CreateAsync` accepts over-limit Unicode title/body input and the tracked notification is clamped to the configured limits;
2. truncation preserves complete Unicode scalar values;
3. the domain constants match EF Core `HasMaxLength` metadata;
4. the clamped entity can be saved by the test persistence provider.

Existing communication polling tests continue to cover removed-participant exclusion, recipient-only notification shaping, private-message body minimization, cursor scope, and restricted notification targets.

## Stale audit note

`docs/BACKEND_LOGIC_AUDIT.md` still describes BE-008 as an active cross-conversation read-cursor gap, but the current `ConversationService.MarkReadAsync` implementation already reloads and validates the cursor message. The older A-08 failure log also records that fix and its focused regression.

BE-011 is the remaining notification-persistence issue addressed by this candidate. Treat this closure record plus the candidate diff/test evidence as the current Issue #134 audit result; the broad historical audit file should be refreshed in a later audit-maintenance pass rather than expanding this P0 closure PR with unrelated BE findings.

## Exit decision

Issue #134 legacy P0 boundary: **PASS after this candidate's notification-persistence regression is green.**

Non-blocking later work remains in its own issues and is not silently absorbed into #134.
