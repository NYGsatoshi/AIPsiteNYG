# A-09 Audit Security Failure Log

Issue: A-09 - [MVP-A][P0][AuditSecurity] Verify audit log, security event, denial tracking, and metadata-only logging baseline

Date: 2026-06-29

Result: Needs verification

This failure log does not imply production approval, MVP-A Go, production readiness, or acceptance of unrelated MVP-A blockers.

## Summary

No confirmed audit/security log private body, token, cookie, password, connection-string, file body, or message body exposure was observed in the final tested synthetic paths.

Three source-level audit/security risks were found and fixed during A-09:

- tenant-admin audit/security queries relied on the ambient tenant query filter without an explicit `TenantId` predicate in `DbAuditQueryService`;
- conversation/message denial paths returned safe generic responses but did not write denial audit entries;
- login security-event metadata stored the submitted email string.

The remaining A-09 limitations are verification blockers or incomplete event-matrix coverage, not observed private-body leaks in the final tested paths.

## Resolved During A-09

### Audit Query Tenant Scope

Failure area: audit log access control

Endpoint or code area: `DbAuditQueryService`, `GET /api/audit-logs`, `GET /api/security-events`

Expected result: audit/security reads require both an authorization check and a database-level tenant scope filter for tenant-admin reads.

Actual result before fix: authorization checks existed, and the EF tenant query filter normally scoped tenant reads, but the query service did not include its own explicit `TenantId` predicate.

Sanitized evidence summary: source inspection only; no raw audit rows copied.

Data exposure risk: unknown / potential cross-tenant widening if future execution bypasses ambient tenant filters.

Required fix: add explicit `TenantId == currentTenant.TenantId` predicates for non-platform/system audit and security-event reads.

Whether this blocks MVP-A: yes until fixed and tested.

Status: Resolved for tested synthetic paths.

Evidence: focused auth/tenant/audit slice passed 42/42; full backend suite passed 146/146.

### Conversation Denial Audit Missing

Failure area: denial logging missing

Endpoint or code area: `ConversationService`, conversation/message read/manage/send/edit/delete denial paths

Expected result: denied conversation/message operations should be traceable as metadata-only audit events.

Actual result before fix: service denial responses were generic and did not expose message bodies, but denial audit entries were not written in the covered conversation paths.

Sanitized evidence summary: no real messages copied; synthetic body strings were used only in tests.

Data exposure risk: no confirmed exposure; audit traceability gap.

Required fix: add generic metadata-only denial audit entries and save them before returning denial results.

Whether this blocks MVP-A: yes until fixed and tested.

Status: Resolved for covered synthetic paths.

Evidence: `CommunicationBodiesStayParticipantScopedAndDeniedResponsesAreGeneric` now checks `ConversationAccessDenied` audit entries and verifies they do not include synthetic message bodies, participant email, or storage keys.

### Raw Submitted Email in Login Security Metadata

Failure area: audit log leakage / personal identifier minimization

Endpoint or code area: `AuthService.LoginAsync`

Expected result: audit/security logs should not store raw personal identifiers unless explicitly required and justified.

Actual result before fix: login security metadata stored the submitted email string for login success/failure/lockout events.

Sanitized evidence summary: synthetic email addresses only; no real user email copied.

Data exposure risk: yes, privacy/minimization risk for authentication logs.

Required fix: replace raw email metadata with `emailProvided` and `userId` when known.

Whether this blocks MVP-A: yes until fixed and tested.

Status: Resolved for the `AuthService` login metadata path.

Evidence: `FailedLoginSecurityMetadataDoesNotStoreSubmittedEmail` passed in the focused auth slice.

## Remaining Needs Verification

| Failure area | Endpoint or code area | Expected result | Actual result | Data exposure risk | Required fix/follow-up | Blocks MVP-A | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live audit/security log review | running app logs and database rows | sanitized live summary proves no raw private bodies/secrets | not captured in this pass | unknown | run approved synthetic runtime smoke after baseline login exists | yes for A-09 acceptance | Needs verification |
| complete denial matrix | tenant/project/DM/message/thread/file/grant/notification/admin denial categories | each required denial is audited metadata-only where implemented | partial coverage only | unknown | execute category matrix with synthetic actors | yes | Needs verification |
| admin audit matrix | admin user, role, permission, tenant setting, export, destructive-operation actions | each admin operation audited with actor/action/target/result/correlation where applicable | many audit calls exist, but full matrix not executed | unknown | complete admin operation audit inventory and smoke | yes | Needs verification |
| file grant/revoke audit | file/attachment grant paths | grant create/revoke and revoked-grant access attempts audited | not fully inventoried | unknown | identify implemented grant surface and add tests | yes if implemented | Needs verification |
| destructive DB operation attempt | migration/destructive DB risk paths | destructive attempts logged or explicitly out of scope | no dedicated runtime event found | unknown | define expected MVP-A behavior | yes if required | Needs verification |
| metadata sanitizer completeness | `DbAuditLogger.SerializeMetadata` and all call sites | forbidden fields cannot be persisted accidentally | current sanitizer is key-denylist based; call sites inspected are mostly metadata-only | unknown | expand sanitizer or constrain metadata producers | yes if arbitrary metadata is accepted | Needs verification |
| `SecurityEvent.Email` policy | `DbAuditLogger.LogSecurityAsync` | personal identifiers are minimized or justified | login metadata was fixed; entity-level email column policy not fully resolved for authenticated current-user contexts | unknown | decide policy and pseudonymize if required | yes for strict A-09 minimization | Needs verification |
| Docker/PostgreSQL runtime | local containers and DB-backed readiness | runtime dependencies verified | not refreshed in A-09 | no direct data exposure | rerun container/DB evidence when Docker is available | no direct A-09 leak, but blocks runtime acceptance | Blocked |

## P0 Blocker Examples

No final tested path confirmed these P0 examples after A-09 fixes:

- message body, DM body, file body, token, cookie, password, or connection string in audit/security metadata;
- general user audit/security event read;
- cross-tenant audit log read by tenant admin;
- missing file/conversation denial traceability in the covered synthetic paths.

The absence of confirmed findings in these paths is not A-09 acceptance. Untested or incomplete areas remain Needs verification.
