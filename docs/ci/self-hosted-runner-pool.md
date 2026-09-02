# Self-hosted GitHub Actions runner boundary

## Current role

Normal AIPsiteNYG build, test, security, browser, MBJ, WPC, documentation, and
Qodana compute runs on Travis CI.

The previous four-slot self-hosted GitHub Actions pool is no longer part of the
normal pull-request CI design. Do not scale or keep that pool online merely to
service deleted CI workflows.

## Remaining GitHub-native use

The explicit workflow

```text
.github/workflows/nuget-dependency-submission-self-hosted.yml
```

remains GitHub Actions because its purpose is to submit dependency metadata to
GitHub's dependency graph. If this workflow is retained, at least one eligible
self-hosted runner must remain available for it.

GitHub Automatic dependency submission should remain disabled so it does not
create a second dynamic NuGet submission path.

The protected public-HTTPS workflow is a target-environment release gate rather
than general CI. Runner provisioning for that environment is an operational
deployment concern and is not a reason to duplicate normal Travis compute.

## Retired pool installer

`scripts/ci/install-self-hosted-runner-pool.sh` is retained only as historical
operational tooling. It must not be interpreted as evidence that four concurrent
GitHub Actions CI runners are still required.

If extra runner services were previously installed only for AIPsiteNYG CI,
they can be stopped after Travis is the required merge gate and no other
repository workflow depends on them.

## Branch protection

After the Travis migration, remove deleted GitHub Actions job names from branch
protection and require the Travis PR status instead. Branch-protection settings
live outside this repository and are not changed by a source-code PR.
