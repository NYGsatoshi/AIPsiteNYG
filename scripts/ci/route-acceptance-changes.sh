#!/usr/bin/env bash
set -euo pipefail

profile="${1:?usage: route-acceptance-changes.sh <mbj02|mbj03> [base-sha] [head-sha]}"
base_sha="${2:-${BASE_SHA:-}}"
head_sha="${3:-${HEAD_SHA:-${GITHUB_SHA:-HEAD}}}"
zero_sha="0000000000000000000000000000000000000000"

emit() {
  local value="$1"
  local reason="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "run=$value" >> "$GITHUB_OUTPUT"
  else
    echo "run=$value"
  fi
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "### Acceptance change routing"
      echo "- profile: \`$profile\`"
      echo "- run heavy acceptance: \`$value\`"
      echo "- reason: $reason"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

case "$profile" in
  mbj02|mbj03) ;;
  *)
    echo "Unsupported acceptance routing profile: $profile" >&2
    exit 2
    ;;
esac

if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
  emit true "manual dispatch always runs the complete acceptance workflow"
  exit 0
fi

if [[ -z "$base_sha" || "$base_sha" == "$zero_sha" ]] || \
   ! git cat-file -e "${base_sha}^{commit}" 2>/dev/null || \
   ! git cat-file -e "${head_sha}^{commit}" 2>/dev/null; then
  emit true "safe diff base is unavailable; fail-open to the heavy acceptance workflow"
  exit 0
fi

changed_file_list="${RUNNER_TEMP:-/tmp}/acceptance-${profile}-changed-files.txt"
git diff --name-only "$base_sha" "$head_sha" > "$changed_file_list"

diff_has_relevant_line() {
  local path="$1"
  local regex="$2"
  git diff --unified=0 "$base_sha" "$head_sha" -- "$path" \
    | grep -E '^[+-]' \
    | grep -Ev '^(\+\+\+|---)' \
    | grep -Eiq "$regex"
}

run=false
reason="no changed file or shared-file diff intersects the ${profile} acceptance contract"

while IFS= read -r path; do
  [[ -n "$path" ]] || continue

  case "$profile" in
    mbj02)
      case "$path" in
        .github/workflows/mbj02-invite-onboarding.yml|\
        scripts/ci/route-acceptance-changes.sh|\
        scripts/ci/run-mbj02-invite-acceptance.sh|\
        scripts/ci/verify-npm-lockfile.mjs|\
        tests/ui/mbj02-invite-acceptance.mjs|\
        docker-compose.mbj02-invite.yml|\
        docker-compose.real-backend-smoke.yml|\
        Dockerfile|Dockerfile.playwright|\
        AipPortal.slnx|global.json|Directory.Build.*|Directory.Packages.*|NuGet.config|\
        package.json|package-lock.json|src/*.csproj|\
        src/AipPortal.Application/Admin/*|\
        src/AipPortal.Application/Auth/*|\
        src/AipPortal.Application/Common/*|\
        src/AipPortal.Application/Security/*|\
        src/AipPortal.Application/Tenancy/*|\
        src/AipPortal.Application/Workspaces/*|\
        src/AipPortal.Domain/Common/*|\
        src/AipPortal.Domain/Entities/IdentityEntities.cs|\
        src/AipPortal.Infrastructure/Persistence/AdminRepository.cs|\
        src/AipPortal.Infrastructure/Persistence/AuthRepositories.cs|\
        src/AipPortal.Infrastructure/Persistence/CapabilityGrantRepository.cs|\
        src/AipPortal.Infrastructure/Persistence/TenantRepository.cs|\
        src/AipPortal.Infrastructure/Persistence/WorkspaceRepository.cs|\
        src/AipPortal.Infrastructure/Persistence/Configurations/TenantConfigurations.cs|\
        src/AipPortal.Infrastructure/Security/*|\
        src/AipPortal.Web/Controllers/AdminController.cs|\
        src/AipPortal.Web/Controllers/AuthController.cs|\
        src/AipPortal.Web/Controllers/InvitesController.cs|\
        src/AipPortal.Web/Controllers/SecurityController.cs|\
        src/AipPortal.Web/Program.cs|\
        src/AipPortal.Web/Security/*|\
        src/AipPortal.Web/Tenancy/*|\
        src/AipPortal.Web/appsettings*.json)
          run=true
          reason="direct MBJ-02 dependency changed: \`$path\`"
          break
          ;;
        src/AipPortal.Application/DependencyInjection.cs|\
        src/AipPortal.Infrastructure/DependencyInjection.cs|\
        src/AipPortal.Infrastructure/Persistence/AppDbContext.cs|\
        src/AipPortal.Infrastructure/Persistence/Configurations/ProductionConfigurations.cs|\
        src/AipPortal.Infrastructure/Persistence/Migrations/*|\
        src/AipPortal.Domain/Entities/ProductionEntities.cs|\
        src/AipPortal.Domain/Enums/*)
          if diff_has_relevant_line "$path" '(Admin|Auth|Invite|Session|User|Tenant|Workspace|Membership|CapabilityGrant|Security|Role)'; then
            run=true
            reason="shared file changed MBJ-02-relevant symbols: \`$path\`"
            break
          fi
          ;;
      esac
      ;;
    mbj03)
      case "$path" in
        .github/workflows/mbj03-session-lifecycle.yml|\
        scripts/ci/route-acceptance-changes.sh|\
        scripts/ci/run-mbj03-session-acceptance.sh|\
        scripts/ci/verify-npm-lockfile.mjs|\
        tests/ui/mbj03-session-acceptance.mjs|\
        docker-compose.mbj03-session.yml|\
        docker-compose.real-backend-smoke.yml|\
        Dockerfile|Dockerfile.playwright|\
        AipPortal.slnx|global.json|Directory.Build.*|Directory.Packages.*|NuGet.config|\
        package.json|package-lock.json|src/*.csproj|\
        src/AipPortal.Application/Admin/*|\
        src/AipPortal.Application/Auth/*|\
        src/AipPortal.Application/Common/*|\
        src/AipPortal.Application/Realtime/*|\
        src/AipPortal.Application/Security/*|\
        src/AipPortal.Application/Tenancy/*|\
        src/AipPortal.Application/Workspaces/*|\
        src/AipPortal.Domain/Common/*|\
        src/AipPortal.Domain/Entities/IdentityEntities.cs|\
        src/AipPortal.Infrastructure/Persistence/AdminRepository.cs|\
        src/AipPortal.Infrastructure/Persistence/AuthRepositories.cs|\
        src/AipPortal.Infrastructure/Persistence/CapabilityGrantRepository.cs|\
        src/AipPortal.Infrastructure/Persistence/TenantRepository.cs|\
        src/AipPortal.Infrastructure/Persistence/WorkspaceRepository.cs|\
        src/AipPortal.Infrastructure/Persistence/Configurations/TenantConfigurations.cs|\
        src/AipPortal.Infrastructure/Security/*|\
        src/AipPortal.Web/Controllers/AdminController.cs|\
        src/AipPortal.Web/Controllers/AuthController.cs|\
        src/AipPortal.Web/Controllers/InvitesController.cs|\
        src/AipPortal.Web/Controllers/SecurityController.cs|\
        src/AipPortal.Web/Hubs/*|\
        src/AipPortal.Web/Program.cs|\
        src/AipPortal.Web/Security/*|\
        src/AipPortal.Web/Tenancy/*|\
        src/AipPortal.Web/appsettings*.json)
          run=true
          reason="direct MBJ-03 dependency changed: \`$path\`"
          break
          ;;
        src/AipPortal.Application/DependencyInjection.cs|\
        src/AipPortal.Infrastructure/DependencyInjection.cs|\
        src/AipPortal.Infrastructure/Persistence/AppDbContext.cs|\
        src/AipPortal.Infrastructure/Persistence/Configurations/ProductionConfigurations.cs|\
        src/AipPortal.Infrastructure/Persistence/Migrations/*|\
        src/AipPortal.Domain/Entities/ProductionEntities.cs|\
        src/AipPortal.Domain/Enums/*)
          if diff_has_relevant_line "$path" '(Admin|Auth|Invite|Session|User|Tenant|Workspace|Membership|CapabilityGrant|Security|Role|Realtime|Hub|Csrf|Cookie)'; then
            run=true
            reason="shared file changed MBJ-03-relevant symbols: \`$path\`"
            break
          fi
          ;;
      esac
      ;;
  esac
done < "$changed_file_list"

emit "$run" "$reason"
