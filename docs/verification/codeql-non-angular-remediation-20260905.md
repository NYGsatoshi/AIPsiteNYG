# Non-Angular CodeQL remediation evidence — 2026-09-05

## Scope

This branch remediates the 12 CodeQL alerts identified on baseline `f65673f2078360b84efe077bd73dee5799a0cdb3` that are independent of the Angular upgrade work.

This work is intentionally isolated on `security/codeql-non-angular-remediation` and must not be merged to `main` until the Angular update completes. After the Angular work lands, this branch must be synchronized with the resulting `main` and revalidated before merge.

## Alert inventory and result

Initial branch-wide SARIF inventory:

- GitHub Actions: 0
- Python: 4 (`py/clear-text-logging-sensitive-data`)
- C#: 7 (`cs/log-forging` ×2, `cs/user-controlled-bypass` ×5)
- JavaScript/TypeScript: 1 (`js/incomplete-url-substring-sanitization`)
- Total: 12

Final branch-wide diagnostic SARIF run `33971234859` at `ab754dc6b416764da77683420c1445f5a5e75c98`:

- GitHub Actions: 0
- Python: 0
- C#: 0
- JavaScript/TypeScript: 0
- Total: 0

The diagnostic workflow used `github/codeql-action@v4` with `build-mode: none`, `upload: false`, and retained one-day SARIF artifacts for all four languages. The temporary diagnostic workflow was removed after evidence collection.

## Remediation summary

- Governance/final-gate Python scripts no longer print live GitHub API-derived payload details or identities into CI logs; output is reduced to bounded decision/status projections.
- CSRF warning logging strips CR/LF from request method/path before structured logging.
- File move authorization is resolved before client-controlled version validation, and move versions are constrained at the API model boundary.
- Artifact report refinement confirmation shape/version validation is enforced through API model validation before the controller invokes the sensitive refinement service.
- Task Watch version validation is enforced at the API model boundary; user-controlled negative-version branching no longer controls later current-state reauthorization.
- Tenant metadata export no longer accepts a client-selectable export type on the metadata export request; the service uses the fixed Metadata operation and retains build/delivery reauthorization.
- The Syncfusion theme sanitizer test verifies the exact sanitized output rather than using an incomplete URL-substring check.

## Verification

One-shot verification run `33971132341` succeeded before the final remediation commit:

- bounded patch application: pass
- `git diff --check`: pass
- `dotnet restore AipPortal.slnx`: pass
- Release build: pass
- focused Task command, Tenant export authorization, and Artifact refinement tests: pass
- one-shot patch workflow removed itself after success

Final remediation implementation commit: `dd396d60f61cda6c160a6d5fa6fdbdaac8b81717`.

Final cleanup commit after deleting the temporary CodeQL diagnostic workflow: `bcb683a00fa2a736f086dd781fecd18012a29741`.

## Merge hold

At evidence capture, `main` had advanced independently beyond the original baseline. Do not merge this branch while the Angular update is still in progress.

Required post-Angular sequence:

1. synchronize this branch with the completed Angular-update `main`;
2. resolve any collisions without dropping either security or Angular changes;
3. rerun CodeQL and the affected build/test gates on the synchronized head;
4. only then evaluate merge readiness.
