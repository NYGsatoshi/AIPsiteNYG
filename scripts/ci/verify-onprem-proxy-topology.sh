#!/usr/bin/env bash
set -euo pipefail

# This intentionally validates the rendered production Compose contract rather
# than a developer's local .env file. The app's Kestrel integration test covers
# the matching forwarded-header startup boundary.
rendered_config="$(mktemp)"
trap 'rm -f "$rendered_config"' EXIT

docker compose -f docker-compose.onprem.yml config > "$rendered_config"

grep -Eq '^[[:space:]]*host_ip: 127\.0\.0\.1$' "$rendered_config"
! grep -Eq '^[[:space:]]*host_ip: 0\.0\.0\.0$' "$rendered_config"
grep -Eq '^[[:space:]]*ReverseProxy__TrustForwardedHeaders: "false"$' "$rendered_config"
grep -Eq '^[[:space:]]*ReverseProxy__TrustedProxies__0:' "$rendered_config"
grep -Eq '^[[:space:]]*ReverseProxy__TrustedNetworks__0:' "$rendered_config"
