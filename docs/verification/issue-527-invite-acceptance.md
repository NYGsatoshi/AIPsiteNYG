# Issue #527 invite acceptance verification

Status: implementation candidate in PR #539. Hosted CI and PostgreSQL execution remain the merge gate until the PR checks complete.

## Invariant

Invite acceptance is one authorization-sensitive mutation. The server owns Tenant, Workspace, and requested Workspace role from the persisted `Invite`; the browser cannot override those fields.

For an acceptance request, the application now:

1. starts an acceptance-owned transaction;
2. hashes the submitted token and locks the matching PostgreSQL `invites` row with `FOR UPDATE`;
3. rejects missing, used, revoked, or expired invites;
4. validates that the persisted Tenant is active and not deleted;
5. validates that the persisted Workspace is active, not deleted, and belongs to the same Tenant as the Invite;
6. reuses an existing active User for the invite email, or creates one new User;
7. creates or reactivates the Tenant membership using a role derived from the Invite role;
8. creates or reactivates the Workspace membership using the exact Invite role;
9. marks the Invite accepted;
10. creates the authenticated Session;
11. records metadata-only acceptance audit/security events; and
12. saves and commits the complete mutation together.

A persistence exception rolls the transaction back and clears tracked command state. A second concurrent acceptance blocks on the Invite row; after the first transaction commits it observes `AcceptedAt` and returns the existing used-invite failure without creating another Session.

## Fail-closed scope rules

Acceptance does not infer or repair scope from request data. It is denied when:

- the Invite does not exist;
- it is expired, revoked, or already accepted;
- its Tenant is missing, deleted, or inactive;
- its Workspace is missing, deleted, inactive, or belongs to another Tenant;
- an existing User is unavailable for login; or
- an existing Workspace membership for that User has a Tenant inconsistent with the Invite.

`ValidateInviteAsync` uses the same Tenant/Workspace lifecycle and parent-scope validation before returning Tenant or Workspace names, so a malformed cross-Tenant Invite does not become a metadata disclosure path.

## Existing-user semantics

An active existing User with the Invite email is reused. Invite acceptance does not overwrite that User's password with the registration payload. Tenant/Workspace memberships are activated and assigned from Invite-owned authority. This avoids duplicate users while keeping Invite role/scope authoritative.

## Audit data

Successful acceptance records `userId`, `inviteId`, `tenantId`, and `workspaceId` metadata. Denial records only Invite/scope identifiers when available plus a bounded reason code. Raw Invite tokens, invite email addresses, submitted passwords, session cookies, and password hashes are not placed in audit metadata.

## PostgreSQL regression coverage

`tests/AipPortal.Tests/PostgreSql/InviteAcceptancePostgreSqlTests.cs` covers:

- new User + TenantUser + WorkspaceMember + Invite accepted + Session committed together;
- existing eligible User reuse with role activation and password preservation;
- two concurrent accepts of the same Invite when membership rows already exist, proving the result is one success / one used-Invite denial and exactly one Session rather than relying on a membership unique violation;
- a cross-Tenant Invite/Workspace mismatch failing closed without identity, membership, Session, or `AcceptedAt` mutation;
- a provider-side persistence failure rolling back User, memberships, Invite acceptance, Session, and success audit together; and
- accepted/denied audit metadata not containing the raw token, invite email, or submitted password.

The tests are marked `PostgreSQLIntegration` / `Issue527` and use the repository's `PostgreSqlFact` harness with an isolated migrated database.
