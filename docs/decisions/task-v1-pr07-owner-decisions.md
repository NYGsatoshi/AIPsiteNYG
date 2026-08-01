# TASK-V1-PR07 owner decisions

Status: Open

Audit baseline: `491d17db3701b7fb26010db8c0590eac7d24bd78`

Specification baseline: `6e8e5c3651adeedc7a2709124e9af0fd927d35b5`

This file contains only product or canonical-contract questions that cannot be answered from the current specification and implementation. It does not reopen the decisions already closed by `15-workspace-task-messaging-owner-decision-resolution.md`.

## PR07-OWNER-001 — Exact mandatory recipients

### Question

Which current, authorized Task relationships are mandatory recipients for each of these immediate categories?

| Category | Already explicit | Still unresolved |
| --- | --- | --- |
| Primary Assignee assigned | New Primary Assignee | None |
| Primary Assignee removed | Previous Primary Assignee | None |
| Reviewer assigned | New Reviewer | None |
| Valid direct mention | Each valid directly mentioned user | None |
| Submitted for Review | Current Reviewer | Whether any other relationship is mandatory |
| Returned/rejected from Review | The event is mandatory | Whether the Primary Assignee alone, the Primary Assignee plus Collaborators, or another set receives it |
| Becomes Blocked | The event is mandatory | Exact mandatory relationship set |
| Major hard-deadline change | The event is mandatory | Exact mandatory relationship set |
| Important TaskComment | Direct mentions remain direct-mention recipients | Meaning of "applicable Task users" for the Important category |

The higher-authority sources define the categories, actor suppression, current-authorization checks, and independence from Watch. They do not define all recipient sets. The older API/realtime mapping uses "affected users" and, for review resolution, mentions assignee/collaborators, but that is routing guidance rather than a complete notification recipient policy.

### Affected contracts

- recipient-policy service contract;
- logical notification keys;
- Task mutation tests;
- delayed dispatch authorization;
- Real Backend two-user acceptance evidence;
- notification volume and privacy exposure.

### Recommended option

Use the smallest relationship-specific mandatory set:

- submitted for Review: current Reviewer;
- returned/rejected: current Primary Assignee;
- Blocked and major hard-deadline change: current Primary Assignee and current Reviewer;
- Important TaskComment: current Primary Assignee, current Reviewer, and Collaborators;
- exclude the actor under the existing canonical self-notification rule;
- add effective Watch recipients only as a separate optional general-activity layer that respects explicit opt-out.

Alternatives are to include the creator in one or more mandatory sets, or to make every effective watcher mandatory. The latter would erase the canonical distinction between mandatory and Watch-derived notification policy.

### Risk of postponement

Implementations could leak Task activity to an overly broad set or fail to notify a required user. The dedupe key shape also depends on a stable category and recipient policy.

### Can PR07-A proceed?

Yes for persistence and preference foundations. PR07-B must not begin notification generation until this decision is resolved.

## PR07-OWNER-002 — Digest local-time granularity

### Question

What bounded values may `deadlineDigestLocalTime` contain?

Canonical sources require a documented bounded granularity/range but do not define one. The current code has no equivalent setting from which to inherit a rule.

### Affected contracts

- preference PATCH validation and error details;
- Workspace settings UI controls;
- scheduler due-window calculation;
- DST and boundary tests;
- API documentation.

### Recommended option

Allow quarter-hour values from `00:00` through `23:45` in Workspace local time. Persist a time-without-timezone value and use the Workspace timezone only when calculating a due instant.

Alternatives are hourly values or arbitrary minute precision. Hourly values are simpler but less flexible; arbitrary minutes increase scheduler cardinality and test surface without a stated product need.

### Risk of postponement

The API could accept values that the UI cannot represent, or the scheduler could silently round a stored value.

### Can PR07-A proceed?

No as a complete independently reviewable PR, because PR07-A owns the preference validation contract. Schema-only work could proceed, but splitting schema from its API would add an unnecessary migration-only step.

## PR07-OWNER-003 — Background-job and Outbox delivery profile

### Question

Confirm how the dedicated realtime Outbox and Task deadline digest are intended to relate to the generic MVP job rules in `22-audit-jobs-consistency.md`.

The canonical documents currently disagree or leave the boundary ambiguous:

- `outbox-delivery-contract.md` sets ten automatic attempts and a durable dead-letter/replay lifecycle;
- `22-audit-jobs-consistency.md` says MVP retry is limited to three, dedicated DeadLetter and JobLease are Full-only, stopped work is represented by `BackgroundJobRecord.Status = Failed`, and the MVP job list does not name a Task deadline digest;
- the PR07 prompt requires the digest to follow existing job/Outbox claim, lease, retry, dead-letter, bounded-processing, and observability contracts.

### Affected contracts

- retry thresholds and backoff;
- digest claim/lease fields;
- failed/dead-letter state and replay procedure;
- health and metrics semantics;
- whether the digest is a permitted `NotificationDispatchJob` specialization;
- operator runbook and acceptance tests.

### Recommended option

Clarify the boundary as follows:

- durable realtime Outbox delivery follows `outbox-delivery-contract.md`: ten attempts, Outbox dead-letter state, authorized replay;
- digest generation is a `NotificationDispatchJob` specialization: three attempts, a terminal Failed state in its idempotency/claim ledger, no separate dead-letter table, and an operator restart that creates an audited new attempt;
- a short database claim timeout is allowed for concurrency safety even though the generic document describes advanced JobLease as Full-only;
- the digest ledger remains separate from Outbox delivery, while each resulting visible notification and realtime signal uses the existing transactional Outbox.

Alternatives are to give both mechanisms the ten-attempt Outbox profile, or to force both to the three-attempt generic job profile. Either alternative contradicts one of the current canonical documents.

### Risk of postponement

Two workers could implement incompatible terminal states, retry counts, and replay semantics, making operational evidence and idempotency unreliable.

### Can PR07-A proceed?

Yes for persistence/preferences/dedupe. PR07-C and the final observability contract must wait for the clarification.

## Implementation-start decision

PR07 implementation as a whole is **NO-GO** until these three decisions are recorded in the canonical specification. The first proposed implementation PR is also blocked by `PR07-OWNER-002`.
