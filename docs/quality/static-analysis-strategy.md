# Static analysis strategy

## Responsibility split

| Tool | Role | Execution |
| --- | --- | --- |
| SonarQube Cloud | Repository-wide quality gate across C#, JavaScript, TypeScript, HTML, CSS and SCSS | Automatic Analysis on every PR update and every push to `main` |
| ESLint + angular-eslint | JavaScript, TypeScript and Angular template policy | `Frontend Static Analysis` on every PR and `main` push; blocking |
| Stylelint | CSS and SCSS policy | `Frontend Static Analysis` on every PR and `main` push; blocking |
| Qodana Community for .NET | JetBrains/.NET second-opinion and project-model deep inspection | `main`, weekly schedule and manual dispatch; non-blocking scan findings, project-model guard remains hard-fail when the scan completes |
| CodeQL | Security-oriented semantic/data-flow analysis | trusted `main` pushes and weekly schedule |

The tools intentionally overlap at the language level but not at the policy level. SonarQube is the primary cross-stack quality view, ESLint/Stylelint enforce frontend-specific rules, CodeQL owns security analysis, and Qodana remains a JetBrains-derived deep inspection lane for .NET.

## Frontend lint debt baseline

`Frontend Static Analysis` is blocking, but it does not require unrelated pull requests to eliminate the repository's pre-existing ESLint and Stylelint backlog. `tools/frontend-inspections/baseline.json` records the accepted repository-wide finding count for each lint rule.

Enforce mode fails when the count for any ESLint or Stylelint rule exceeds that committed baseline. Existing findings remain present in the uploaded reports, while each rule's total debt is prevented from growing. The baseline is position-independent; fixing an existing finding can offset a new finding of the same rule elsewhere, so this is a rule-level debt ceiling rather than an exact per-line baseline.

Refreshing the baseline with `node tools/frontend-inspections/run.mjs --update-baseline` is an explicit policy change and should be reviewed as such; it must not be used as an automatic CI escape hatch.

## SonarQube Cloud mode

This repository uses **SonarQube Cloud Automatic Analysis**, not a token-bearing GitHub Actions scanner.

The repository publication policy forbids secrets in `pull_request` workflows. Automatic Analysis reads the bound GitHub repository directly, so PR analysis does not require `SONAR_TOKEN` in an untrusted PR workflow.

Repository-side scope configuration is stored in `.sonarcloud.properties`.

### One-time SonarQube Cloud setup

1. Import `NYGsatoshi/AIPsiteNYG` into SonarQube Cloud through the GitHub integration.
2. In the project, open **Administration > Analysis Method** and enable **Automatic Analysis**.
3. Keep CI-based Sonar scanning disabled for this project; Automatic Analysis and CI-based analysis must not run together.
4. Configure the project Quality Gate for new code.
5. In the GitHub `main` ruleset/branch protection, require the SonarQube Quality Gate status after its first successful report.

Automatic Analysis should then run on each push to `main` and on each update to a pull-request branch.

## Pull-request merge gates

Repository-defined blocking checks remain read-only on public pull requests:

- backend build/test
- frontend build/test
- security scan
- publication readiness
- frontend static analysis (`ESLint` + `Stylelint`)

The SonarQube Quality Gate is supplied by the SonarQube Cloud GitHub integration rather than by a secret-bearing workflow in this repository.

## Qodana policy

Qodana is deliberately not duplicated on every PR. It performs one full .NET inventory on trusted `main` revisions, weekly, or when manually dispatched. Normal Qodana findings are second-opinion evidence and do not block the workflow by themselves; a successful scan is still checked by `scripts/quality/check-qodana-project-model.mjs` so SDK/restore/solution/project-model collapse remains visible as a hard failure.
