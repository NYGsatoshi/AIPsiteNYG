# Owner-controlled default-branch rulesets

These JSON files are the import payloads for the simplified single-maintainer protection model.

## Security model

- `NYGsatoshi` (GitHub user id `285141121`) is the only intended default-branch update authority.
- The owner is configured with `bypass_mode: always` so normal development cannot be deadlocked by repository-owned Governance CI.
- Non-owner actors do not receive a ruleset bypass.
- `Owner Merge Authority` uses the branch `update` restriction so a future collaborator does not automatically gain authority to update `main`.
- Ordinary CI remains available and is required for non-bypassing actors: `build-test`, `frontend-test`, `security-scan`, and `publication-readiness`.
- Required signatures remain enabled for non-bypassing actors. The owner may bypass them when necessary; GitHub Web squash merge remains preferred when a Verified final commit is desired.

## Import order

1. Import/update `01-public-main-owner-controlled.json`.
2. Import/update `02-prreview-owner-bypass.json`.
3. Import/update and activate `03-owner-merge-authority.json`.
4. Confirm the only bypass actor in all three rulesets is `User:285141121` with mode `always`.
5. Confirm the strict ruleset no longer requires `External PR approval policy` or `GOV-RULESET-001`.

The legacy ruleset names are intentionally retained where practical to avoid unnecessary identity migration. These files describe GitHub repository administration state; they are not consumed as a blocking live-drift Governance CI contract.
