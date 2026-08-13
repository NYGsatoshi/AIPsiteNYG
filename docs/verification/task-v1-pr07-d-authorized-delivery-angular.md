# TASK-V1-PR07-D — authorized delivery and Angular reconciliation

## Scope and immutable inputs

- Implementation branch: `task/v1-pr07-d-authorized-delivery-angular-reconciliation`
- Starting implementation main: `8d0b8b20551076ecd73ead06aced4b80c94749e7`
- PR07-C prerequisite: merged and accepted as PR #277 at
  `8d0b8b20551076ecd73ead06aced4b80c94749e7`
- Canonical specification main: `8b90c8897367606473515d17d3696e458b2ee7b5`
- Feature flag: `tasks.notificationsV1` remains default-disabled. This change
  neither enables it nor treats any realtime/outbox flag as authorization.

## Implemented boundary

`CurrentAuthorizationTargetResolver` is the shared current-state boundary for
notification opening and dispatch authorization. It resolves only safe outcome
metadata. It checks current tenant/user/TenantUser, Workspace/member,
Project visibility/lifecycle, Task lifecycle, digest-job identity, and routing
identity immediately before dispatch or open. A persisted route, historical
Outbox membership, or broad subscription cannot grant access.

`RealtimeDispatchAuthorizer` applies that resolver to the approved Task,
Project, NotificationCreated, NotificationReadStateChanged, and
AuthorizationStateChanged event families. Normal dispatch and replay use the
same dispatcher path. A suppression is delivered as the existing terminal
`NoAuthorizedRecipient` outcome instead of a retry/DeadLetter transition.

`POST /api/notifications/{notificationId}/open` is recipient-owned. Another
recipient and a missing row have the same safe not-found behavior. A current
Task returns `/projects/{projectId}/tasks/{taskId}`. A current digest returns
`/tasks` and typed authorized Workspace context; it never returns a digest Task
list. Unavailable target states return no protected detail and do not mutate
read state. An authorized unread open advances recipient state and stages the
recipient-only read-state Outbox event in the same transaction; repeat open is
idempotent. This endpoint is navigation authority only for `Task`, `TaskItem`,
and `TaskDeadlineDigest`; it is not a replacement for legacy notification
navigation.

Workspace archive captures active members before lifecycle mutation and stages
one metadata-only recipient `Security.AuthorizationStateChanged.v1` event per
affected user in the same business unit of work as archive/audit.

## Angular reconciliation

`RealtimeFacade` remains the only SignalR transport/reconnect/catch-up owner.
It clears registered protected state, active Workspace, and short-lived
authorized navigation context before subscription reauthorization and HTTP
catch-up after an authorization invalidation. Logical feature subscription
registrations remain desired across an authorization loss and are
reauthorized on reconnect; only the currently authorized transport state is
cleared. Tenant switch and logout discard the previous scope's desired
registrations. RightPanel supports legacy
embedded notifications and PR07 reference-only Task/digest signals. Legacy
supported targets retain their existing safe mapped Angular route plus existing
read-PATCH contract; they do not call the Task/digest open endpoint. Task and
digest signals cause a bounded/coalesced HTTP list refresh; no route/title/body
is synthesized from the durable event. Task/digest navigation calls the open
endpoint, accepts only the returned target-specific canonical route (and, for a
digest, server-authorized Workspace context), and shows safe Unavailable state
without fallback navigation. An authorization clear advances the RightPanel's
list-request generation, so an HTTP response that began before revocation
cannot restore a protected Task projection afterward.

Task and digest notifications are also filtered from the authoritative list,
unread count, and legacy read/delete mutations when their current target is no
longer authorized. This closes the otherwise unsafe clear-then-refetch race.
`NotificationOpenService` derives a read-state event's `unreadCount` through
the same bounded current-visibility scan used by the HTTP unread-count service,
so an unread but now-hidden Task/digest row cannot inflate the delivered count.
Legacy generic recipient notifications retain their existing embedded-created
and read-state event contracts, but Task/digest dispatch remains fail-closed
against any widened payload.

Task Detail, My Tasks, Project Detail/Kanban/Gantt, and Workspace preference
facades use approved durable events as coalesced HTTP invalidation triggers.
They retain active edit/conflict behavior and clear protected state on an
authorization boundary. The preference UI is Workspace-specific, uses the
PR07-A GET/PATCH endpoints with `expectedVersion`, refetches on `409`, accepts
only exact 15-minute values, and keeps no browser-storage/timezone authority.

## Focused evidence recorded during implementation

The focused `Scope=TaskV1PR07D` manifest now contains **32** required test
names. It includes the PostgreSQL read-state/Outbox atomicity case with one
visible unread Notification plus one current-unavailable unread Task
Notification. That case proves the current-visible unread count is one before
open, the delivered read-state event reports zero after opening the visible
row, and the unavailable row remains unread and hidden. CI verifies the TRX
and rejects duplicate, missing, skipped, failed, aborted, or not-executed
required names.

`TaskNotificationCreatedPayloadIsReferenceOnly`,
`DigestNotificationCreatedPayloadIsReferenceOnly`, and
`NotificationCreatedDispatchRejectsWidenedReferencePayload` prove that the
approved schema is property-order independent and that a Task/digest signal
with an extra protected field is suppressed before delivery.

The repository's strict Corepack npm 11.17 wrapper passed in a clean linked
worktree, and the focused RightPanel Angular suite passed locally. The host's
Node 24.13 runtime remains below the repository's Node 24.15+ requirement and
emits the documented engine warning, so local full Angular acceptance remains
**UNVERIFIED**; hosted `frontend-test` is authoritative.

The existing Test-environment Real Backend Browser Smoke now contains one
bounded PR07-D scenario. Its fixture is mapped only when the pre-existing
browser-smoke Test opt-in and response-gate opt-in are both enabled; it uses
the production `INotificationService`, transactional Outbox, dispatcher,
SignalR client, notification-open endpoint, and PostgreSQL persistence without
turning on `tasks.notificationsV1`. It creates an authorized Task notification
after a reconnect, opens the returned project/task route, stages a second
event for delayed dispatch, revokes the recipient's dedicated Project access,
then proves a clear RightPanel, safe `Unavailable` open, hidden list rows, and
terminal `NoAuthorizedRecipient` delivery. It is intentionally one focused
two-user boundary scenario, not the broad PR07-E all-event acceptance suite.

The existing manual `Real Backend Browser Smoke` workflow accepts an optional
`playwright_grep` input. It passes the selector to the same Compose-hosted
runner rather than creating another realtime harness; an empty selector keeps
the established full smoke behavior. The PR07-D completion run selects the
bounded `TASK-V1-PR07-D` scenario on the exact branch head.

## Exact-final-head evidence protocol

All code, test, and documentation changes are committed before Hosted
validation. After that final commit is pushed, no source change is made before
the required workflows and Real Backend runs complete. Exact-final-HEAD hosted
run identities are recorded in PR #279 body so recording them does not mutate
the evidence-bearing commit.

## Verification required before independent re-audit

- PostgreSQL provider tests with no skipped cases, including delayed/replay
  revoke, Notification ownership/tenant isolation/soft-delete, read-state
  Outbox atomicity, and Workspace archive rollback atomicity.
- Hosted focused Real Backend Browser Smoke evidence for the bounded
  current-authorization/reconnect/open/revocation scenario above. The run
  must be on the exact final code head and does not substitute for PR07-E's
  broader two-user all-event acceptance.
- Full backend test suite. The EF pending-model check and final required-manifest
  TRX verification passed locally. One full-suite attempt did not return a
  result within the bounded local run, so `LOCAL_FULL_BACKEND=UNVERIFIED`.
- Worktree-local Angular unit/type/architecture/build/Storybook/Playwright and
  Linux Docker screenshot validation.
- Hosted PR workflows and independent code/merge audit.

No migration, model-snapshot, NuGet, npm, package, or lockfile change is part
of this scope. PR07-E, PR08, feature enablement, PR06B, new event families,
and Qodana gate repair remain explicitly out of scope. PR07-E remains blocked
until PR07-D is independently accepted and merged, followed by post-merge
`main` verification.
