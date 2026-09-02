#!/usr/bin/env bash
set -euo pipefail

compose_file="docker-compose.db.yml"
container_id="$(docker compose -f "$compose_file" ps -q postgres)"

if [[ -z "$container_id" ]]; then
  echo "PostgreSQL container was not created." >&2
  docker compose -f "$compose_file" ps >&2 || true
  exit 1
fi

for attempt in $(seq 1 30); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  if [[ "$status" == "healthy" ]]; then
    echo "PostgreSQL is healthy."
    exit 0
  fi

  echo "Waiting for PostgreSQL ($attempt/30): $status"
  sleep 2
done

echo "PostgreSQL did not become healthy in time." >&2
docker compose -f "$compose_file" ps >&2 || true
docker compose -f "$compose_file" logs postgres >&2 || true
exit 1
