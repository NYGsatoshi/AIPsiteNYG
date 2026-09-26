# Static analysis strategy

## Responsibility split

| Tool | Role | Execution |
| --- | --- | --- |
| SonarQube Server | Repository-wide quality gate across C#, JavaScript, TypeScript, HTML, CSS and SCSS | Automatic analysis on pushes to `main`; trusted same-repository PRs are analyzed by explicit manual dispatch and decorated in GitHub |
| ESLint + angular-eslint | JavaScript, TypeScript and Angular template policy | `Frontend Static Analysis` on every PR and `main` push; blocking |
| Stylelint | CSS and SCSS policy | `Frontend Static Analysis` on every PR and `main` push; blocking |
| Qodana Community for .NET | JetBrains/ReSharper second-opinion and deep .NET inspection | Every PR, `main`, weekly schedule and manual dispatch; blocking for changed-code findings on PRs, Critical findings, scanner failure and project-model failure |
| CodeQL | Security-oriented semantic/data-flow analysis | Every PR targeting `main`, trusted `main` pushes and weekly schedule |

The tools intentionally overlap at the language level but not at the policy level. SonarQube is the primary cross-stack quality view, ESLint/Stylelint enforce frontend-specific rules, CodeQL owns security analysis, and Qodana supplies an independent JetBrains/ReSharper inspection lane for .NET.

## Frontend lint debt baseline

`Frontend Static Analysis` is blocking, but it does not require unrelated pull requests to eliminate the repository's pre-existing ESLint and Stylelint backlog. `tools/frontend-inspections/baseline.json` records the accepted repository-wide finding count for each lint rule.

Enforce mode fails when the count for any ESLint or Stylelint rule exceeds that committed baseline. Existing findings remain present in the uploaded reports, while each rule's total debt is prevented from growing. The baseline is position-independent; fixing an existing finding can offset a new finding of the same rule elsewhere, so this is a rule-level debt ceiling rather than an exact per-line baseline.

Refreshing the baseline with `node tools/frontend-inspections/run.mjs --update-baseline` is an explicit policy change and should be reviewed as such; it must not be used as an automatic CI escape hatch.

### Boy-scout cleanup policy

Dedicated repository-wide ESLint cleanup phases end after ESLINT-05. From ESLINT-06 onward, lint debt is reduced as a boy-scout cleanup in code that is already being changed for feature, bug-fix, or regression work. A separate cleanup pull request is reserved for a small, explicitly bounded regression fix; it must not become a new repository-wide sweep.

Apply the following constraints:

- Do not run repository-wide autofixes solely to reduce the committed lint baseline.
- Do not increase an ESLint or Stylelint rule count in `tools/frontend-inspections/baseline.json` to make a pull request pass.
- When touched code contains an existing finding that can be removed safely without broadening the behavioral change, remove it in the same pull request.
- Do not introduce `eslint-disable` comments or weaken lint configuration merely to avoid fixing a touched finding.
- If a safe cleanup lowers a rule count, update the baseline downward and review the generated report and baseline diff together.
- If an autofix transfers debt into another rule, expands beyond the touched feature surface, or requires semantic refactoring, leave it for a separately scoped change instead of forcing the fixer through.
- During a regression or feature-freeze gate, keep lint cleanup within the files required for the blocking fix so the validated target SHA is not churned by unrelated cleanup.

This policy preserves the baseline as a monotonic debt ceiling while allowing normal product work to retire findings incrementally.

## SonarQube Server mode

This repository uses **SonarQube Server with the SonarScanner for .NET**. SonarQube Cloud Automatic Analysis is not used.

The repository publication policy forbids repository or environment secrets in ordinary `pull_request` workflows. The SonarQube workflow therefore has no `pull_request` trigger:

- pushes to `main` are analyzed automatically;
- a trusted same-repository PR can be analyzed with `workflow_dispatch` by supplying its PR number after review;
- fork PRs and PRs whose base is not `main` are rejected by the privileged workflow;
- the workflow uses read-only GitHub permissions and does not post PR comments or statuses itself;
- the secret-bearing job runs behind the existing `syncfusion-licensed-build` protected environment, which is reused only as the repository's established trusted secret boundary.

The scanner authenticates to SonarQube Server with `SONAR_TOKEN` and `SONAR_HOST_URL`. The project key defaults to `NYGsatoshi_AIPsiteNYG` for migration continuity and can be overridden with the repository variable `SONAR_PROJECT_KEY`.

Analysis scope and duplication exclusions are passed directly to the scanner by `.github/workflows/sonarqube.yml`; the former SonarQube Cloud-only `.sonarcloud.properties` file is removed.

### One-time SonarQube Server setup

1. Configure the SonarQube Server GitHub App / DevOps Platform integration and bind the SonarQube project to `NYGsatoshi/Coglatas`.
2. Configure `SONAR_HOST_URL` and `SONAR_TOKEN` so they are available to the `syncfusion-licensed-build` protected environment. Use a project-scoped analysis token where possible.
3. If the migrated SonarQube project key differs from `NYGsatoshi_AIPsiteNYG`, set the repository variable `SONAR_PROJECT_KEY` to the actual key.
4. Configure the project Quality Gate for new code.
5. After the first successful decorated analysis, require the SonarQube Quality Gate status in the GitHub `main` ruleset/branch protection if it is intended to block merges.

For a trusted PR analysis, dispatch the `SonarQube` workflow from the protected repository context and set the `pr_number` input to the PR number. The workflow resolves the current same-repository PR head through the GitHub API, analyzes that exact commit, and passes explicit SonarQube pull-request parameters so the bound GitHub integration can decorate the PR.

Automatic secret-bearing analysis of arbitrary `pull_request` code is intentionally not enabled. If automatic PR analysis is introduced later, it must run behind a separately reviewed trusted CI boundary rather than weakening `GOV-TRUST-001`.

## Pull-request merge gates

Repository-defined pull-request checks must not gain general repository mutation authority. The CodeQL workflow is the single narrow exception: GitHub's advanced CodeQL setup requires `security-events: write` so SARIF can be published to Code Scanning, while fork `pull_request` runs still receive a read-only `GITHUB_TOKEN` and GitHub explicitly permits Code Scanning result upload for that event.

The PR-stage gates include:

- backend build/test
- frontend build/test
- security scan
- publication readiness
- frontend static analysis (`ESLint` + `Stylelint`)
- Qodana Community / .NET
- CodeQL semantic/data-flow analysis

For PRs that receive a trusted SonarQube analysis, the SonarQube Quality Gate is supplied by the SonarQube Server GitHub integration. The SonarQube workflow itself keeps GitHub permissions read-only; PR decoration is performed by the configured SonarQube GitHub App.

## Qodana policy

Qodana uses the `qodana.recommended` profile and additionally enables all inspections whose default JetBrains severity is `ERROR`, `WARNING`, or `WEAK WARNING`. Generated output, dependency directories, test artifacts, runtime data and the inactive legacy frontend scaffold remain excluded; first-party source and tests remain in scope.

For pull requests, Qodana runs in PR mode and preserves the full inspection inventory. Before the scan, the workflow records the exact `base...HEAD` changed-file set; after a successful scan, the SARIF guard rejects any Qodana problem located in one of those changed files. The native total-problem `--fail-threshold` is not used as the PR gate because, without a stable matching baseline, it also counts the repository's historical findings under the strict profile. The workflow has read-only repository permissions, does not post comments or annotations, does not push fixes, and uses no Qodana token because the Community linter does not require one.

For `main`, scheduled and manually dispatched full-repository scans, historical non-critical debt remains visible rather than making the lane permanently red. The post-processing guard still fails on any Critical finding, any unresolved-symbol finding, project-model/restore/build/SDK/package-resolution failure, missing SARIF output, or Qodana execution failure.
