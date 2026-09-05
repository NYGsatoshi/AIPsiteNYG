# Frontend inspections

This isolated toolchain provides broad static-analysis coverage without changing the active Angular application's dependency lockfile. The inspection workspace has its own committed lockfile so CI and local verification resolve the same toolchain deterministically.

Coverage:

- JavaScript: all ESLint core rules.
- TypeScript and Playwright TypeScript: all typescript-eslint rules plus strict and stylistic typed profiles.
- Angular TypeScript: all Angular ESLint TypeScript rules, including inline templates.
- Angular HTML templates: all Angular ESLint template rules, including accessibility rules.
- CSS and SCSS: the coherent Stylelint standard SCSS profile.

The default invocation is inventory mode: all configured rules run and reports are uploaded, but existing findings do not fail the command. Fatal ESLint parser/configuration errors still fail.

`--enforce` is the blocking regression mode used by the `Frontend Static Analysis` workflow. It compares current findings with the committed `baseline.json` and enforces a debt ceiling for each lint rule. A pull request fails when the repository-wide count for any ESLint or Stylelint rule increases above the accepted baseline. Existing findings remain visible without requiring unrelated PRs to eliminate the backlog wholesale, while each rule's total debt cannot grow.

Line and column positions are deliberately excluded. Fixing an existing finding can offset a new finding of the same rule elsewhere, so the gate is a rule-level debt ceiling rather than an exact per-line baseline.

```bash
npm ci
npm ci --prefix frontend
npm ci --prefix tools/frontend-inspections
node tools/frontend-inspections/run.mjs
node tools/frontend-inspections/run.mjs --verbose
node tools/frontend-inspections/run.mjs --enforce
```

For the repository's fail-closed install-script, lockfile, and dependency-tree policy, use `scripts/ci/npm-ci-retry.sh` for the relevant workspace.

To intentionally replace the accepted baseline after reviewing a lint migration or policy change, run:

```bash
node tools/frontend-inspections/run.mjs --update-baseline
git diff -- tools/frontend-inspections/baseline.json
```

Baseline updates are policy changes: review the diff rather than regenerating the file only to make a failing PR green.
