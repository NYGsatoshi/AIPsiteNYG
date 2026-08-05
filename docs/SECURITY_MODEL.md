# Security Model

Last broad implementation audit: 2026-06-18. TASK-V1-PR07-C security-boundary
update: 2026-08-03.

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

Known limitation: controllers commonly return `400` for application authorization/not-found failures, so HTTP status semantics are inconsistent.

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
order is Tenant, TenantSettings, active Subscription(s), Plan source(s),
recipient User, TenantUser, Workspace, WorkspaceMember, Project, Group,
ProjectMember, GroupMember, Task, WorkflowStage, Watch/Collaborator, then the
digest job and claimed attempt. Tenant, feature, authorization, lifecycle, and
relationship rows use PostgreSQL `FOR SHARE`; recipient User and claimed
job/attempt rows use `FOR UPDATE`. IDs of the same resource kind are ordered
ascending. The final evaluation requires:

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

The recipient User `FOR UPDATE` lock serializes concurrent digests for the
same user, including different Workspace digests, but it is not assumed to
serialize every existing Notification producer. The shared
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
