# TASK-V1-PR07-C deadline-digest decisions

Status: Resolved

Approved: `2026-08-03`

Applies to: `TASK-V1-PR07-C` Workspace deadline-digest generation

Canonical specification baseline:
`8b90c8897367606473515d17d3696e458b2ee7b5`

Implementation baseline:
`93b1c5e260e04c243ff84f7370aca4d869484087`

This record captures the product owner's focused approval for the digest
candidate predicate, an empty digest result, and operator-restart attempt
accounting. It resolves the previously underspecified "current relevance"
check for PR07-C without changing the immediate Task-notification recipient
matrix.

## Digest candidate relevance

A Task is relevant to a user/Workspace digest only when the user has current
effective Watch for that Task after automatic Watch sources have been
reconciled from current Task relationships.

The following rules are normative for PR07-C:

1. A current manual Watch qualifies, subject to all current authorization and
   lifecycle checks.
2. A current automatic Watch source qualifies according to the existing
   Creator, Primary Assignee, Collaborator, and Reviewer Watch contract.
3. Explicit Watch opt-out suppresses digest relevance, including relevance
   that would otherwise come from an automatic Watch source.
4. Mere Task or Project visibility does not qualify a Task for the digest.
5. Team Queue eligibility does not qualify a Task for the digest. Claiming a
   Team Queue Task may qualify later through the resulting reconciled Watch
   state.
6. Candidate evaluation MUST reconcile or validate current automatic sources
   and MUST NOT trust a stale Watch row or a historical relationship.
7. Tenant, active Workspace membership, Workspace/Project/Task visibility,
   archive/delete state, completion/cancellation, and current authorization
   remain independent mandatory filters. Effective Watch never grants access.

If a relationship is lost, its automatic Watch source is removed during
reconciliation. The Task remains relevant only when another current automatic
source or a current manual Watch still produces effective Watch and no explicit
opt-out applies.

## Zero-candidate result

When a claimed user/Workspace/local-date/policy-version ledger unit has no
eligible Tasks after the current-state recheck:

- the ledger reaches `Succeeded`;
- no visible Notification is created; and
- no Transactional Outbox row is created.

This is a successful idempotent no-op, not a retryable generation failure and
not an empty user-visible digest.

## Operator restart accounting

The automatic-attempt budget remains exactly three. Exhaustion reaches terminal
`Failed`.

Each approved operator restart:

1. records an audited new operator attempt associated with the original digest
   identity and preserved failure history;
2. authorizes exactly one additional operator attempt; and
3. does not reset, replace, or create a new three-automatic-attempt budget.

The original row and automatic-attempt history MUST NOT be ambiguously rewritten
to look like a new automatic generation series. A later operator restart, if
approved, is another separately audited one-attempt action.

## Acceptance consequences

PR07-C evidence MUST distinguish:

- current automatic Watch, current manual Watch, explicit opt-out, stale source
  reconciliation, mere visibility, and Team Queue eligibility;
- zero-candidate `Succeeded` from Notification/Outbox-producing success; and
- the exact three automatic attempts from each separately audited single
  operator attempt.
