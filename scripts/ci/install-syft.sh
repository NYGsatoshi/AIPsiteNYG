#!/usr/bin/env bash
set -euo pipefail

readonly SYFT_VERSION="1.51.0"
readonly SYFT_LINUX_AMD64_ARCHIVE_SHA256="2a2e837a2c8d59ec9af5472ee22d3b04ee463c4e44476ecf993fd1e5ab6ebc7f"
readonly ARCHIVE="syft_${SYFT_VERSION}_linux_amd64.tar.gz"
readonly URL="https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/${ARCHIVE}"

install_dir="${1:-${RUNNER_TEMP:-/tmp}/aipsite-syft/bin}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$install_dir"
curl --fail --silent --show-error --location "$URL" --output "$tmp_dir/$ARCHIVE"
printf '%s  %s\n' "$SYFT_LINUX_AMD64_ARCHIVE_SHA256" "$tmp_dir/$ARCHIVE" | sha256sum --check --strict
tar -xzf "$tmp_dir/$ARCHIVE" -C "$tmp_dir" syft
install -m 0755 "$tmp_dir/syft" "$install_dir/syft"

version_output="$($install_dir/syft version)"
printf '%s\n' "$version_output"
printf '%s\n' "$version_output" | grep -Eq "Version:[[:space:]]*${SYFT_VERSION}([[:space:]]|$)" || {
  echo "Installed Syft version does not match pinned version ${SYFT_VERSION}." >&2
  exit 1
}

if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$install_dir" >> "$GITHUB_PATH"
else
  printf 'Add %s to PATH to use Syft.\n' "$install_dir"
fi
