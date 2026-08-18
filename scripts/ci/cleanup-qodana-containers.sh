#!/usr/bin/env bash
set -Eeuo pipefail

workspace="${1:-${GITHUB_WORKSPACE:-}}"
if [[ -z "$workspace" ]]; then
  echo "Qodana cleanup requires a workspace path." >&2
  exit 2
fi
workspace="$(realpath -m "$workspace")"

mapfile -t qodana_containers < <(docker ps -aq --filter 'name=^/qodana-cli-')
for container_id in "${qodana_containers[@]}"; do
  [[ -z "$container_id" ]] && continue

  project_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data/project"}}{{.Source}}{{end}}{{end}}' "$container_id" 2>/dev/null || true)"
  if [[ -z "$project_source" ]]; then
    echo "Skipping Qodana container $container_id because its /data/project source could not be identified."
    continue
  fi
  project_source="$(realpath -m "$project_source")"
  if [[ "$project_source" != "$workspace" ]]; then
    echo "Skipping Qodana container $container_id owned by another workspace: $project_source"
    continue
  fi

  if docker rm -f "$container_id" >/dev/null 2>&1; then
    echo "Removed Qodana container $container_id for $workspace."
    continue
  fi

  # Qodana may already be removing its --rm container. Docker can return an
  # error while the container is still briefly inspectable, so absorb only
  # that bounded removal race instead of failing immediately.
  removed=0
  for _ in $(seq 1 20); do
    if ! docker inspect "$container_id" >/dev/null 2>&1; then
      removed=1
      break
    fi
    sleep 0.5
  done

  if [[ "$removed" -eq 1 ]]; then
    echo "Qodana container $container_id finished removal concurrently."
    continue
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "::error::Docker became unavailable while verifying Qodana cleanup."
    exit 1
  fi

  docker inspect "$container_id" || true
  echo "::error::Failed to remove Qodana container $container_id owned by $workspace."
  exit 1
done
