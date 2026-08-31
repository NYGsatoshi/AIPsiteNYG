#!/usr/bin/env bash
set -euo pipefail

# Validate rendered production proxy contracts instead of relying on source-text
# greps. This catches Compose merge/override regressions as well as accidental
# weakening of HTTPS, secure-cookie, or forwarded-header trust settings.
onprem_config="$(mktemp)"
sakura_config="$(mktemp)"
trycloudflare_config="$(mktemp)"
trycloudflare_caddy_config="$(mktemp)"
deploy_env="$(mktemp)"
deploy_license="$(mktemp)"
trap 'rm -f "$onprem_config" "$sakura_config" "$trycloudflare_config" "$trycloudflare_caddy_config" "$deploy_env" "$deploy_license"' EXIT

docker compose -f docker-compose.onprem.yml config --format json > "$onprem_config"
docker compose -p deploy -f deploy/sakura/docker-compose.yml config --format json > "$sakura_config"
docker compose -p deploy \
  -f deploy/sakura/docker-compose.yml \
  -f deploy/sakura/docker-compose.trycloudflare.yml \
  config --format json > "$trycloudflare_config"
docker compose -p deploy --profile caddy \
  -f deploy/sakura/docker-compose.yml \
  -f deploy/sakura/docker-compose.trycloudflare.yml \
  config --format json > "$trycloudflare_caddy_config"

python3 - "$onprem_config" "$sakura_config" "$trycloudflare_config" "$trycloudflare_caddy_config" <<'PY'
import json
import sys

onprem_path, sakura_path, trycloudflare_path, trycloudflare_caddy_path = sys.argv[1:]


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def environment(config, service):
    return config["services"][service].get("environment", {})


def ports(config, service):
    return config["services"][service].get("ports", [])


def assert_loopback_only_origin(config, service, target_port):
    service_ports = [
        port for port in ports(config, service)
        if int(port.get("target", -1)) == target_port
    ]
    assert service_ports, f"{service} must publish target port {target_port}"
    assert all(port.get("host_ip") == "127.0.0.1" for port in service_ports), service_ports
    assert not any(port.get("host_ip") == "0.0.0.0" for port in service_ports), service_ports


def assert_https_security(env):
    assert env["Security__RequireHttps"] == "true", env
    assert env["Security__EnableHsts"] == "true", env
    assert env["Security__CookieSecurePolicy"] == "Always", env


onprem = load(onprem_path)
sakura = load(sakura_path)
trycloudflare = load(trycloudflare_path)
trycloudflare_caddy = load(trycloudflare_caddy_path)

onprem_env = environment(onprem, "app")
assert_loopback_only_origin(onprem, "app", 8080)
assert_https_security(onprem_env)
assert onprem_env["ReverseProxy__TrustForwardedHeaders"] == "false", onprem_env
assert onprem_env["ReverseProxy__RequireHeaderSymmetry"] == "true", onprem_env
assert "ReverseProxy__TrustedProxies__0" in onprem_env, onprem_env
assert "ReverseProxy__TrustedNetworks__0" in onprem_env, onprem_env

sakura_env = environment(sakura, "web")
assert_https_security(sakura_env)
assert sakura_env["ReverseProxy__TrustForwardedHeaders"] == "true", sakura_env
assert sakura_env["ReverseProxy__RequireHeaderSymmetry"] == "true", sakura_env
assert sakura_env["ReverseProxy__TrustedNetworks__0"], sakura_env

trycloudflare_env = environment(trycloudflare, "web")
assert_https_security(trycloudflare_env)
assert_loopback_only_origin(trycloudflare, "web", 8080)
assert trycloudflare_env["ReverseProxy__TrustForwardedHeaders"] == "true", trycloudflare_env
assert trycloudflare_env["ReverseProxy__RequireHeaderSymmetry"] == "false", trycloudflare_env
assert (
    trycloudflare_env["ReverseProxy__TrustedNetworks__0"]
    == sakura_env["ReverseProxy__TrustedNetworks__0"]
), (sakura_env, trycloudflare_env)

# The Quick Tunnel topology excludes bundled Caddy by default, but operators can
# explicitly re-enable the profile when validating or transitioning topologies.
assert "caddy" not in trycloudflare["services"], trycloudflare["services"]
assert "caddy" in trycloudflare_caddy["services"], trycloudflare_caddy["services"]
assert "caddy" in trycloudflare_caddy["services"]["caddy"].get("profiles", []), trycloudflare_caddy["services"]["caddy"]
PY

# Exercise the canonical deployment entrypoint itself. PR #480 originally
# validated the tracked overlay but the Sakura deploy script never selected it,
# allowing an operator-side stale overlay to recreate the outage. Validate both
# edge modes through deploy.sh so CI fails if the entrypoint and Compose contract
# diverge again.
bash -n deploy/sakura/deploy.sh
chmod 600 "$deploy_env" "$deploy_license"
cat > "$deploy_env" <<'EOF'
DB_PASSWORD=ci_dummy_password
LOCAL_ADMIN_PASSWORD=ci_dummy_local_admin_password
EOF
printf '%s\n' 'ci_dummy_syncfusion_license' > "$deploy_license"

for edge_mode in caddy trycloudflare; do
  AIPSITE_SOURCE_DIR="$PWD" \
  AIPSITE_DEPLOY_ENV="$deploy_env" \
  AIPSITE_CADDYFILE="$PWD/deploy/sakura/Caddyfile" \
  SYNCFUSION_LICENSE_FILE="$deploy_license" \
  AIPSITE_DEPLOY_VALIDATE_ONLY=true \
    bash deploy/sakura/deploy.sh "$edge_mode"
done
