# GOV-02 / GOV-03 live ruleset migration

This migration is required before GOV-02 is merged into `main`. The repository-owned policy is the desired state; current GitHub settings must not be copied into policy merely to make the evaluator Green.

## Required order

1. Apply the GOV-03 live `PRreview` target before merging PR #650:
   - `required_approving_review_count = 0`
   - `require_code_owner_review = false`
   - `require_extra_approval_for_unattributed_changes = false`
   - `required_review_thread_resolution = true`
   - keep `dismiss_stale_reviews_on_push = false`
   - keep `require_last_push_approval = false`
2. Remove the current user `always` bypass from both active rulesets.
3. Remove the current Integration bypass actors unless each retained actor is explicitly added to `GOV-BYPASS-001.expected.allowed_actors` with actor identity, purpose, rationale, bypass mode, break-glass classification, `normal_development=false`, and exact ruleset scope.
4. Verify the two expected rulesets remain active and still enforce deletion protection, non-fast-forward protection, strict required checks, required signatures, and the registered required status contexts.
5. Merge PR #650 by the normal protected-branch path. Do not use an owner/admin bypass merely to satisfy this migration.
6. Rebase/stack PR #646 on the merged GOV-03 policy and run the GOV-02 live evaluator against the post-migration GitHub state.
7. Merge PR #646 only after that live reconciliation reports `PASS` and the normal required CI/review gates are satisfied.

## Why the order matters

Merging GOV-02 while the current bypass/review settings still drift from GOV-03 would make the trusted evaluator immediately report failure for every open PR. The fix is an explicit live-setting migration, not a temporary relaxation of the repository policy.

## Open-PR invalidation after GOV-02 lands

`Governance live policy audit` runs on `main`, branch-protection-rule changes, manual dispatch, and an hourly fallback. Completion of that audit triggers the trusted PR evaluator, which re-reads live policy and re-evaluates every open PR. A detected drift is written as failure to both the diagnostic `GOV-RULESET-001` context and the already-required `External PR approval policy` context.

Status invalidation is not atomic. If GitHub rejects all status POST attempts, an older same-SHA success can remain until a later successful sweep. The workflow retries writes, fails visibly when writes cannot be confirmed, and the next audit retries; no stronger guarantee is claimed.

## Classic branch protection

The live-state collector also attempts the classic branch-protection detail endpoint. When observable, selected classic settings are normalized into the snapshot and therefore into its SHA-256 evidence. A 404 is recorded as `configured=false`; authorization failures such as 403 are recorded as `observable=false`, never as an empty/unconfigured policy.

Classic protection is supplemental to repository rulesets in this design. Lack of permission to read the classic detail endpoint is surfaced as an observation rather than being misrepresented as a ruleset PASS or absence of classic protection.
