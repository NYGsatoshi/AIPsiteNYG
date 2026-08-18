# Self-hosted GitHub Actions runner pool

## Purpose

One self-hosted runner process can execute only one GitHub Actions job at a time.
The repository currently has four independent heavy jobs that can otherwise wait
in a queue:

- `CI / build-test`
- `CI / security-scan`
- `Code Quality / Qodana Community / .NET`
- `Code Quality / Angular / TypeScript / JavaScript / HTML / SCSS / CSS`

The repository-authored workflows already use `runs-on: self-hosted`. GitHub
automatically distributes queued jobs across every online repository runner that
matches the default `self-hosted`, `Linux`, and architecture labels. No workflow
matrix or artificial job dependency is required.

This repository therefore provides an installer that adds three independent
runner services beside the existing `aipsiteci` runner, giving four concurrent
execution slots in total.

## Automatic NuGet dependency submission

NuGet automatic dependency submission is a GitHub-managed workflow rather than a
workflow YAML stored in this repository. It therefore does not inherit the
`runs-on: self-hosted` setting from `ci.yml` or the other repository workflows.

GitHub routes automatic dependency submission to self-hosted runners when both of
the following are true:

1. the eligible self-hosted runner has the custom label `dependency-submission`;
2. **Settings > Security > Advanced Security > Dependency graph > Automatic
   dependency submission** is set to **Enabled for labeled runners**.

The runner-pool installer now assigns both `aipsiteci-pool` and
`dependency-submission` to every newly registered runner by default. This makes
new pool members eligible for the GitHub-managed NuGet submission jobs as soon as
the repository setting above is enabled.

The installer intentionally preserves existing `.runner` registrations. Running
it again therefore does not mutate labels on runners that are already registered.
For the existing `aipsiteci`, `aipsiteci-2`, `aipsiteci-3`, and `aipsiteci-4`
runners, open **Settings > Actions > Runners**, select each runner, and add the
`dependency-submission` custom label. Assigning it to all four runners allows the
GitHub-managed submission jobs to use the same pool instead of falling back to
GitHub-hosted infrastructure.

## Isolation model

Each additional runner uses:

- a distinct Linux account;
- a distinct home directory;
- a distinct runner installation directory;
- a distinct `_work` directory;
- an independent systemd service;
- membership in the host `docker` group.

Separate Linux accounts are intentional. The CI workflows use paths under
`$HOME` for the .NET SDK, while Docker-based inspections can write files as root.
Using independent accounts prevents concurrent jobs from racing over the same
`.NET`, NuGet, npm, temporary, or checkout directories.

## Install three additional runners

Generate a fresh repository registration token immediately before installation:

1. Open the repository on GitHub.
2. Open **Settings**.
3. Open **Actions > Runners**.
4. Select **New self-hosted runner**.
5. Copy the short-lived registration token from the generated `config.sh`
   command.

On the runner server, update the repository checkout containing this script and
run:

```bash
cd /home/adminhome/actions-runner/_work/AIPsiteNYG/AIPsiteNYG

git fetch origin
git checkout ci/self-hosted-runner-pool
git pull --ff-only

sudo RUNNER_TOKEN='REPLACE_WITH_FRESH_TOKEN' \
  ./scripts/ci/install-self-hosted-runner-pool.sh \
  --url https://github.com/NYGsatoshi/AIPsiteNYG
```

The default installation adds:

| Runner | Linux user | Installation directory | Custom labels for new registrations |
|---|---|---|---|
| `aipsiteci-2` | `aiprunner2` | `/opt/aipsite-actions-runners/aipsiteci-2` | `aipsiteci-pool`, `dependency-submission` |
| `aipsiteci-3` | `aiprunner3` | `/opt/aipsite-actions-runners/aipsiteci-3` | `aipsiteci-pool`, `dependency-submission` |
| `aipsiteci-4` | `aiprunner4` | `/opt/aipsite-actions-runners/aipsiteci-4` | `aipsiteci-pool`, `dependency-submission` |

The existing `aipsiteci` service remains unchanged and supplies the fourth slot.
Add the `dependency-submission` label to that existing registration separately.

## Verify

Check GitHub under **Settings > Actions > Runners**. All four runners should be
online and idle before a workflow starts. Confirm that every runner intended for
NuGet automatic dependency submission shows the `dependency-submission` label.

On the server:

```bash
systemctl list-units --type=service 'actions.runner.*'
```

Inspect one service when necessary:

```bash
sudo systemctl status 'actions.runner.*aipsiteci-2*' --no-pager
```

Trigger a pull-request workflow and confirm that Build, Security, Qodana, and
Frontend obtain different runner names in their **Set up job** logs.

After switching Automatic dependency submission to **Enabled for labeled
runners**, trigger or wait for a NuGet dependency submission and confirm its
**Set up job** step names one of the `aipsiteci*` self-hosted runners rather than
a GitHub-hosted image.

## Capacity warning

Four concurrent jobs remove queueing but increase peak CPU, memory, disk I/O,
and Docker pressure. Qodana, the Docker image build/Trivy scan, the .NET test job,
and the Angular job can all be active simultaneously.

On an 8 GB host, configure swap before enabling all four slots. A practical
baseline is 8–16 GB of swap. Monitor the first full concurrent run:

```bash
free -h
vmstat 1
sudo docker stats
```

When the host is resource-constrained, install only one or two additional
runners instead:

```bash
sudo RUNNER_TOKEN='REPLACE_WITH_FRESH_TOKEN' \
  ./scripts/ci/install-self-hosted-runner-pool.sh \
  --url https://github.com/NYGsatoshi/AIPsiteNYG \
  --count 1
```

That gives two total concurrent slots: the existing runner plus one additional
runner.

## Re-running the installer

The installer is idempotent for already configured directories. It preserves an
existing `.runner` registration and starts the service when needed. Use a new
registration token only when adding runner instances that have not yet been
configured.

Because GitHub does not apply new `config.sh --labels` values to an already
registered runner, relabel existing runners in **Settings > Actions > Runners**.
The installer does not delete or reconfigure the existing
`/home/adminhome/actions-runner` instance.
