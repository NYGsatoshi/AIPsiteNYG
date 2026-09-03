# Publicization readiness audit

- Repository: `NYGsatoshi/AIPsiteNYG`
- Audit date: 2026-09-03 (Asia/Tokyo)
- Target: current `main` and repository-controlled publicization boundaries
- Decision: **BLOCKED — do not change repository visibility yet**

## Scope and limitations

This audit covers tracked source, configuration, documentation, dependency
manifests, and GitHub Actions definitions reachable from the repository. It
also defines the checks that must run immediately before publicization.

A pull request cannot by itself prove that every historical commit, deleted
file, branch, tag, workflow log, artifact, release asset, issue attachment, or
external service is clean. Those surfaces remain mandatory manual or
full-history verification gates. An item is not marked complete merely because
no problem was found in the current default branch.

## Intended publication model

AIPsiteNYG is to become publicly visible but is **not** to become open source.
The intended model is:

- source may be viewed through GitHub;
- no license is granted to use, execute, copy, modify, redistribute, sublicense,
  commercialize, host, or create derivative works;
- unsolicited external contributions are not accepted;
- pull requests are limited to explicitly authorized collaborators;
- authorized collaborators require review, while the repository owner may
  bypass the review-only rule;
- required CI checks remain non-bypassable;
- secrets and deployment credentials remain outside source control; and
- untrusted pull-request code must never execute on a persistent self-hosted
  runner.

## Findings

### A. Controls already present

| ID | Finding | Status |
|---|---|---|
| A-01 | `.gitignore` excludes `.env`, `.env.*` except the example, `secrets/`, and Syncfusion license files. | Present |
| A-02 | The frontend package is marked `private`, reducing accidental npm publication risk. | Present |
| A-03 | Syncfusion activation reads `SYNCFUSION_LICENSE` from the environment and fails closed when absent. | Present |
| A-04 | Docker builds provide the Syncfusion value through a BuildKit secret mount rather than a build argument or committed file. | Present |
| A-05 | Existing CI contains a Gitleaks scan. | Present; full-history coverage must still be verified |
| A-06 | Some self-hosted pull-request jobs already check that the PR head repository equals the base repository. | Partial |

### B. Blocking findings

| ID | Severity | Finding | Required closure |
|---|---|---|---|
| B-01 | Critical | At least `.github/workflows/node-toolchain-preflight.yml` is triggered by `pull_request` and runs on a persistent self-hosted runner without a same-repository trust guard. Additional workflows must be checked automatically. | Move the PR job to GitHub-hosted infrastructure or add a fail-closed same-repository guard. No fork PR may reach a self-hosted runner. |
| B-02 | Critical | A conclusive scan of all reachable Git history has not been recorded for the publicization candidate. | Fetch full history, scan all commits/branches/tags with Gitleaks or an equivalent scanner, redact output, and record a passing run. Rotate first and rewrite history if any live or historical secret is found. |
| B-03 | Critical | Historical GitHub Actions logs and artifacts have not been conclusively reviewed for credentials, internal endpoints, personal data, test screenshots, database content, or license values. Visibility changes may expose repository activity surfaces. | Review or delete sensitive historical runs and artifacts before changing visibility. |
| B-04 | Critical | Repository ownership, third-party provenance, competition obligations, school confidentiality, and patent/public-disclosure implications cannot be proven from source inspection. | The owner must complete the legal/IP disclosure gate before publication. |
| B-05 | High | Public-repository feature settings and rulesets are not represented by Git commits and therefore cannot be completed by this PR. | Apply the settings in `PUBLICIZATION_RUNBOOK.md`, then verify them from a non-collaborator account or signed-out browser. |
| B-06 | High | Archived documentation, deployment scripts, evidence reports, screenshots, hostnames, account identifiers, and fixture data may disclose more operational context than the public source requires. | Perform a path-by-path content review and move sensitive material to a private repository before publication. |
| B-07 | High | Dependency-license and asset-provenance review is not yet recorded as a final publicization artifact. | Review direct and transitive package notices, copied assets, fonts, icons, screenshots, sample data, and generated vendor files. |

## Changes introduced by the preparation PR

- an explicit all-rights-reserved, no-license notice;
- a contribution policy rejecting unsolicited external contributions;
- third-party and Syncfusion notices;
- this audit record;
- a publicization runbook with mandatory manual gates; and
- an automated repository-readiness checker and GitHub-hosted audit workflow.

These controls do not authorize the visibility change on their own.

## Required evidence before visibility changes

The publicization decision may change from **BLOCKED** to **READY** only after
all of the following evidence exists:

1. a passing full-history secret scan from a clean clone with complete history;
2. a passing readiness workflow on the exact commit to be made public;
3. a list of reviewed or deleted Actions runs and artifacts;
4. confirmation that no real user, school, production, or personal data remains;
5. confirmation that every PR-triggered self-hosted job is fail-closed to trusted
   same-repository branches, or has been moved to a GitHub-hosted runner;
6. completed dependency, asset, copyright, and patent/disclosure review;
7. configured contribution restrictions, Actions permissions, security
   features, and branch rulesets; and
8. a signed-out verification that the public view exposes only intended data.

## Decision record

Until every blocking finding is closed, the repository must remain private.
The visibility change must be a separate, deliberate administrative action after
this preparation PR is merged and the final runbook is completed.
