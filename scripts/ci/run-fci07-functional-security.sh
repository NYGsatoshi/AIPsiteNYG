#!/usr/bin/env bash
set -Eeuo pipefail

gate="${1:-functional-fast}"
case "$gate" in
  functional-fast|functional-full|functional-extended) ;;
  *)
    printf 'Usage: %s [functional-fast|functional-full|functional-extended]\n' "$0" >&2
    exit 2
    ;;
esac

if [[ -z "${AIP_SECURITY_CI_PASSWORD:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    AIP_SECURITY_CI_PASSWORD="Fci07!$(openssl rand -hex 24)"
  else
    AIP_SECURITY_CI_PASSWORD="Fci07!synthetic-${GITHUB_RUN_ID:-local}-${BASHPID}"
  fi
  export AIP_SECURITY_CI_PASSWORD
fi

export AIP_FCI07_GATE="$gate"
export FUNCTIONAL_COMPOSE_FILES="docker-compose.real-backend-smoke.yml,docker-compose.security.yml,docker-compose.fci07-functional-security.yml"

exec bash scripts/ci/functional-compose-harness.sh
