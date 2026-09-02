#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

mkdir -p artifacts/ci artifacts/npm-audit
image_name="aipsite-nyg-ci:${TRAVIS_COMMIT:-local}-${TRAVIS_BUILD_NUMBER:-0}"

echo "== Gitleaks =="
docker run --rm \
  -v "$PWD:/repo" \
  zricethezav/gitleaks:v8.24.3 \
  detect --no-git --source /repo --redact --verbose \
  --report-format json --report-path /repo/artifacts/ci/gitleaks-report.json

echo "== npm audit =="
while IFS= read -r -d '' lockfile; do
  package_dir="$(dirname "$lockfile")"
  relative_dir="${package_dir#./}"
  [[ -n "$relative_dir" && "$relative_dir" != "." ]] || relative_dir="root"
  report_name="$(printf '%s' "$relative_dir" | tr '/ ' '__')"
  report_path="artifacts/npm-audit/${report_name}.json"

  set +e
  npm --prefix "$package_dir" audit --package-lock-only --json > "$report_path"
  status=$?
  set -e
  if [[ "$status" -ne 0 ]]; then
    echo "npm audit reported findings for $relative_dir; baseline validation will decide whether they are accepted."
  fi
done < <(find . -name package-lock.json -not -path '*/node_modules/*' -print0 | sort -z)

node scripts/ci/check-npm-audit-baseline.mjs \
  artifacts/npm-audit \
  scripts/ci/npm-audit-baseline.json

echo "== NuGet security reports =="
dotnet restore AipPortal.slnx --disable-parallel --verbosity minimal

dotnet list AipPortal.slnx package \
  --vulnerable \
  --include-transitive \
  > artifacts/ci/dotnet-vulnerable-packages.txt 2>&1
cat artifacts/ci/dotnet-vulnerable-packages.txt

dotnet list AipPortal.slnx package \
  --deprecated \
  > artifacts/ci/dotnet-deprecated-packages.txt 2>&1 || true
cat artifacts/ci/dotnet-deprecated-packages.txt

echo "== Compose validation =="
POSTGRES_PASSWORD=ci_only_compose_config_password \
DB_PASSWORD=ci_only_compose_config_password \
SYNCFUSION_LICENSE=ci_config_validation_only \
  docker compose config --quiet

docker compose -f docker-compose.playwright.yml config --quiet

SYNCFUSION_LICENSE=ci_config_validation_only \
  docker compose \
    -p aipsite-real-backend-smoke-config \
    -f docker-compose.real-backend-smoke.yml \
    config --quiet

echo "== On-prem migration smoke =="
project="aipsite-onprem-travis-${TRAVIS_BUILD_NUMBER:-0}"
cleanup_onprem() {
  DB_PASSWORD=ci_only_migration_password \
    docker compose \
      -p "$project" \
      -f docker-compose.onprem.yml \
      -f docker-compose.onprem.ci.yml \
      down -v --remove-orphans || true
}
trap cleanup_onprem EXIT

DB_PASSWORD=ci_only_migration_password \
  docker compose \
    -p "$project" \
    -f docker-compose.onprem.yml \
    -f docker-compose.onprem.ci.yml \
    up --abort-on-container-exit --exit-code-from migrate postgres migrate

cleanup_onprem
trap - EXIT

if [[ "${TRAVIS_PULL_REQUEST_BRANCH:-}" == dependabot/* ]]; then
  echo "== Dependabot no-secret Trivy filesystem gate =="
  docker run --rm \
    -v "$PWD:/repo" \
    aquasec/trivy:0.65.0 \
    fs --scanners vuln \
    --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 \
    --format table --output /repo/artifacts/ci/trivy-image-report.txt \
    /repo
  cat artifacts/ci/trivy-image-report.txt
  exit 0
fi

echo "== Runtime image build =="
test -n "${SYNCFUSION_LICENSE:-}" || {
  echo "SYNCFUSION_LICENSE must be configured in Travis for the image security gate." >&2
  exit 1
}

license_file="$(mktemp)"
trap 'rm -f "$license_file"' EXIT
chmod 600 "$license_file"
printf '%s' "$SYNCFUSION_LICENSE" > "$license_file"

build_status=1
for attempt in 1 2; do
  set +e
  docker build \
    --pull \
    --progress=plain \
    --secret id=syncfusion_license,src="$license_file" \
    --tag "$image_name" \
    .
  build_status=$?
  set -e
  [[ "$build_status" -eq 0 ]] && break
  [[ "$attempt" -lt 2 ]] || break
  docker system df || true
  sleep 15
done
[[ "$build_status" -eq 0 ]] || exit "$build_status"

rm -f "$license_file"
trap - EXIT

echo "== Runtime secret boundary =="
docker run --rm --entrypoint sh "$image_name" -c '
  test ! -e /run/secrets &&
  test ! -e /app/.env &&
  ! env | grep -q "^SYNCFUSION_LICENSE=" &&
  ! find /app -type f \( -name ".env" -o -name ".env.*" -o -name "syncfusion-license.txt" \) -print -quit | grep -q .
'

echo "== Trivy HIGH/CRITICAL image gate =="
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD:/repo" \
  aquasec/trivy:0.65.0 \
  image --scanners vuln --vuln-type os,library \
  --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 \
  --format table --output /repo/artifacts/ci/trivy-image-report.txt \
  "$image_name"

cat artifacts/ci/trivy-image-report.txt
