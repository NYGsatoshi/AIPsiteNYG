#!/usr/bin/env bash
set -euo pipefail

readonly GRYPE_VERSION="0.118.0"
readonly GRYPE_LINUX_AMD64_ARCHIVE_SHA256="1d444c5e7360471815f7158f71935fcecc68a3c417d85c7344f770854300bba2"
readonly ARCHIVE="grype_${GRYPE_VERSION}_linux_amd64.tar.gz"
readonly URL="https://github.com/anchore/grype/releases/download/v${GRYPE_VERSION}/${ARCHIVE}"

install_dir="${1:-${RUNNER_TEMP:-/tmp}/aipsite-grype/bin}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$install_dir"
curl --fail --silent --show-error --location "$URL" --output "$tmp_dir/$ARCHIVE"
printf '%s  %s\n' "$GRYPE_LINUX_AMD64_ARCHIVE_SHA256" "$tmp_dir/$ARCHIVE" | sha256sum --check --strict
tar -xzf "$tmp_dir/$ARCHIVE" -C "$tmp_dir" grype
install -m 0755 "$tmp_dir/grype" "$install_dir/grype"

version_output="$($install_dir/grype version)"
printf '%s\n' "$version_output"
printf '%s\n' "$version_output" | grep -Eq "Version:[[:space:]]*${GRYPE_VERSION}([[:space:]]|$)" || {
  echo "Installed Grype version does not match pinned version ${GRYPE_VERSION}." >&2
  exit 1
}

if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$install_dir" >> "$GITHUB_PATH"
else
  printf 'Add %s to PATH to use Grype.\n' "$install_dir"
fi
