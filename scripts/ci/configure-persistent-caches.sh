#!/usr/bin/env bash
set -Eeuo pipefail

cache_root="${AIPSITE_CI_CACHE_ROOT:-$HOME/.cache/aipsite-ci}"
nuget_packages="$HOME/.nuget/packages"
nuget_http_cache="$cache_root/nuget/http-cache"
angular_cache_root="$cache_root/angular"

mkdir -p \
  "$nuget_packages" \
  "$nuget_http_cache" \
  "$angular_cache_root"

if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    echo "AIPSITE_CI_CACHE_ROOT=$cache_root"
    echo "NUGET_PACKAGES=$nuget_packages"
    echo "NUGET_HTTP_CACHE_PATH=$nuget_http_cache"
    echo "NUGET_XMLDOC_MODE=skip"
    echo "npm_config_prefer_offline=true"
    echo "npm_config_audit=false"
    echo "npm_config_fund=false"
  } >> "$GITHUB_ENV"
fi

if [[ "${CI_ENABLE_ANGULAR_CACHE:-0}" == "1" && -d frontend && -f frontend/package-lock.json && -f frontend/angular.json ]]; then
  angular_key="$({
    sha256sum frontend/package-lock.json
    sha256sum frontend/angular.json
    find frontend -maxdepth 1 -type f -name 'tsconfig*.json' -print0 \
      | sort -z \
      | xargs -0 -r sha256sum
  } | sha256sum | cut -d' ' -f1)"

  angular_cache="$angular_cache_root/$angular_key"
  mkdir -p "$angular_cache" frontend/.angular
  rm -rf frontend/.angular/cache
  ln -s "$angular_cache" frontend/.angular/cache

  find "$angular_cache_root" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    -mtime +14 \
    -exec rm -rf {} + 2>/dev/null || true
fi

printf 'Persistent CI cache root: %s\n' "$cache_root"
printf 'NuGet packages cache: %s\n' "$nuget_packages"
printf 'NuGet HTTP cache: %s\n' "$nuget_http_cache"
if [[ -L frontend/.angular/cache ]]; then
  printf 'Angular build cache: %s\n' "$(readlink frontend/.angular/cache)"
fi
