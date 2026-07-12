#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

export DOTNET_CLI_TELEMETRY_OPTOUT="${DOTNET_CLI_TELEMETRY_OPTOUT:-1}"
export DOTNET_NOLOGO="${DOTNET_NOLOGO:-1}"

required_sdk="$(awk -F'"' '/"version"[[:space:]]*:/ { print $4; exit }' global.json)"
if [[ -z "$required_sdk" ]]; then
  echo "Unable to read sdk.version from global.json" >&2
  exit 1
fi

install_dotnet_sdk() {
  local install_dir="${QODANA_DOTNET_INSTALL_DIR:-/usr/share/dotnet}"
  local installer="/tmp/dotnet-install.sh"

  if [[ ! -w "$install_dir" ]]; then
    if command -v sudo >/dev/null 2>&1; then
      curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$installer"
      sudo bash "$installer" --version "$required_sdk" --install-dir "$install_dir" --no-path
      return
    fi

    install_dir="${HOME}/.dotnet"
    mkdir -p "$install_dir"
  fi

  curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$installer"
  bash "$installer" --version "$required_sdk" --install-dir "$install_dir" --no-path
  export DOTNET_ROOT="$install_dir"
  export PATH="$install_dir:$PATH"
}

if ! dotnet --list-sdks 2>/dev/null | awk '{ print $1 }' | grep -Fxq "$required_sdk"; then
  echo "Installing .NET SDK $required_sdk required by global.json"
  install_dotnet_sdk
fi

echo "Using .NET SDKs:"
dotnet --list-sdks
dotnet --info
dotnet msbuild -version

echo "Restoring canonical solution AipPortal.slnx"
dotnet restore AipPortal.slnx --verbosity normal

echo "Building canonical solution AipPortal.slnx"
dotnet build AipPortal.slnx --configuration Release --no-restore

if command -v npm >/dev/null 2>&1; then
  echo "Using Node.js $(node --version)"
  echo "Using npm $(npm --version)"

  echo "Restoring root UI test dependencies"
  npm ci --no-audit --no-fund

  echo "Restoring active Angular workspace dependencies"
  npm --prefix frontend ci --no-audit --no-fund

  echo "Building active Angular workspace"
  npm --prefix frontend run build
else
  if [[ "${QODANA_FRONTEND_REQUIRED:-false}" == "true" ]]; then
    echo "npm is required for qodana-dotnet full-stack analysis but is unavailable." >&2
    exit 1
  fi

  echo "npm is unavailable; skipping frontend bootstrap for the Community .NET-only linter."
fi
