# Publicization runbook

This runbook prepares AIPsiteNYG for a deliberate change from private to public
visibility without converting it into an open-source project.

The repository must remain private until every mandatory gate below is complete.

## 1. Freeze the publication candidate

- [ ] Merge all intended preparation changes.
- [ ] Stop unrelated merges while the final audit is running.
- [ ] Record the exact candidate commit SHA.
- [ ] Back up the private repository and its administrative settings.
- [ ] Confirm that no patent filing, competition rule, school obligation,
      confidentiality duty, or third-party agreement requires the code to remain
      non-public.

## 2. Confirm ownership and publication rights

- [ ] Review every material contribution and identify its copyright owner.
- [ ] Confirm that copied code, generated code, templates, screenshots, icons,
      fonts, fixtures, sample content, and documentation may be published.
- [ ] Remove material with unclear provenance.
- [ ] Confirm that `LICENSE`, `CONTRIBUTING.md`, and
      `THIRD_PARTY_NOTICES.md` express the intended source-visible,
      all-rights-reserved model.
- [ ] Confirm that no package/project metadata incorrectly labels AIPsiteNYG as
      MIT, Apache-2.0, GPL, or another open-source license.

## 3. Scan all Git data, not only the working tree

Run the final scan from a new clean clone and fetch every reachable ref.

```bash
git clone --mirror <private-repository-url> AIPsiteNYG-publicization.git
cd AIPsiteNYG-publicization.git
git fetch --all --tags --prune
```

Use the repository's approved version of Gitleaks, or an equivalent scanner, to
scan the complete Git history. The invocation must include all commits and refs,
not only the checked-out tree. Keep scanner output redacted.

- [ ] Default branch scanned.
- [ ] Historical commits scanned.
- [ ] All branches scanned.
- [ ] All tags scanned.
- [ ] Stashes or unpublished local branches containing publication material
      reviewed separately.
- [ ] Scan result attached to a private audit record without secret values.

When any credential or key is found:

1. revoke or rotate it before editing history;
2. identify every system that accepted it;
3. remove the material from Git history using the approved history-rewrite
   procedure;
4. force-update affected refs while the repository is still private;
5. require collaborators to replace old clones; and
6. repeat the full-history scan from a fresh clone.

Deleting a file in a new commit is not sufficient.

## 4. Review non-code repository surfaces

Review the following individually. Delete or sanitize anything that should not
become public.

- [ ] Issues and issue comments.
- [ ] Pull requests, reviews, comments, and attached files.
- [ ] Commit messages and author email addresses.
- [ ] GitHub Actions logs, summaries, caches, and artifacts.
- [ ] Playwright screenshots, traces, reports, and videos.
- [ ] Releases and release assets.
- [ ] Packages and container images associated with the repository.
- [ ] Wiki and Discussions content.
- [ ] Projects, deployment records, environments, and public deployment URLs.
- [ ] Security reports, SARIF uploads, dependency reports, and archived audit
      evidence.

Prefer deleting old workflow runs whose safety cannot be established. Do not
rely on secret masking as proof that every value and derivative artifact is
safe.

## 5. Review tracked content

- [ ] No `.env`, private key, certificate bundle, database dump, backup,
      production configuration, license file, or secrets directory is tracked.
- [ ] `.env.example` contains placeholders only.
- [ ] No real password, token, email address, student information, account ID,
      user-generated content, school-internal information, IP address, hostname,
      SSH username, storage path, or private endpoint is exposed unnecessarily.
- [ ] Demo and test data are synthetic.
- [ ] Archived documentation and evidence directories have been reviewed.
- [ ] Deployment scripts generate or consume secrets outside source control and
      do not embed live infrastructure identifiers.

Move internal-only deployment and operations material to a separate private
repository rather than relying on warnings in public documentation.

## 6. Syncfusion and dependency gate

- [ ] `SYNCFUSION_LICENSE` is stored only in an approved local, CI, or deployment
      secret store.
- [ ] No license value exists in source, Git history, logs, artifacts, images, or
      browser bundles.
- [ ] Docker builds use a secret mount and do not persist the value in an image
      layer.
- [ ] The built browser output is checked for accidental registration-key or
      configuration leakage.
- [ ] Every developer and deployment that uses Syncfusion has an independently
      valid license where required.
- [ ] NuGet/npm dependency and asset notices have been reviewed for public source
      publication and binary redistribution.

## 7. GitHub Actions gate

### Pull-request execution

- [ ] No fork or otherwise untrusted pull request can execute on a persistent
      self-hosted runner.
- [ ] PR jobs that must accept untrusted code use GitHub-hosted runners.
- [ ] A self-hosted PR job, when retained, has an explicit fail-closed condition
      that permits only a same-repository head branch owned by an authorized
      collaborator.
- [ ] `pull_request_target` is absent unless a separately reviewed workflow never
      checks out or executes pull-request-controlled content.

### Token and secret permissions

- [ ] Default workflow token permissions are read-only.
- [ ] Each workflow declares the minimum required `permissions`.
- [ ] Checkout steps use `persist-credentials: false` unless a reviewed write is
      essential.
- [ ] Fork PRs receive no repository or environment secrets.
- [ ] Deployment secrets are held in protected environments with approval.
- [ ] Third-party actions are reviewed and pinned according to repository policy.
- [ ] Shell commands do not interpolate untrusted PR titles, branch names, issue
      bodies, or other attacker-controlled strings directly.

Run the `Publicization Readiness` workflow on the frozen candidate commit and
retain the passing run URL in the private audit record.

## 8. Configure repository features before or immediately after visibility change

Repository settings are not carried by this pull request. Apply and verify them
administratively.

### Collaboration surface

- [ ] Set pull-request creation to **collaborators only**. If that control is not
      available for the current account/repository type, disable pull requests
      rather than accepting unsolicited public contributions.
- [ ] Disable or restrict Issues, Discussions, Wiki, and Projects unless they are
      intentionally public.
- [ ] Remove collaborators and installed apps that do not need access.
- [ ] Review webhooks, deploy keys, OAuth/GitHub Apps, and repository access
      tokens.

### Actions

- [ ] Set default `GITHUB_TOKEN` permission to read repository contents.
- [ ] Require approval for workflows from fork pull requests at the strictest
      practical level.
- [ ] Restrict which actions and reusable workflows may run.
- [ ] Verify every self-hosted runner group and label assignment.
- [ ] Keep deployment environments protected.

### Rulesets

Create separate rulesets so review bypass does not also bypass CI.

**Review policy**

- require a pull request before merging;
- require at least one approval for authorized collaborators;
- dismiss stale approvals;
- require conversation resolution; and
- allow the repository owner/administrator to bypass this review policy for pull
  requests only.

**CI policy**

- require the canonical backend, frontend, integration, browser, and security
  checks;
- do not give the owner or administrators a routine bypass; and
- block force pushes and branch deletion for the default branch.

- [ ] Test the rules with an authorized non-owner collaborator.
- [ ] Test owner merge without self-approval.
- [ ] Confirm both identities remain blocked while required CI is failing.

### Security features

- [ ] Enable the dependency graph and Dependabot alerts.
- [ ] Enable Dependabot security updates where appropriate.
- [ ] Enable secret scanning and push protection.
- [ ] Enable code scanning for supported languages.
- [ ] Enable private vulnerability reporting before directing reporters to it.

## 9. Change visibility

Only the repository owner should perform the visibility change.

- [ ] Reconfirm the frozen commit SHA.
- [ ] Reconfirm all mandatory gates are complete.
- [ ] Change visibility from private to public.
- [ ] Immediately re-open repository settings and verify that rulesets, Actions
      permissions, security controls, environments, and contribution restrictions
      remain enabled after the transition.

Treat publicization as irreversible disclosure. Returning the repository to
private visibility does not make previously fetched, forked, cached, indexed,
or archived material secret again.

## 10. Signed-out validation

From a signed-out browser or an unrelated non-collaborator account, verify:

- [ ] source and intended documentation are visible;
- [ ] no secret, internal data, private artifact, or unintended package is
      visible;
- [ ] the repository clearly states that it is not open source;
- [ ] unsolicited pull requests cannot be opened;
- [ ] issues/discussions/wiki match the chosen policy;
- [ ] Actions logs and artifacts expose only approved information; and
- [ ] external code cannot reach a self-hosted runner.

Record the date, candidate SHA, tester identity category, and result without
recording credentials or personal data.

## Final authorization

The repository may be treated as ready only when
`docs/PUBLICIZATION_AUDIT.md` has no open Critical or High blocking finding and
every mandatory checkbox in this runbook is complete. This document does not
itself authorize publicization.
