# Dependabot / dependency alert remediation audit — 2026-08-01

## Scope and evidence boundary

The connected GitHub API used for this remediation does not expose the repository Security tab's individual Dependabot alert records. The current vulnerable dependency trees were therefore reconstructed from:

- `.github/dependabot.yml` monitored ecosystems and directories;
- the repository's `npm Security Audit` workflow output;
- the main CI security scan for NuGet, Gitleaks, and Trivy;
- the exact `package.json` and `package-lock.json` files on `main` and this branch.

This report does not claim that Security-tab alert IDs or dismissal states were read directly.

## Baseline on main

| Scope | Low | Moderate | High | Critical | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Root npm workspace | 0 | 0 | 0 | 0 | 0 |
| Active `frontend/` | 3 | 7 | 10 | 0 | 20 |
| Inactive `aipsite-frontend/` | 0 | 5 | 7 | 0 | 12 |

The npm totals include parent packages and transitive dependency paths. They are not 32 independent vulnerabilities.

Additional security scan results on main:

- NuGet vulnerable packages: 0
- Runtime container Trivy HIGH/CRITICAL: 0
- Gitleaks findings: 0
- `xunit` 2.9.3 is reported as deprecated/legacy, not as a known vulnerable package; migration to xUnit v3 is separate major work.

## Applied changes

### Active `frontend/`

- Align Angular framework packages from 21.2.17 to 21.2.19.
- Align `@angular/build`, `@angular/cli`, and `@angular/compiler-cli` from 21.2.17 to 21.2.19.
- Add reviewed transitive overrides for:
  - `undici` 7.28.0
  - `@babel/core` 7.29.7
  - `http-proxy-middleware` 3.0.7
  - `esbuild` 0.28.1
  - `ajv` 8.18.0
  - `picomatch` 4.0.4
  - `http-auth` 4.2.1
  - `uuid` 11.1.1
  - `body-parser` 1.20.6

### Inactive `aipsite-frontend/`

- Align Angular framework, compiler, and platform-browser-dynamic packages from 21.2.18 to 21.2.19.
- Preserve the existing reviewed security overrides.

### Lockfiles

Both npm lockfiles were regenerated from the reviewed manifests with npm 11.17.0 and Node.js 24. Dependency lifecycle scripts were disabled during generation and deterministic-install validation.

Validation completed successfully:

```text
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm --prefix aipsite-frontend ci --ignore-scripts --no-audit --no-fund
```

## Prohibited automatic fixes

The following audit suggestions are not accepted automatically:

- `npm audit fix --force`
- Angular 22 major migration inside this remediation PR
- Angular CLI downgrade to 21.0.4
- Storybook downgrade to 6.5.x

These suggestions can change framework contracts or are audit-resolution artifacts rather than safe security patches.

## Residual-alert classification

The exact regenerated-lockfile audit is re-run by the normal `npm Security Audit` PR workflow. Any remaining entries must be classified as one of:

1. fixable by a compatible direct or transitive update;
2. upstream-blocked within Angular 21 / Storybook 10;
3. requiring a separately reviewed major framework migration;
4. development-only exposure with compensating controls and documented acceptance.

No residual alert may be silently dismissed solely to obtain a green status.

## Merge gate

Current recommendation: **No-Go / Draft** until all of the following are complete:

- regenerated-lockfile npm audit reviewed;
- active Angular build and unit tests pass;
- Storybook build passes;
- Playwright checks pass;
- backend/security CI passes;
- any residual high-severity advisory has an explicit disposition.
