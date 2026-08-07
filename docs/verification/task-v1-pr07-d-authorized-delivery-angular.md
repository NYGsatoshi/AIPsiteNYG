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
idempotent.

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
embedded notifications and PR07 reference-only Task/digest signals. The latter
cause a bounded/coalesced HTTP list refresh; no route/title/body is synthesized
from the durable event. It calls the open endpoint before navigation or local
read display, accepts only the returned canonical routes, and shows safe
Unavailable state without fallback navigation.

Task Detail, My Tasks, Project Detail/Kanban/Gantt, and Workspace preference
facades use approved durable events as coalesced HTTP invalidation triggers.
They retain active edit/conflict behavior and clear protected state on an
authorization boundary. The preference UI is Workspace-specific, uses the
PR07-A GET/PATCH endpoints with `expectedVersion`, refetches on `409`, accepts
only exact 15-minute values, and keeps no browser-storage/timezone authority.

## Focused evidence recorded during implementation

`dotnet test tests/AipPortal.Tests/AipPortal.Tests.csproj --configuration
Release --no-build --disable-build-servers -m:1 --filter "Scope=TaskV1PR07D"`
passed **28/28** with zero failed and zero skipped against an isolated
PostgreSQL 18 container. The focused suite includes a real PostgreSQL
read-state/Outbox atomicity test and dispatcher tests showing authorization
suppression terminates as `NoAuthorizedRecipient` and replay calls the same
authorization boundary. The manifest lists each focused name; CI verifies the
TRX, rejects duplicate active manifest entries, and passed locally with all
28 required names present.

`TaskNotificationCreatedPayloadIsReferenceOnly`,
`DigestNotificationCreatedPayloadIsReferenceOnly`, and
`NotificationCreatedDispatchRejectsWidenedReferencePayload` prove that the
approved schema is property-order independent and that a Task/digest signal
with an extra protected field is suppressed before delivery.

A prior source-level Angular subset that used an existing dependency tree is
historical supplementary evidence only; it is not clean worktree-local or
final-head acceptance evidence. During remediation, the repository's strict
Corepack npm 11.17 wrapper was attempted once and did not return output in the
bounded local run. No policy was weakened and no alternative install method was
used. Local full Angular verification is therefore **UNVERIFIED**; hosted
`frontend-test` is authoritative.

## Verification still required before merge

- PostgreSQL provider tests with no skipped cases, including delayed/replay
  revoke, Notification ownership/tenant isolation/soft-delete, read-state
  Outbox atomicity, and Workspace archive rollback atomicity.
- Hosted HTTP/SignalR evidence for current authorization and
  `NoAuthorizedRecipient` terminal behavior.
- Full backend test suite. The EF pending-model check and final required-manifest
  TRX verification passed locally. One full-suite attempt did not return a
  result within the bounded local run, so `LOCAL_FULL_BACKEND=UNVERIFIED`.
- Worktree-local Angular unit/type/architecture/build/Storybook/Playwright and
  Linux Docker screenshot validation.
- Hosted PR workflows and independent code/merge audit.

No migration, model-snapshot, NuGet, npm, package, or lockfile change is part
of this scope. PR07-E, PR08, feature enablement, PR06B, new event families,
and Qodana gate repair remain explicitly out of scope.
