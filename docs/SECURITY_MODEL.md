# Security Model

Last implementation audit: 2026-06-18.

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
