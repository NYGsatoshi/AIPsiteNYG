#!/usr/bin/env bash
# Shared AUD-02 lifecycle assertions for the isolated security runtime.
#
# The caller must provide db_scalar(). Raw fixture identifiers never leave this
# process; only a SHA-256 fingerprint is retained for restart comparison.

AUD02_STAGE="${AUD02_STAGE:-init}"
AUD02_FIXTURE_IDENTITY_BEFORE="${AUD02_FIXTURE_IDENTITY_BEFORE:-}"
AUD02_FIXTURE_ROW_COUNT=10

# Internal helper to log AUD-02 lifecycle failures and return non-zero exit code.
_aud02_fail() {
  printf 'AUD-02 lifecycle failed: %s\n' "$*" >&2
  return 1
}

# Advance the AUD-02 lifecycle state machine from expected stage to next stage, failing if out of order.
aud02_advance() {
  local expected=$1
  local next=$2
  [[ "$AUD02_STAGE" == "$expected" ]] ||
    _aud02_fail "expected stage '$expected' before '$next', got '$AUD02_STAGE'" || return 1
  AUD02_STAGE="$next"
  export AUD02_STAGE
  printf 'AUD-02 lifecycle stage: %s\n' "$AUD02_STAGE"
}

# Query the security fixture database for tenant, user, workspace, and project IDs, and return a SHA-256 fingerprint.
aud02_fixture_identity_fingerprint() {
  declare -F db_scalar >/dev/null 2>&1 || {
    _aud02_fail "db_scalar() is required for fixture identity evidence"
    return 1
  }

  local sql material row_count digest
  sql="$(cat <<'SQL'
SELECT identity
FROM (
  SELECT 'tenant:security-alpha=' || "Id"::text AS identity
  FROM tenants
  WHERE "Slug"='security-alpha'
  UNION ALL
  SELECT 'tenant:security-beta=' || "Id"::text
  FROM tenants
  WHERE "Slug"='security-beta'
  UNION ALL
  SELECT 'user:security-alpha-owner@example.test=' || "Id"::text
  FROM users
  WHERE lower("Email")='security-alpha-owner@example.test'
  UNION ALL
  SELECT 'user:security-alpha-member@example.test=' || "Id"::text
  FROM users
  WHERE lower("Email")='security-alpha-member@example.test'
  UNION ALL
  SELECT 'user:security-alpha-restricted@example.test=' || "Id"::text
  FROM users
  WHERE lower("Email")='security-alpha-restricted@example.test'
  UNION ALL
  SELECT 'user:security-beta-owner@example.test=' || "Id"::text
  FROM users
  WHERE lower("Email")='security-beta-owner@example.test'
  UNION ALL
  SELECT 'workspace:sec02-alpha-workspace=' || w."Id"::text
  FROM workspaces w
  JOIN tenants t ON t."Id"=w."TenantId"
  WHERE t."Slug"='security-alpha' AND w."Slug"='sec02-alpha-workspace'
  UNION ALL
  SELECT 'workspace:sec02-beta-workspace=' || w."Id"::text
  FROM workspaces w
  JOIN tenants t ON t."Id"=w."TenantId"
  WHERE t."Slug"='security-beta' AND w."Slug"='sec02-beta-workspace'
  UNION ALL
  SELECT 'project:sec02-alpha-project=' || p."Id"::text
  FROM projects p
  JOIN tenants t ON t."Id"=p."TenantId"
  WHERE t."Slug"='security-alpha' AND p."Slug"='sec02-alpha-project'
  UNION ALL
  SELECT 'project:sec02-beta-project=' || p."Id"::text
  FROM projects p
  JOIN tenants t ON t."Id"=p."TenantId"
  WHERE t."Slug"='security-beta' AND p."Slug"='sec02-beta-project'
) AS fixture_identity
ORDER BY identity;
SQL
)"

  material="$(db_scalar "$sql")" || {
    _aud02_fail "fixture identity query failed"
    return 1
  }
  row_count="$(printf '%s\n' "$material" | sed '/^[[:space:]]*$/d' | wc -l | tr -d '[:space:]')"
  [[ "$row_count" == "$AUD02_FIXTURE_ROW_COUNT" ]] || {
    _aud02_fail "fixture identity evidence expected $AUD02_FIXTURE_ROW_COUNT rows, got '$row_count'"
    return 1
  }

  digest="$(printf '%s\n' "$material" | LC_ALL=C sort | sha256sum | awk '{print $1}')"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || {
    _aud02_fail "fixture identity fingerprint was not SHA-256"
    return 1
  }
  printf 'sha256:%s\n' "$digest"
}

# Capture the fixture identity fingerprint before application restart and advance to fixture-evidence stage.
aud02_capture_fixture_evidence() {
  [[ "$AUD02_STAGE" == "warm-up" ]] || {
    _aud02_fail "fixture evidence requires warm-up stage, got '$AUD02_STAGE'"
    return 1
  }
  AUD02_FIXTURE_IDENTITY_BEFORE="$(aud02_fixture_identity_fingerprint)" || return 1
  export AUD02_FIXTURE_IDENTITY_BEFORE
  aud02_advance warm-up fixture-evidence
  printf 'AUD-02 fixture identity evidence: %s\n' "$AUD02_FIXTURE_IDENTITY_BEFORE"
}

# Verify that the fixture identity fingerprint after restart matches the captured pre-restart fingerprint.
aud02_verify_restart_identity() {
  [[ "$AUD02_STAGE" == "teardown" ]] || {
    _aud02_fail "restart identity verification requires teardown stage, got '$AUD02_STAGE'"
    return 1
  }
  [[ -n "$AUD02_FIXTURE_IDENTITY_BEFORE" ]] || {
    _aud02_fail "pre-restart fixture identity evidence is missing"
    return 1
  }

  local after
  after="$(aud02_fixture_identity_fingerprint)" || return 1
  [[ "$after" == "$AUD02_FIXTURE_IDENTITY_BEFORE" ]] || {
    _aud02_fail "fixture identity changed across application restart"
    return 1
  }

  aud02_advance teardown restart-identity
  printf 'AUD-02 restart identity matched: %s\n' "$after"
}

# Write the AUD-02 lifecycle summary to GitHub step summary if available.
aud02_write_summary() {
  [[ "$AUD02_STAGE" == "restart-identity" ]] || {
    _aud02_fail "summary requires completed restart identity stage, got '$AUD02_STAGE'"
    return 1
  }
  [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] || return 0
  {
    printf '### AUD-02 security runtime lifecycle\n\n'
    printf -- '- Sequence: `fresh-start -> ready -> login -> warm-up -> fixture-evidence -> teardown -> restart-identity`\n'
    printf -- '- Fixture identity fingerprint: `%s`\n' "$AUD02_FIXTURE_IDENTITY_BEFORE"
    printf -- '- Restart identity: `matched`\n'
    printf -- '- Evidence contains no credential, cookie, CSRF token, or protected response body.\n\n'
  } >> "$GITHUB_STEP_SUMMARY"
}
