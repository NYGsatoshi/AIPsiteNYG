# P0 Workspace sharing header verification

Status: Issue #333 implementation candidate.

## Authoritative External definition

At Workspace scope, `External` is a server-owned aggregate of distinct active
users who hold a `ProjectMember` resource grant beneath the active Workspace
but do not hold an active `WorkspaceMember` membership there. Only non-deleted,
non-archived Project resources and active, non-deleted users contribute. This
projection does not create Workspace membership, make the Workspace
discoverable, or broaden any Project grant.

Every authorized Workspace dashboard viewer receives the boolean
`hasExternalShares`, so the header can display the textual `External` badge
without loading member details. The exact distinct-user count is returned only
to a System Administrator or an active Workspace Owner/Admin. Member preview
rows contain at most three already-authorized active Workspace members and are
not an external-user detail projection.

## Header and authorization contract

- The active Workspace header presents the member preview as an avatar stack,
  the always-textual `External` badge when applicable, and explicitly
  Workspace-scoped sharing text.
- Sharing inspection is projected only for a System Administrator or active
  Workspace Owner/Admin. Mutation wording is projected only for the
  System Administrator or Owner/Admin governance boundary; the browser never derives it from role
  labels or the presence of External shares.
- The compact control opens the existing secondary Workspace members surface.
  It does not render a permanent member card or claim that Project-scoped
  external users are Workspace members.
- Presence/online state is intentionally excluded and remains P2 work.

## Acceptance mapping

| Criterion | Candidate behavior |
| --- | --- |
| Sharing state is visible in the header | Server-owned aggregate and avatar stack render in the active Workspace action group |
| External is visible without details | `External` text badge is driven by `hasExternalShares` |
| State is not color-only | The badge always contains the literal `External` string |
| Workspace scope is clear | Action labels say `Workspace sharing`; destination includes the active Workspace ID |
| Unauthorized mutation is absent | `canManageSharing` follows the existing server management boundary (System Administrator or active Owner/Admin); absent capability renders no management action |
