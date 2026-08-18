#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Install additional GitHub Actions runners on the current Linux host.

The existing runner remains in place. By default this script adds three more
runner services, allowing up to four self-hosted jobs to execute concurrently.

Usage:
  sudo RUNNER_TOKEN='<registration-token>' \
    ./scripts/ci/install-self-hosted-runner-pool.sh \
    --url https://github.com/NYGsatoshi/AIPsiteNYG

Options:
  --url URL               Repository or organization URL. Required.
  --token TOKEN           Registration token. Prefer RUNNER_TOKEN instead.
  --count NUMBER          Additional runners to create. Default: 3.
  --start-index NUMBER    First numeric suffix. Default: 2.
  --name-prefix PREFIX    Runner name prefix. Default: aipsiteci.
  --user-prefix PREFIX    Linux account prefix. Default: aiprunner.
  --root PATH             Installation root. Default: /opt/aipsite-actions-runners.
  --version VERSION       actions/runner version. Default: 2.335.1.
  --labels LABELS         Additional comma-separated labels.
                          Default: aipsiteci-pool.
  -h, --help              Show this help.

A repository registration token is short-lived. Generate it immediately before
running this script from Settings > Actions > Runners > New self-hosted runner.
EOF
}

repo_url=""
runner_token="${RUNNER_TOKEN:-}"
runner_count=3
start_index=2
name_prefix="aipsiteci"
user_prefix="aiprunner"
install_root="/opt/aipsite-actions-runners"
runner_version="2.335.1"
extra_labels="aipsiteci-pool"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      repo_url="${2:-}"
      shift 2
      ;;
    --token)
      runner_token="${2:-}"
      shift 2
      ;;
    --count)
      runner_count="${2:-}"
      shift 2
      ;;
    --start-index)
      start_index="${2:-}"
      shift 2
      ;;
    --name-prefix)
      name_prefix="${2:-}"
      shift 2
      ;;
    --user-prefix)
      user_prefix="${2:-}"
      shift 2
      ;;
    --root)
      install_root="${2:-}"
      shift 2
      ;;
    --version)
      runner_version="${2:-}"
      shift 2
      ;;
    --labels)
      extra_labels="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Run this installer with sudo or as root." >&2
  exit 1
fi

if [[ -z "$repo_url" ]]; then
  echo "--url is required." >&2
  exit 2
fi

if [[ -z "$runner_token" ]]; then
  echo "Set RUNNER_TOKEN or provide --token." >&2
  exit 2
fi

if ! [[ "$runner_count" =~ ^[1-9][0-9]*$ ]]; then
  echo "--count must be a positive integer." >&2
  exit 2
fi

if ! [[ "$start_index" =~ ^[1-9][0-9]*$ ]]; then
  echo "--start-index must be a positive integer." >&2
  exit 2
fi

for command_name in curl tar useradd usermod systemctl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

if ! getent group docker >/dev/null 2>&1; then
  echo "Docker group does not exist. Install Docker before adding the runner pool." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64)
    runner_arch="x64"
    ;;
  aarch64|arm64)
    runner_arch="arm64"
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

cache_dir="$install_root/cache"
archive_name="actions-runner-linux-${runner_arch}-${runner_version}.tar.gz"
archive_path="$cache_dir/$archive_name"
download_url="https://github.com/actions/runner/releases/download/v${runner_version}/${archive_name}"

install -d -m 0755 "$cache_dir"

if [[ ! -s "$archive_path" ]]; then
  echo "Downloading actions/runner v${runner_version} for ${runner_arch}..."
  curl --fail --location --retry 3 --output "$archive_path" "$download_url"
fi

last_index=$((start_index + runner_count - 1))

for index in $(seq "$start_index" "$last_index"); do
  runner_name="${name_prefix}-${index}"
  runner_user="${user_prefix}${index}"
  runner_dir="$install_root/$runner_name"

  echo
  echo "Configuring $runner_name as Linux user $runner_user"

  if ! id "$runner_user" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$runner_user"
  fi

  usermod --append --groups docker "$runner_user"
  install -d -o "$runner_user" -g "$runner_user" -m 0755 "$runner_dir"

  if [[ ! -x "$runner_dir/config.sh" ]]; then
    tar --extract --gzip --file "$archive_path" --directory "$runner_dir"
    chown -R "$runner_user:$runner_user" "$runner_dir"
  fi

  if [[ ! -f "$runner_dir/.runner" ]]; then
    runuser -u "$runner_user" -- \
      "$runner_dir/config.sh" \
      --unattended \
      --url "$repo_url" \
      --token "$runner_token" \
      --name "$runner_name" \
      --labels "$extra_labels" \
      --work _work \
      --replace
  else
    echo "$runner_name is already configured; preserving its registration."
  fi

  if [[ ! -f "$runner_dir/.service" ]]; then
    (
      cd "$runner_dir"
      ./svc.sh install "$runner_user"
    )
  fi

  (
    cd "$runner_dir"
    ./svc.sh start
    ./svc.sh status
  )
done

cat <<EOF

Runner pool installation completed.

Existing runner: expected to provide one concurrent slot.
Additional runners installed: $runner_count
Expected total concurrent self-hosted jobs: $((runner_count + 1))

All added runners have the default self-hosted/Linux architecture labels plus:
  $extra_labels

Verify them in GitHub:
  Settings > Actions > Runners
EOF
