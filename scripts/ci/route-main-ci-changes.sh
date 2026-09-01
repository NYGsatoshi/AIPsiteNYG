#!/usr/bin/env bash
set -Eeuo pipefail

zero_sha="0000000000000000000000000000000000000000"
base_sha="${BASE_SHA:-}"
head_sha="${HEAD_SHA:-${GITHUB_SHA:-}}"
output_file="${GITHUB_OUTPUT:-}"
summary_file="${GITHUB_STEP_SUMMARY:-}"

keys=(
  backend
  frontend
  frontend_build
  frontend_unit
  frontend_architecture
  frontend_license_guard
  frontend_storybook
  frontend_playwright
  security
  security_dotnet
  security_compose
  security_migration
  security_image
)

write_output() {
  local key="$1"
  local value="$2"
  if [[ -n "$output_file" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$output_file"
  else
    printf '%s=%s\n' "$key" "$value"
  fi
}

route_all() {
  local key
  for key in "${keys[@]}"; do
    write_output "$key" "true"
  done
  write_output "frontend_unit_scope" "full"
  write_output "frontend_unit_features" ""
  if [[ -n "$summary_file" ]]; then
    echo "Unable to establish a safe diff base; all CI work is enabled." >> "$summary_file"
  fi
}

if [[ -z "$base_sha" || "$base_sha" == "$zero_sha" || -z "$head_sha" ]] || \
   ! git cat-file -e "${base_sha}^{commit}" 2>/dev/null || \
   ! git cat-file -e "${head_sha}^{commit}" 2>/dev/null; then
  route_all
  exit 0
fi

changed_file_list="${RUNNER_TEMP:-/tmp}/ci-changed-files.txt"
git diff --name-only "$base_sha" "$head_sha" > "$changed_file_list"

backend=false
frontend=false
frontend_build=false
frontend_unit=false
frontend_unit_full=false
frontend_architecture=false
frontend_license_guard=false
frontend_storybook=false
frontend_playwright=false
security=false
security_dotnet=false
security_compose=false
security_migration=false
security_image=false
frontend_features=()

add_frontend_feature() {
  local feature="$1"
  local existing
  for existing in "${frontend_features[@]:-}"; do
    [[ "$existing" == "$feature" ]] && return 0
  done
  frontend_features+=("$feature")
}

mark_unit_for_path() {
  local path="$1"
  if [[ "$path" =~ ^frontend/src/app/features/([^/]+)/ ]]; then
    local feature="${BASH_REMATCH[1]}"
    if find "frontend/src/app/features/$feature" -type f -name '*.spec.ts' -print -quit 2>/dev/null | grep -q .; then
      frontend_unit=true
      add_frontend_feature "$feature"
    fi
  else
    frontend_unit=true
    frontend_unit_full=true
  fi
}

mark_frontend_runtime() {
  local path="$1"
  frontend=true
  frontend_build=true
  frontend_playwright=true

  case "$path" in
    *.ts|*.html)
      mark_unit_for_path "$path"
      ;;
  esac

  case "$path" in
    *.ts)
      frontend_architecture=true
      ;;
  esac

  if [[ "$path" == frontend/src/app/shared/* || "$path" == frontend/src/app/core/* || "$path" == frontend/src/styles.* ]]; then
    frontend_storybook=true
  else
    local dir
    dir="$(dirname "$path")"
    if find "$dir" -maxdepth 1 -type f -name '*.stories.ts' -print -quit 2>/dev/null | grep -q .; then
      frontend_storybook=true
    fi
  fi
}

while IFS= read -r path; do
  [[ -n "$path" ]] || continue

  case "$path" in
    .github/workflows/ci.yml|scripts/ci/route-main-ci-changes.sh)
      backend=true
      frontend=true
      frontend_build=true
      frontend_unit=true
      frontend_unit_full=true
      frontend_architecture=true
      frontend_license_guard=true
      frontend_storybook=true
      frontend_playwright=true
      security=true
      security_dotnet=true
      security_compose=true
      security_migration=true
      security_image=true
      continue
      ;;
  esac

  case "$path" in
    AipPortal.slnx|global.json|NuGet.config|Directory.Build.*|Directory.Packages.*|.config/*|src/*|tests/AipPortal.Tests/*|scripts/ci/configure-persistent-caches.sh|scripts/ci/verify-trx-results.sh|scripts/ci/task-pr07b-required-tests.txt|scripts/ci/task-pr07c-required-tests.txt|scripts/ci/task-pr07d-required-tests.txt)
      backend=true
      ;;
  esac

  case "$path" in
    frontend/package.json|frontend/package-lock.json|frontend/angular.json|frontend/tsconfig*.json)
      frontend=true
      frontend_build=true
      frontend_unit=true
      frontend_unit_full=true
      frontend_architecture=true
      frontend_license_guard=true
      frontend_storybook=true
      frontend_playwright=true
      ;;
    frontend/.storybook/*)
      frontend=true
      frontend_storybook=true
      ;;
    frontend/scripts/check-architecture.mjs|frontend/scripts/check-architecture.node-test.mjs)
      frontend=true
      frontend_architecture=true
      ;;
    frontend/scripts/require-syncfusion-license.mjs|frontend/scripts/require-syncfusion-license.node-test.mjs|frontend/scripts/sanitize-syncfusion-theme-css.mjs|frontend/scripts/sanitize-syncfusion-theme-css.node-test.mjs)
      frontend=true
      frontend_build=true
      frontend_license_guard=true
      frontend_storybook=true
      ;;
    frontend/src/*.spec.ts)
      frontend=true
      mark_unit_for_path "$path"
      ;;
    frontend/src/*.stories.ts)
      frontend=true
      frontend_storybook=true
      ;;
    frontend/src/*)
      mark_frontend_runtime "$path"
      ;;
    package.json|package-lock.json|.npmrc)
      frontend=true
      frontend_playwright=true
      ;;
    Dockerfile.playwright|docker-compose.playwright.yml|playwright.config.*|scripts/ci/npm-ci-retry.sh)
      frontend=true
      frontend_playwright=true
      ;;
    tests/ui/angular-smoke.spec.ts|tests/ui/message-mobile-navigation.spec.ts|tests/ui/message-search-filters.spec.ts|tests/ui/message-actions.spec.ts|tests/ui/audit-claims-evidence.spec.ts|tests/ui/message-thread-context.spec.ts|tests/ui/message-follow-ups.spec.ts|tests/ui/app.spec.ts|tests/ui/run-angular-playwright.mjs|tests/ui/run-angular-playwright-compose.mjs|tests/ui/serve-static.mjs)
      frontend=true
      frontend_playwright=true
      ;;
  esac

  case "$path" in
    AipPortal.slnx|global.json|NuGet.config|Directory.Build.*|Directory.Packages.*|.config/*|src/*.csproj|tests/AipPortal.Tests/*.csproj)
      security=true
      security_dotnet=true
      ;;
  esac

  case "$path" in
    .env|.env.*|.env.example|docker-compose*.yml|deploy/*|scripts/ci/verify-onprem-proxy-topology.sh)
      security=true
      security_compose=true
      ;;
  esac

  case "$path" in
    src/AipPortal.Infrastructure/Migrations/*|docker-compose.onprem.yml|docker-compose.onprem.ci.yml|global.json|NuGet.config|Directory.Packages.*|.config/*|src/*.csproj)
      security=true
      security_migration=true
      ;;
  esac

  case "$path" in
    .dockerignore|.env|.env.*|.env.example|Dockerfile|Dockerfile.*|package.json|package-lock.json|frontend/package.json|frontend/package-lock.json|global.json|NuGet.config|Directory.Packages.*|src/*.csproj|*/syncfusion-license.txt|syncfusion-license.txt)
      security=true
      security_image=true
      ;;
  esac
done < "$changed_file_list"

frontend_unit_scope="none"
frontend_unit_features=""
if [[ "$frontend_unit" == "true" ]]; then
  if [[ "$frontend_unit_full" == "true" || "${#frontend_features[@]}" -eq 0 ]]; then
    frontend_unit_scope="full"
  else
    frontend_unit_scope="features"
    frontend_unit_features="$(IFS=,; echo "${frontend_features[*]}")"
  fi
fi

for key in "${keys[@]}"; do
  write_output "$key" "${!key}"
done
write_output "frontend_unit_scope" "$frontend_unit_scope"
write_output "frontend_unit_features" "$frontend_unit_features"

if [[ -n "$summary_file" ]]; then
  {
    echo "### CI routing"
    echo "- backend: $backend"
    echo "- frontend: $frontend"
    echo "  - build: $frontend_build"
    echo "  - unit: $frontend_unit ($frontend_unit_scope${frontend_unit_features:+: $frontend_unit_features})"
    echo "  - architecture: $frontend_architecture"
    echo "  - license guard: $frontend_license_guard"
    echo "  - Storybook: $frontend_storybook"
    echo "  - Playwright: $frontend_playwright"
    echo "- security: $security"
    echo "  - .NET dependency scan: $security_dotnet"
    echo "  - Compose validation: $security_compose"
    echo "  - migration smoke: $security_migration"
    echo "  - image/Trivy: $security_image"
    echo
    echo "Changed files:"
    sed 's/^/- `/' "$changed_file_list" | sed 's/$/`/'
  } >> "$summary_file"
fi
