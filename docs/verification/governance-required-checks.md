# Required-check governance contract

Issue #629 defines a three-layer, fail-closed contract for merge-blocking status contexts:

1. **Static topology** — repository workflows/jobs must continue to emit the registered context without event-level path filtering, job-level broad skips, dependency-induced skips, or `continue-on-error` masking.
2. **Live ruleset topology** — the active default-branch ruleset must require exactly the registered contexts, with strict required-status-check semantics and the registered integration identity where GitHub supports pinning it.
3. **Exact-head evidence** — only results attached to the PR's authoritative `.head.sha`, re-fetched from the Pull Request API by trusted default-branch code, can satisfy a gate.

`governance/policy.json` / `GOV-CHECKS-001` remains authoritative for which contexts are required. `governance/required-checks.json` is the operational registry: it adds a stable logical gate ID, producer identity, source workflow/job, trigger contract, scope, accepted conclusion, timeout/staleness policy, ruleset integration binding, and rename state. `scripts/ci/check-required-pr-checks.py` rejects any registry projection that differs from `GOV-CHECKS-001`.

## Result semantics

A required gate passes only on `success` from the registered producer on the authoritative current head SHA. `queued`, `in_progress`, and commit-status `pending` remain pending only inside the registered timeout. Missing current-head evidence, previous-head-only evidence, timeout, `failure`, `timed_out`, `action_required`, `cancelled`, `skipped`, `neutral`, `stale`, unknown states, or producer/workflow drift never become PASS.

For GitHub Actions check runs, the evaluator requires the registered GitHub App integration and resolves the Actions run referenced by `details_url` back to the registered workflow path and `pull_request` event. For trusted commit statuses, it requires the registered creator and resolves the status `target_url` back to the registered default-branch evaluator workflow. This prevents an identically named result from an unrelated producer from satisfying a required gate.

The live evaluator entry point is:

```bash
python3 scripts/ci/check-required-pr-checks.py \
  --live-pr "$PR_NUMBER" \
  --repository "$GITHUB_REPOSITORY" \
  --json
```

This mode is for GOV-02's trusted default-branch evaluator. It must not be used as a justification to run PR-head code in a privileged context. The script first re-fetches `pulls/{number}` and uses only the returned `.head.sha`; an event payload SHA or a previous run's SHA is not authoritative.

Exit codes are `0` for pass, `2` for pending, and `1` for fail/unknown/API error. GOV-02 should translate the JSON decision into its aggregate status while keeping API or parsing failures blocking.

## No-gap rename protocol

Required context, workflow, or job renames are migrations, not one-step edits. Use the following order:

1. Open a tracking issue and change the registry entry to `rename.state = "dual-publish"`, recording the old identifier(s) and `migration_issue`.
2. Make the producer emit the **new and old** required signals concurrently. Do not remove the old producer yet.
3. Add the new context to the live required-status-check ruleset, with the expected integration binding. During this phase both old and new contexts are required/published.
4. Verify multiple PR current heads produce successful results for the new context from the expected producer. Verify GOV-02 reports no producer or exact-head drift.
5. Remove the old context from the live ruleset only after the new context is stable.
6. Remove the old workflow/job/status emission.
7. Return the registry entry to `rename.state = "stable"` and clear all previous identifiers and `migration_issue`.

Never rename a required job/context and update only one of workflow, registry/policy, or ruleset. Such partial changes either weaken protection or create an indefinitely pending required context and are expected to fail this contract.

## Adding future aggregate gates

When `ci/functional`, `ci/performance`, `ci/compatibility`, `ci/governance`, or another aggregate becomes merge-required, add it to `GOV-CHECKS-001` and `governance/required-checks.json` in the same reviewed change. Define its stable gate ID, producer, trigger/scope, exact timeout, and ruleset integration before making the live ruleset require it. Then use the same no-gap ordering above to activate it without a missing-context window.
