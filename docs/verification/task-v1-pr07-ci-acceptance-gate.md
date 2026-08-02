# TASK-V1-PR07 CI acceptance gate

## Stacked PR identity

| Field | Value |
| --- | --- |
| Repository | `NYGsatoshi/AIPsiteNYG` |
| Stacked PR | `CI: add TASK-V1-PR07-B acceptance gate` (Draft; URL pending push) |
| Head branch | `ci/task-pr07b-acceptance-gate` |
| Base branch | `task/v1-pr07-b-immediate-notifications` |
| Starting base SHA | `6f59e133219a736ba7aca432bbb0bdf686ab3371` |
| Latest base SHA | `159b501d7d82416406a74d5f2bbf3fa59e7c87af`, incorporated by normal merge commit `b8fa6ebe68f27f069d6fc50af9e74b02449ff5de` |
| Final CI branch SHA | The Draft PR records the immutable final branch SHA and hosted check IDs after checks finish; this source document avoids self-referencing a follow-up documentation commit |
| Draft | Yes, required |
| Merge performed | No |
| PR #275 merge authorization | No |

This is a stacked CI-only Draft PR. It must not be merged before the PR #275
remediation branch is updated. It does not authorize PR #275 merge.

## Acceptance changes

The existing `build-test` job retains its self-hosted runner, PostgreSQL 18
service, persistent .NET caches, Release build, full `AipPortal.slnx` test,
backend TRX artifact, 90-minute timeout, and concurrency policy. No new job,
retry, timeout increase, service, restore, build, or test parallelism is
introduced.

- **Full backend TRX guard:** verifies `artifacts/test-results/backend-tests.trx`
  immediately after the existing full backend test step.
- **PR07-B focused test:** runs the existing Release build against the same
  PostgreSQL service with `Scope=TaskV1PR07B` and writes
  `artifacts/task-pr07b-test-results/task-pr07b-acceptance.trx`.
- **Strict TRX verification:** requires `total >= 1`, `executed == total`,
  `passed == total`, and zero for failures, errors, timeouts, aborts,
  inconclusive, not-runnable, not-executed, disconnected, warning, completed,
  in-progress, and pending counters. Missing TRX/Counters/required counters
  also fail. Counter attribute order is not significant.
- **Required test manifest:**
  `scripts/ci/task-pr07b-required-tests.txt` requires the 14 TaskComment
  authorization, Important abuse-control, and current-authorized mention
  regression test names to occur as substrings of executed focused-TRX
  `testName` values. Blank and comment lines are ignored.
- **EF model drift gate:** runs `ef migrations has-pending-model-changes` after
  migration application using the existing Release build.
- **Artifact:** an independent
  `task-pr07b-acceptance-test-results` upload contains only the focused TRX.

The verifier adds a GitHub step summary with its label, TRX path, total,
executed, passed, failed, notExecuted, required-test count, and missing-test
count. It does not include test output, connection strings, or other secrets.

## Initial expected status

At the starting base SHA, the required TaskComment remediation tests belonged
to PR #275 and were not yet present on the base branch. That base has now been
incorporated by normal merge. The current merged source and local focused TRX
contain 12 of 14 required names; these two remain absent and must keep the
focused acceptance gate red until they are added with `Scope=TaskV1PR07B`:

- `RateLimitedImportantOnlyUpdateCreatesNoNotification`
- `UnauthorizedMentionStagesNoNotificationIntent`

The local run also has PostgreSQL conditional skips because the required
PostgreSQL 18 image could not be pulled in this environment. The manifest and
strict verifier must not be weakened to make either interim state green.

## Final evidence

| Field | Status |
| --- | --- |
| Latest base incorporated | Yes: `159b501d7d82416406a74d5f2bbf3fa59e7c87af` via `b8fa6ebe68f27f069d6fc50af9e74b02449ff5de` |
| Final check IDs | Pending the immutable final stacked-PR HEAD; record in the Draft PR after all checks finish |
| Stacked checks green | No; two required focused-test names are absent, and local PostgreSQL execution is environment-blocked |
| Merge performed | No |
| PR #275 merge authorization | No |
