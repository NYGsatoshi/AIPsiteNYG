# Security Model

Last broad implementation audit: 2026-06-18. WPC-02B Workspace-create
security-boundary update: 2026-08-24. WS-02 active-Workspace and WS-03
Workspace-create client-boundary update: 2026-08-24.

This document separates implemented security controls from intended policy. Root `SECURITY.md` describes vulnerability reporting; `docs/SECURITY.md` contains additional engineering guidance.

## Trust boundaries

- Browser or API client to ASP.NET Core.
- ASP.NET Core to PostgreSQL.
- ASP.NET Core to file storage.
- Tenant to tenant.
- Platform administration to tenant administration.
- Authenticated user to resource-level membership.

## Authentication

### Implemented

- Cookie authentication in `Web/Program.cs`.
- PBKDF2 password hashing in `Infrastructure/Security/Pbkdf2PasswordHasher.cs`.
- Generic login failures.
- Configurable persisted lockout for existing users.
- Database session records with expiry, revocation, and last-seen tracking.
- Cookie principal validation on authenticated requests.
- Logout and password-change session revocation behavior.
- Suspended, archived, or deleted users cannot continue using an old cookie.

### Partially implemented

- Invite registration validates a hashed invite token and creates a user/session, but it does not create tenant or workspace membership.
- A fresh deployment can create its first administrator only through the explicit `AIP_SEED_ADMIN_*` startup seed.

### Planned

- Password reset token creation/delivery.
- MFA and external SSO.
- API token request authentication.

## CSRF and cookies

When enabled:

- antiforgery token endpoint: `GET /api/security/csrf-token`;
- header: `X-CSRF-Token`;
- unsafe methods are validated globally;
- auth and antiforgery cookies are HttpOnly, SameSite=Lax, and use the configured secure policy.

The static frontend fetch helper automatically obtains and sends the token.

CSRF tests use a real Kestrel HTTP listener with EF InMemory.

## Authorization

Controllers provide coarse `[Authorize]` checks. Resource authorization is generally implemented in application services.

Role layers:

- `SystemRole.PlatformAdmin` is the platform role.
- `SystemRole.SystemAdmin` is a deprecated enum alias with the same numeric value.
- `TenantUserRole.Owner/Admin` controls tenant administration.
- Workspace, group, channel, conversation, and project roles control resource operations.

Known limitation: controllers commonly return `400` for application authorization/not-found failures, so HTTP status semantics are inconsistent. The WPC canonical routes have a narrow full-envelope exception for Workspace capability/create and its pre-controller boundary, masked Project detail, canonical Project create/activation, and Project lifecycle conflicts; this is not a repository-wide migration.

### WPC-02B and WS-03 Workspace creation boundary

Workspace creation is authorized against current persisted Tenant state. An
active, non-deleted user may create in the current active Tenant when either:

- the current Tenant membership is active `Owner` or `Admin`; or
- the user has a current, non-revoked, non-expired `workspace.create` grant
  whose scope type is `Tenant` and whose scope ID is the current Tenant.

The grant evaluator revalidates the subject user, Tenant membership, Tenant
lifecycle, current Tenant scope, grant version, grant time, expiry, and
revocation for every decision. Ordinary Tenant membership is insufficient, and
a platform/SystemAdmin role is not an undocumented Tenant bypass. The backend
publishes the same current decision through
`GET /api/workspaces/capabilities`; frontend role labels and hidden controls
are not authority. `canCreate` also requires the canonical server initializer
to be available, so a missing persistence-backed default-Conversation
dependency fails closed.

Production `POST /api/workspaces` accepts only client-owned `name`, optional
`description`, and optional `icon`. The Tenant, creator, Workspace ID, and
internal slug are server-owned. Duplicate display names are allowed and do not
become an authorization identity. One relational transaction commits the
idempotency claim, active Workspace, creator's active Workspace `Owner`
membership, canonical public-within-scope `WorkspaceGeneral` Conversation,
creator Conversation administrator participation, `WorkspaceCreated` audit,
and required authorization Outbox events. Required initialization or Outbox
staging failure rolls the transaction back rather than leaving a partial
Workspace.

Create retry identity is scoped by Tenant, authenticated actor, operation, and
a SHA-256 hash of the client identity. The normalized request fingerprint is
also hashed. Reconciliation re-runs current authorization and queries through
current Tenant filters. A key cannot authorize another Tenant, actor, or
operation. The idempotency record stores neither the raw key nor a copy of the
raw JSON request; it stores hashes while the normal Workspace resource fields
are persisted. Replay requires the same actor's current active Workspace
membership; a revoked actor cannot recover protected metadata through the
Platform/SystemAdmin Workspace view shortcut.

The WS-03 browser candidate treats `canCreate` only as an entry-point and
preflight presentation gate; the POST denial remains authoritative. It keeps
one in-memory `Idempotency-Key` for the same authenticated Tenant/user and
canonical trimmed payload across close/reopen and uncertain network, 5xx, or
malformed-success retries. A changed payload or authenticated identity receives
a different key. The client accepts only a structurally verified HTTP 201
envelope before recording a committed resource. It then refreshes the
authorized Workspace list and activates the returned ID only through the WS-02
selection boundary. If that post-commit list or selection step fails, the
`committedPendingActivation` recovery path performs GET/reconciliation and
selection only; it never repeats the create POST.

An authorization-state invalidation is never delayed or dropped. It clears the
create projection immediately. If it wins before browser POST dispatch, no
create outcome is claimed: the user must re-read authorized create options and
explicitly resubmit the same canonical payload, retaining the original opaque
key. If it wins after dispatch but before the accepted response, the outcome is
treated as uncertain and the same key is retained for user-led reconciliation.
Neither path automatically repeats the POST. Session, Tenant, and Workspace
boundaries discard the attempt rather than resuming it.

### WS-02 active Workspace client boundary

The client resolves an active Workspace only from the latest backend-authorized
active Workspace projection. Candidate IDs are considered in this order:

1. an explicit Workspace ID in the current Workspace route, if that ID is in
   the authorized projection;
2. the last-used local preference for the current `{tenantId, userId}`, if it
   is still in that projection;
3. the sole authorized active Workspace, when exactly one is available; or
4. an explicit user selection from the authorized projection.

The client never selects API row zero when multiple Workspaces are available.
`AuthService` likewise publishes `currentWorkspace` only when exactly one
authorized active Workspace exists. A stale, archived, revoked, cross-scope,
or otherwise absent local preference is discarded during reconciliation. An
invalid route value is not authority and cannot make an unauthorized Workspace
active.

The browser preference key is partitioned by Tenant and user. It stores only an
opaque Workspace ID and is UX state, not an authorization grant. Local-storage
absence or read/write/remove failure fails closed and does not bypass the
backend list, resource authorization, or current Tenant scope. Header action
visibility is also presentation only: for example, Members is shown from the
backend `canOpenMembers` projection, while the destination remains protected by
server authorization.

Before a different Workspace is activated, the client synchronously clears the
old active Workspace and registered protected projections. Current owners clear
Project/Task, Messaging, File/picker/download, notification/right-panel, and
private per-Workspace settings projections together with old scope IDs and
in-flight request generations. Workspace-, Project-, and Conversation-scoped
realtime intents and authorized groups are removed; a late authorization result
for a removed intent is immediately unsubscribed. The same authenticated
Tenant/user transport may remain connected, but it cannot retain the old
resource subscriptions. If navigation away from an old Workspace-specific
route fails, an explicit switch does not activate the new Workspace.

The dashboard's `runningProjectCount` and `needsReviewProjectCount` are
backend-authorized aggregate projections for visible `Active` and `Review`
Projects. The legacy `inProgressProjectCount` is retained as their sum. The
header distinguishes an authoritative numeric zero from unavailable projection
data and does not derive Project visibility or Research authorization from the
counts.

### WPC-02 Project security status

WPC-02A persists canonical Project Visibility and activation provenance. Legacy
rows remain explicitly unclassified; authorization never infers a broader
Visibility or activation history for them. WPC-02C provides the canonical,
idempotent Workspace-scoped create command. It requires current active Tenant
and Workspace membership plus Workspace governance authority, a current
Workspace-scoped `project.create` grant, or management of the bound Group.
Selecting a non-default Visibility additionally requires Workspace governance
authority or a current `project.visibility.manage` grant. No platform role,
including SystemAdmin, bypasses those current resource boundaries.

WPC-02D provides the explicit first-activation command. It requires current
Project management authority, a matching positive Project version, an active
Workspace, canonical Visibility, and a `NeverActivated` Planning Project. One
serializable transaction provisions ProjectGeneral and the Task workflow,
records activation provenance and lifecycle state, writes audit and durable
authorization events, and commits only when every required effect succeeds.
The deprecated unscoped `POST /api/projects` remains disabled, and generic
lifecycle update cannot bypass the activation command. Generic
`Planning -> Active`, `Suspended -> Planning`, and `Suspended -> Active`
are therefore rejected outside that command.
`Planning -> Suspended` and `Suspended -> Archived` remain available. `Review -> Active`
remains the ordinary return from a lifecycle state whose production inbound
path proves prior operation, and metadata-only Active or Suspended updates may
retain their state. Every missing generic lifecycle edge returns 409
`InvalidStateTransition`, target `body.status`, before metadata/lifecycle
mutation, success audit, ProjectChanged or authorization invalidation, or save.
Archived/Deleted recovery cannot safely choose Planning or Active and fails
closed without deletion-metadata mutation. Planning and Suspended require
current Workspace access plus explicit Project membership. Archived/Deleted
rows are read-only through generic update. The ordinary Project archive path
cannot produce a second success side effect; an otherwise-authorized explicit
Project manager receives the same typed conflict on repetition.

Issue #409 adds presentation projections without moving authority into the
browser. `GET /api/workspaces/{workspaceId}/projects/create-options` returns
the exact current Workspace-root create bit, allowed Visibility values, and
only active Groups where the actor can create. The Workspace dashboard's
separate `canOpenProjectCreate` bit may expose the full dialog for a
Group-manager-only actor; the existing `canCreateProject` bit retains its
ungrouped Quick Create meaning. A false/empty options response is an
authoritative denial, not malformed data. Every POST re-runs the canonical
Tenant, Workspace, Group, grant, and Visibility checks.

Project list and detail responses expose `canActivate` only for a canonical
Planning, `NeverActivated` Project that the current actor can manage inside an
active Workspace. It is an affordance only: activation independently checks
the current positive version and all resource authority. The client does not
load Task, Kanban, Gantt, workload, or membership projections for that Draft.
It accepts a command result only through the strict WPC envelope and then
refetches authoritative Project state before enabling operational views. A
committed create or activation is recorded before any authorization
invalidation or follow-up read; recovery never repeats the committed mutation.

Project detail, every Project-derived Search category, and the non-Archived
Project list scope use equivalent current read predicates. Non-deleted Archived history is
list-only for an active Workspace member who is also an explicit Project
member; detail, Search, and subordinate reads stay hidden. The shared
SQL-translatable scope protects Project, Task, Artifact, ActivityLog, Comment,
and project-bound Message results and does not introduce a global SystemAdmin
bypass. My Tasks and Messaging apply that Project boundary plus their own
stricter current-membership/relationship requirements. Digest evaluation,
authorization-target resolution, and realtime delivery remain equally strict
or stricter. Historical Conversation membership and Outbox routing are not
authority. Production PostgreSQL Conversation
detail/list/count, unread/update polling, and Message Search use one set-based
recursive ancestry boundary. Missing identity, inconsistent Workspace/Project/
root scope, cycles, and ancestry beyond 32 Thread edges fail closed. Send,
moderate, and Thread-create checks require that structural read boundary;
creation cannot persist an immediately unreadable child, and protected fields
are materialized only after that boundary. PostgreSQL Message Search composes
the shared readable-ID relation over all matching Messages before deterministic
`CreatedAt DESC, Id ASC` ordering and the final bound, rather than authorizing
an arbitrary Conversation subset first. Delayed
`Messaging.ConversationUnreadChanged.v1` delivery parses its Conversation
identity and rechecks current Conversation/Project authorization.

WPC-02A persists `WorkspaceVisible`, `MembersOnly`, and `Restricted` and the
current Project read boundary enforces those values. Pre-migration `NULL`
Visibility remains an explicit legacy compatibility state; it is never
reclassified from lifecycle, Group, membership, audit, or child data. The WPC
error boundary uses fixed public messages, empty details, masked targets, and
`redactionApplied`. The registered canonical `IRedactionService` is applied at
the adopted WPC response and export boundaries after record-level
authorization; redaction cannot widen access or substitute for that check.

### Message notification preference boundary

Global Message notification delivery is private state scoped to the current
authenticated user and active Tenant membership. The API derives both IDs from
the server request context, and the persistence store includes both IDs plus
active membership status in every read and update. Cross-Tenant, inactive,
missing, and platform scope fail closed with the same generic result.

Before an ordinary or mention Message notification row is staged, the server
rechecks that the Message belongs to the current Tenant and is not deleted,
that the recipient is a current readable Conversation participant, that the
Conversation participant is not muted, and that the recipient's global Message
preference is enabled. These preferences do not grant Conversation access and
do not suppress Message persistence, unread state, or realtime conversation
events. Browser unread-badge visibility is presentation-only and is not a
security control.

### Task-list Artifact availability boundary

The Project Task-list endpoint checks the current actor's canonical
`CanViewProject` predicate before reading Artifact state. After that check, one
Project-scoped, `AsNoTracking` projection returns distinct Task IDs linked to
non-deleted Artifacts. Deleted, unlinked, and other-Project rows are excluded.
The response exposes only `hasArtifact`; it never exposes an Artifact ID,
name, count, type, status, version, file, or storage field. The browser cannot
derive or expand this signal, and hiding an indicator is not authorization.

Blocked is independent of Workflow Stage. The API preserves the configured
Stage display name and serializes the fixed category as one of Backlog, Todo,
InProgress, Review, Done, or Cancelled. It does not transform a digest-job
`Failed` state into a Task state.

### Task execution source-scope foundation boundary

Issue #357's Task execution foundation is not an execution or retrieval
feature. The current Project-read boundary protects scope reads. The current
Project-management boundary protects Project default changes, Task override
changes, and immutable run requests; a browser role, Task assignee state, or
hidden control is never authority. Missing, cross-Tenant, deleted, and denied
Project/Task identities return the generic not-found result.

Only the effective two-boolean policy (`WebEnabled` and
`ProjectFilesEnabled`), its origin/version, and a safe latest policy snapshot
are projected. The API, audit metadata, realtime invalidations, and runtime
handle exclude URLs/hosts, source or file IDs/names/counts, raw source/file
content, credentials, storage keys, prompts, provider configuration, and
outputs. Required audit staging is fail-closed, and the database guards copied
Tenant/Workspace/Project scope plus append-only immutable run snapshots.

The only runtime port is deterministic unavailable/no-I/O. It cannot make an
outbound request or access file material. Web egress, redirect/IP/SSRF policy,
content retention, revocation, source capture, provider selection, and output
authorization remain unapproved future work; the foundation must not be used
to imply their security controls exist.

### Immediate Task notification boundary

TASK-V1-PR07-B resolves notification recipients only after the mutating actor
has passed the canonical Task/Project authorization checks. One centralized
policy then filters candidate recipients to active users who can currently view
the Project, removes the actor, and deduplicates mandatory and optional
Watch-derived sets. An explicit Watch opt-out can suppress only the optional
set; it cannot suppress assignment, mention, review, Blocked, hard-deadline, or
Important-comment mandatory recipients. Invalid or unauthorized mentions fail
without creating a protected Notification or disclosing the target identity.
The legacy assignment collection is a fail-closed compatibility adapter: only
unambiguous `Assignee`, `Reviewer`, and `Support` mappings may change canonical
relationships, new or changed-to `Owner` rows are rejected, and current member,
authorization, role-separation, active-work-assignee, and Project mutability
invariants are enforced before staging any side effect.

`TaskRelationshipTargetPolicy` is separate from notification-recipient
calculation and is evaluated before any canonical Primary Assignee, Reviewer,
or Collaborator relationship is created or maintained through a compatibility
assignment. It requires a non-empty ID, an active non-deleted User,
ProjectMember row, and current `CanViewProject` authorization (including
active Workspace access and an active, non-archived, non-deleted Project). A
retained ProjectMember row never authorizes a revoked target. Relationship
cleanup remains allowed for an authorized actor: clearing/removing a revoked
target does not require that target's current access.

Canonical `TaskComment` PATCH and DELETE recheck the undeleted parent Task,
current Project visibility, and current comment permission before allowing the
current author or a current Project Manager to mutate it. This prevents a
stored comment ID, historical authorship, or stale Project/Group row from
bypassing a revoked Workspace/Project boundary. A failed check returns the
uniform `TASK_COMMENT_FORBIDDEN` contract and stages no mutation, audit, or
event.

TaskComment significance is abuse-controlled once per mutation: changed bodies
use the body-aware post check; an Important-only `false -> true` update uses
the same post window through an explicit empty-body significance check; and a
combined body/Important update is not double charged. Important no-ops and
de-emphasis do not create a new check. Candidate search and direct mention
validation both recheck every candidate's current Project visibility, so a
revoked Workspace member cannot be displayed or mentioned through stale
ProjectMember or GroupMember records. Mixed valid/invalid mentions fail as a
single generic `TASK_MENTION_NOT_ELIGIBLE` command with no partial intent.

Notification presentation and durable events are intentionally generic and
reference-only. Broad Task payloads and Audit metadata reject comment/Task
bodies, review or Blocked reasons, Watch/opt-out state, private preference
values, recipient relationship sets, restricted titles/display fields,
attachment/storage/grant/license material, credentials, secrets, SQL, and raw
errors. The user Notification signal contains only its ID, state version, and a
refetch hint and is routed only to that recipient.

The mutation, relationships, AuditLog, logical Notification, approved business
event, and Notification signal are committed in one database save, so no
SignalR delivery can precede a successful commit. The default-disabled
`tasks.notificationsV1` flag stops only the new Notification intent producer;
it is not a security control. Dispatch/replay reauthorization and safe
notification opening remain PR07-D work and are not claimed by PR07-B.

### Workspace deadline-digest boundary

TASK-V1-PR07-C treats a durable ledger row as permission to attempt generation,
not as proof that its recipient may still see any Task. The one normal
candidate-page enumeration runs inside the short generation transaction;
bounded lock/rechecks validate each already enumerated page rather than
forming a discarded second enumeration. A repository-owned commit fence locks
and then rechecks current state before any visible result is staged. Its fixed
order starts with digest Job `FOR UPDATE`, then claimed Attempt `FOR UPDATE`.
Both must retain the original token and `Claimed` status; the Job must match
the current Tenant, recipient, and Workspace, and the Attempt must match the
Job and original trigger. It then locks Tenant, TenantSettings, active
Subscription(s), Plan source(s), recipient User, TenantUser, Workspace,
WorkspaceMember, Project, Group, ProjectMember, GroupMember, Task,
WorkflowStage, and Watch/Collaborator. Tenant, feature, authorization,
lifecycle, and relationship rows use PostgreSQL `FOR SHARE`; recipient User
and claimed Job/Attempt rows use `FOR UPDATE`. IDs of the same resource kind
are ordered ascending. The final evaluation requires:

- the same active Tenant and active, non-deleted user;
- active TenantUser and WorkspaceMember records;
- an active, non-deleted Workspace;
- current Project visibility, including current Project/Group/Workspace access;
- a current-visible, non-archived, non-deleted Project and undeleted Task;
- a Task that is not completed or cancelled by timestamp, status, or terminal
  Workflow Stage; and
- current digest relevance under the approved Watch contract.

Digest relevance is narrower than visibility. A current manual Watch or a
current automatic Creator, Primary Assignee, Collaborator, or Reviewer source
may qualify. Explicit opt-out suppresses digest relevance. Mere Project/Task
visibility and Team Queue eligibility do not qualify. The repository validates
current relationship sources directly and does not trust a historical
relationship or stale automatic Watch row. Watch never grants access; all
authorization and lifecycle predicates remain independently mandatory.

A membership revocation, Workspace/Project archive, Task deletion,
completion/cancellation, relationship loss without another qualifying source,
or explicit opt-out either commits before the fence and removes the candidate
at its post-lock recheck, or waits for the fenced generation transaction to
commit. If a value changed relative to the evaluated context/page, the whole
transaction is discarded and retried; it cannot commit a stale Notification,
Outbox row, or recipient state advance. If none remain, the job succeeds as a
no-op and stages neither Notification nor Outbox row. There is no discarded
pre-transaction candidate build.

`FOR SHARE` permits independent digest readers to coexist and conflicts with
the ordinary PostgreSQL update/delete locks used by lifecycle and authorization
mutations. Consequently the Tenant and Workspace are not exclusive digest
fences. The exclusive User lock is deliberately narrower: only digest work for
the same recipient waits before it updates that recipient's Notification state.
Feature evaluation is protected by the actual persistent inputs--TenantSettings,
every active Subscription, and the relevant Plan source(s)--rather than by a
TenantSettings-only read.

Optional relationship rows require a phantom policy because no row lock exists
when the child is absent. Generation holds a shared stable parent; the matching
writer obtains that parent `FOR UPDATE` before inserting, changing, or deleting
the child: Tenant for TenantSettings/Subscription, Workspace for
WorkspaceMember, Project for ProjectMember, Group for GroupMember, and Task
for Watch/Collaborator. This shared/exclusive parent-pivot protocol is required
on both sides; a digest-only advisory lock would not protect writer races.

The ledger and attempt tables are tenant-owned and use normal global query
filters. Platform scope is used only for bounded active-Tenant discovery and
aggregate health diagnostics; each schedule, claim, generation, failure, and
restart operation executes in an explicit Tenant scope. Claim owner, expiry,
and a random claim token fence concurrent workers and prevent an expired
worker from completing a reclaimed job.

The Job/Attempt fence is acquired at transaction start, before current context
or recipient User reads, and remains held while a same-recipient generation
waits for that User row. The expiry scanner retains `FOR UPDATE SKIP LOCKED`,
so it skips the live queued Job rather than expiring its Attempt or consuming
automatic budget. Crash, connection loss, or rollback releases the row lock;
ordinary claim-expiry recovery then remains available. A Job/Attempt mismatch
is `ClaimLost` and stages no Notification, NotificationUserState change,
Outbox row, or `Succeeded` transition.

The fence also treats PostgreSQL serialization/deadlock and EF concurrency
conflicts as retryable without leaking provider details to Application. It
recreates the entire transaction and reacquires all locks at most three times;
each retry confirms the original claim token and does not consume another
automatic attempt. A claim-loss result stages nothing. Only an exhausted safe
conflict is passed to the normal bounded failure handling path.

The visible Notification is one recipient-owned generic
`Task deadline digest` reference with a null body. It contains no Task list or
sensitive display content. Its durable recipient signal contains only
`notificationId`, `stateVersion`, and `requiresRefetch`; the Notification,
state-version advance, signal Outbox row, and ledger success transition commit
together. This is generation atomicity, not delayed-dispatch authorization.
Current-authorized Outbox dispatch/replay, notification opening, and Angular
state clearing remain PR07-D and must not be inferred from PR07-C.

The recipient User `FOR UPDATE` lock, acquired only after the transaction's
own Job/Attempt claim fence, serializes concurrent digests for the same user,
including different Workspace digests, but it is not assumed to serialize
every existing Notification producer. The shared
`NotificationUserState.Version` is therefore also an EF concurrency token. A
digest and immediate Task Notification race cannot commit the same recipient
version: one unit of work wins, the other rolls back on optimistic conflict,
and a clean logical-key retry advances the sequence to versions 1 then 2. This
prevents duplicate committed state versions and lost recipient-state updates
without putting display data into the signal.

Automatic failure becomes terminal on exactly the third automatic attempt.
Operator restart is limited to the existing Platform/System administrator
boundary plus a current Tenant scope. It appends one requested-by-user attempt,
links the prior attempt, and writes a generic AuditLog entry in the same
transaction; it does not erase history or reset automatic attempts. The
bounded operator reason is audit metadata and must not contain Task/comment
content, private preference data, tokens, secrets, or other protected values.

The worker never passes exception objects or exception messages to its
operational log templates. Tenant-cycle and generation failures are represented
only by bounded codes such as `DigestGenerationFailure`,
`DigestGenerationTimeout`, or `DigestPersistenceConflict`; failure-recording
logs are fixed text. Tests reject Tenant, Workspace, user, Task, job, and claim
identifiers in these log records. Aggregate diagnostics use no high-cardinality
identifier labels.

Claim execution starts every leased claim immediately inside the bounded batch:
each has a separate Tenant scope, and the hard claim-batch limit of 100 bounds
application fan-out. `Task.WhenAll` is not itself proof of database-level
parallelism; the shared/exclusive fence contract above is what permits distinct
recipients to advance while retaining same-recipient serialization. One claim's
ordinary failure is recorded independently and does not suppress the others;
cancellation remains shared and propagates through all started work.

`tasks.notificationsV1` remains default off and opt-in per Tenant. It suppresses
digest schedule/claim/generation work, but it is not an authorization control:
all of the checks above remain mandatory whenever it is enabled. If it becomes
disabled after a claim, the token-fenced release returns an automatic job to
pending and restores both attempt counters, or returns the same audited
operator-restart attempt to pending without changing automatic budget. It
creates no Notification or Outbox row and fences the released token from later
completion, defer, or failure.

## TASK-V1-PR07-D current authorization boundary

Recipient intent is staged from the authorized source command and persisted
relationships. Current target authorization is evaluated for list/unread,
read/delete/open, and immediately before first, delayed, retry, or replay
delivery. Historical Outbox routing, a SignalR group, a browser route guard, or
a hidden UI control never substitutes for current HTTP/resource authorization.
Each target follows its authoritative current policy: Task/digest additionally
requires active Workspace state/membership; Artifact reuses current Project
visibility; Message reuses the same cycle-safe, scope-consistent, 32-level
recursive Conversation boundary as normal Messaging reads. Missing, deleted,
revoked, inconsistent, or otherwise unauthorized targets fail closed.

Task/digest `Notifications.NotificationCreated.v1` carries only
`notificationId`, `stateVersion`, and `requiresRefetch`; no Task title,
description, comment/review text, relationship, route, preference, Workspace
data, or digest list is placed in its payload. Notification read-state events
also remain recipient-only and do not infer target content. A denied delivery
is terminal without retry or DeadLetter mutation, and must not fall back to a
broad route.

Artifact/Message created events retain their legacy embedded payload contract,
so their current-target check is mandatory before first, delayed, retried, or
replayed dispatch. Recipient ownership alone is insufficient. List, total,
unread, read/delete, open, created delivery, and read-state delivery share the
same target fence. Batched list/count evaluation avoids per-Message recursive
authorization calls.

`POST /api/notifications/{notificationId}/open` treats another recipient and a
missing Notification uniformly. Its `Unavailable` response is metadata-safe:
it contains no lifecycle/revocation explanation or protected target detail and
does not mark the row read. Only a successfully resolved current target can
advance read state and stage the recipient-only read-state Outbox event in the
same transaction. Authorized Task navigation is always
`/projects/{projectId}/tasks/{taskId}`; a digest can yield only `/tasks` plus
authorized typed Workspace context.
Authorized Artifact and Message routes are `/artifacts/{artifactId}` and
`/messages/{messageId}` respectively; they expose no extra Workspace context.

Authorization invalidation is sent separately as an approved metadata-only
recipient event. `RealtimeFacade` clears protected notification, Task,
project/Kanban/Gantt, My Tasks, selected route/context, active Workspace, and
preference state before it reauthorizes subscriptions or starts HTTP catch-up.
This clear-before-reauthorize ordering prevents a revoked browser from keeping
a protected projection visible.

## Tenant isolation

Implemented controls:

- tenant-owned types implement `ITenantEntity`;
- global EF query filters;
- automatic `TenantId` stamping for new tenant-owned records;
- mismatched tenant writes rejected;
- inactive tenant writes rejected;
- explicit platform scope for `/api/platform/*`;
- tenant-namespaced file keys.

Test evidence:

- service and EF InMemory tenant-isolation tests;
- Kestrel HTTP isolation tests with test authentication;
- PostgreSQL repository/search tests in CI when `POSTGRES_TEST_CONNECTION_STRING` is supplied.

Needs verification:

- cookie-authenticated cross-tenant tests against PostgreSQL;
- every platform `IgnoreQueryFilters` path;
- target host/subdomain/session tenant resolution;
- reverse-proxy host/protocol behavior.

## Feature and platform switches

Do not rely on `Features:*` or most `Platform:*` appsettings values as security controls. They are bound to option classes but do not gate routes.

Database-backed tenant features are enforced only in selected services. In the
absence of subscription/settings records, `FeatureFlagService` starts from the
registry's `DefaultEnabled` set. `tasks.notificationsV1` is deliberately
excluded from that set and therefore remains opt-in.

Security-sensitive exposure should be controlled by authorization and implemented feature gates, not by currently inert configuration switches.

## Files

Implemented:

- authorization before application-level file access;
- size, extension, and MIME allowlists;
- tenant quotas and `FileSharing` checks on upload paths;
- generated storage keys;
- local path containment checks;
- tenant namespace in keys.

Partially implemented:

- scan status entities exist, but no malware scanner/background scanning pipeline was found.
- local filesystem storage is the only working provider.

Planned:

- object storage;
- signed URLs;
- production-grade file scanning.

## Tokens, integrations, and webhooks

- Invite, API token, and webhook secret values are hashed before storage.
- Raw API token values are returned at creation.
- API token validation checks hash, revocation, and expiry.
- No authentication handler consumes API tokens on requests.
- Webhook “test” records validation/audit only and sends no request.
- Integration settings reject obvious sensitive key names, but this is not a secret vault.

## Secrets and startup validation

Production validation requires:

- a database password that does not look like a short placeholder;
- persisted Data Protection keys;
- secure cookies;
- HTTPS and HSTS;
- setup mode off;
- object-storage secret when an object provider is selected.

This validation is heuristic and does not replace a secret manager, credential rotation, TLS configuration, or deployment review.

## Logging and audit

- Unhandled exceptions are logged; production responses hide exception details.
- Audit logs and security events are stored in PostgreSQL.
- Many important service actions emit audit events.
- Trace IDs are present in global exception responses.

Needs verification:

- retention and tamper controls;
- correlation coverage for ordinary application errors;
- sensitive-data redaction across every log path;
- operational export/monitoring of security events.

## Current high-priority security gaps

1. First-admin bootstrap is startup-seed based and must be explicitly controlled per environment.
2. Invite acceptance does not create scoped membership.
3. Inert feature/platform settings can create false confidence.
4. Object storage and scanning are not implemented.
5. API token authentication is not implemented.
6. Reverse-proxy forwarded-header handling is absent.
7. Target-environment restore and tenant-isolation evidence is missing.

Track details in `docs/KNOWN_ISSUES.md`.
