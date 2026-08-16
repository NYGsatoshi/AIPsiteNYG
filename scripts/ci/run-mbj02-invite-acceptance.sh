#!/usr/bin/env bash
set -euo pipefail

BASE_COMPOSE="docker-compose.real-backend-smoke.yml"
OVERLAY_COMPOSE="docker-compose.mbj02-invite.yml"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-aipsite-mbj02-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$}"

export AIP_MBJ02_ADMIN_EMAIL="${AIP_MBJ02_ADMIN_EMAIL:-mbj02-system-admin@example.test}"
export AIP_MBJ02_ADMIN_DISPLAY_NAME="${AIP_MBJ02_ADMIN_DISPLAY_NAME:-MBJ02 System Admin}"
if [[ -z "${AIP_MBJ02_ADMIN_PASSWORD:-}" ]]; then
  AIP_MBJ02_ADMIN_PASSWORD="Aip1!$(openssl rand -hex 24)"
  export AIP_MBJ02_ADMIN_PASSWORD
fi

export AIP_MBJ02_INVITEE_EMAIL="${AIP_MBJ02_INVITEE_EMAIL:-mbj02-invited-user@example.test}"
export AIP_MBJ02_INVITEE_DISPLAY_NAME="${AIP_MBJ02_INVITEE_DISPLAY_NAME:-MBJ02 Invited User}"
if [[ -z "${AIP_MBJ02_INVITEE_PASSWORD:-}" ]]; then
  AIP_MBJ02_INVITEE_PASSWORD="Aip1!$(openssl rand -hex 24)"
  export AIP_MBJ02_INVITEE_PASSWORD
fi

export AIP_MBJ02_REVOKED_EMAIL="${AIP_MBJ02_REVOKED_EMAIL:-mbj02-revoked@example.test}"
export AIP_MBJ02_EXPIRED_EMAIL="${AIP_MBJ02_EXPIRED_EMAIL:-mbj02-expired@example.test}"
export AIP_MBJ02_MISMATCH_TARGET_EMAIL="${AIP_MBJ02_MISMATCH_TARGET_EMAIL:-mbj02-mismatch-target@example.test}"
export AIP_MBJ02_MISMATCH_OTHER_EMAIL="${AIP_MBJ02_MISMATCH_OTHER_EMAIL:-mbj02-mismatch-other@example.test}"
export AIP_MBJ02_CROSS_TENANT_EMAIL="${AIP_MBJ02_CROSS_TENANT_EMAIL:-mbj02-cross-tenant@example.test}"
if [[ -z "${AIP_MBJ02_CROSS_TENANT_TOKEN:-}" ]]; then
  AIP_MBJ02_CROSS_TENANT_TOKEN="mbj02-cross-$(openssl rand -hex 24)"
  export AIP_MBJ02_CROSS_TENANT_TOKEN
fi
export AIP_MBJ02_CROSS_TENANT_WORKSPACE_ID="${AIP_MBJ02_CROSS_TENANT_WORKSPACE_ID:-22222222-2222-2222-2222-222222222223}"

FOREIGN_TENANT_ID="22222222-2222-2222-2222-222222222222"
FOREIGN_INVITE_ID="22222222-2222-2222-2222-222222222224"
CROSS_ADMIN_ATTEMPT_EMAIL="mbj02-cross-admin-attempt@example.test"

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  echo "::add-mask::$AIP_MBJ02_ADMIN_PASSWORD"
  echo "::add-mask::$AIP_MBJ02_INVITEE_PASSWORD"
  echo "::add-mask::$AIP_MBJ02_CROSS_TENANT_TOKEN"
fi

compose=(docker compose -p "$PROJECT_NAME" -f "$BASE_COMPOSE" -f "$OVERLAY_COMPOSE")
mkdir -p test-results

cleanup() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    echo "Collecting sanitized MBJ-02 failure evidence." >&2
    "${compose[@]}" ps --all > test-results/mbj02-compose-ps.txt 2>&1 || true
    "${compose[@]}" logs --no-color --tail 400 postgres migrate app > /tmp/mbj02-compose.log 2>&1 || true
    python3 -c '
import os
import sys
text = sys.stdin.read()
for name in (
    "AIP_MBJ02_ADMIN_PASSWORD",
    "AIP_MBJ02_INVITEE_PASSWORD",
    "AIP_MBJ02_CROSS_TENANT_TOKEN",
):
    secret = os.environ.get(name, "")
    if secret:
        text = text.replace(secret, "[REDACTED]")
sys.stdout.write(text)
' < /tmp/mbj02-compose.log > test-results/mbj02-compose.log 2>/dev/null || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  return "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_healthy() {
  local service="$1"
  local deadline=$((SECONDS + 240))
  local last_state="not-created"

  while (( SECONDS < deadline )); do
    local container_id
    container_id="$("${compose[@]}" ps --all -q "$service" 2>/dev/null | head -n 1)"
    if [[ -n "$container_id" ]]; then
      last_state="$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.ExitCode}}' "$container_id" 2>/dev/null || true)"
      if [[ "$last_state" == running\ healthy\ * ]]; then
        return 0
      fi
      if [[ "$last_state" == exited\ * || "$last_state" == dead\ * ]]; then
        echo "$service stopped before becoming healthy: $last_state" >&2
        return 1
      fi
    fi
    sleep 1
  done

  echo "Timed out waiting for $service to become healthy. Last state: $last_state" >&2
  return 1
}

seed_cross_tenant_fixture() {
  local admin_id token_hash
  admin_id="$("${compose[@]}" exec -T postgres \
    psql -U aip_portal_smoke -d aip_portal_smoke -v ON_ERROR_STOP=1 -At \
      -v email="$AIP_MBJ02_ADMIN_EMAIL" <<'SQL'
SELECT "Id"
FROM users
WHERE "NormalizedEmail" = upper(:'email')
  AND "SystemRole" = 'SystemAdmin'
  AND "Status" = 'Active'
  AND "DeletedAt" IS NULL
LIMIT 1;
SQL
)"
  if [[ -z "$admin_id" ]]; then
    echo "MBJ-02 bootstrap SystemAdmin was not persisted before cross-tenant fixture setup." >&2
    return 1
  fi

  token_hash="$(printf '%s' "$AIP_MBJ02_CROSS_TENANT_TOKEN" | openssl dgst -sha256 | awk '{print toupper($2)}')"

  "${compose[@]}" exec -T postgres \
    psql -U aip_portal_smoke -d aip_portal_smoke -v ON_ERROR_STOP=1 \
      -v foreign_tenant_id="$FOREIGN_TENANT_ID" \
      -v foreign_workspace_id="$AIP_MBJ02_CROSS_TENANT_WORKSPACE_ID" \
      -v foreign_invite_id="$FOREIGN_INVITE_ID" \
      -v admin_id="$admin_id" \
      -v email="$AIP_MBJ02_CROSS_TENANT_EMAIL" \
      -v token_hash="$token_hash" <<'SQL'
INSERT INTO tenants (
  "Id", "Name", "Slug", "DisplayName", "Status", "CreatedAt")
VALUES (
  CAST(:'foreign_tenant_id' AS uuid),
  'MBJ02 Foreign Tenant',
  'mbj02-foreign-tenant',
  'MBJ02 Foreign Tenant',
  'Active',
  now());

INSERT INTO workspaces (
  "Id", "TenantId", "Name", "Slug", "Status", "CreatedByUserId",
  "DefaultTaskDeadlineDigestLocalTime", "TaskNotificationSettingsVersion", "CreatedAt")
VALUES (
  CAST(:'foreign_workspace_id' AS uuid),
  CAST(:'foreign_tenant_id' AS uuid),
  'MBJ02 Foreign Workspace',
  'mbj02-foreign-workspace',
  'Active',
  CAST(:'admin_id' AS uuid),
  TIME '08:00:00',
  1,
  now());

INSERT INTO invites (
  "Id", "TenantId", "WorkspaceId", "Email", "NormalizedEmail", "TokenHash",
  "Role", "ExpiresAt", "InvitedByUserId", "CreatedAt")
VALUES (
  CAST(:'foreign_invite_id' AS uuid),
  CAST(:'foreign_tenant_id' AS uuid),
  CAST(:'foreign_workspace_id' AS uuid),
  :'email',
  upper(:'email'),
  :'token_hash',
  'Member',
  now() + interval '1 day',
  CAST(:'admin_id' AS uuid),
  now());
SQL
}

run_probe() {
  "${compose[@]}" run --build --rm real-backend-playwright \
    bash -lc "npm ci && node tests/ui/mbj02-invite-acceptance.mjs"
}

verify_postgres_state() {
  local row
  row="$("${compose[@]}" exec -T postgres \
    psql -U aip_portal_smoke -d aip_portal_smoke \
      -v ON_ERROR_STOP=1 \
      -v accepted_email="$AIP_MBJ02_INVITEE_EMAIL" \
      -v revoked_email="$AIP_MBJ02_REVOKED_EMAIL" \
      -v expired_email="$AIP_MBJ02_EXPIRED_EMAIL" \
      -v mismatch_target="$AIP_MBJ02_MISMATCH_TARGET_EMAIL" \
      -v mismatch_other="$AIP_MBJ02_MISMATCH_OTHER_EMAIL" \
      -v cross_email="$AIP_MBJ02_CROSS_TENANT_EMAIL" \
      -v cross_admin_email="$CROSS_ADMIN_ATTEMPT_EMAIL" \
      -v foreign_tenant_id="$FOREIGN_TENANT_ID" \
      -At -F '|' <<'SQL'
WITH accepted_user AS (
  SELECT u."Id"
  FROM users u
  WHERE u."NormalizedEmail" = upper(:'accepted_email')
    AND u."Status" = 'Active'
), accepted_invite AS (
  SELECT i."Id", i."TenantId", i."WorkspaceId"
  FROM invites i
  WHERE i."NormalizedEmail" = upper(:'accepted_email')
    AND i."AcceptedAt" IS NOT NULL
    AND i."RevokedAt" IS NULL
)
SELECT
  (SELECT count(*) FROM accepted_user),
  (SELECT count(*) FROM accepted_invite),
  (SELECT count(*)
     FROM tenant_users tu
     JOIN accepted_user u ON u."Id" = tu."UserId"
     JOIN accepted_invite i ON i."TenantId" = tu."TenantId"
    WHERE tu."Status" = 'Active' AND tu."Role" = 'Member'),
  (SELECT count(*)
     FROM workspace_members wm
     JOIN accepted_user u ON u."Id" = wm."UserId"
     JOIN accepted_invite i
       ON i."TenantId" = wm."TenantId" AND i."WorkspaceId" = wm."WorkspaceId"
    WHERE wm."Status" = 'Active' AND wm."Role" = 'Member'),
  (SELECT count(*)
     FROM sessions s
     JOIN accepted_user u ON u."Id" = s."UserId"
    WHERE s."RevokedAt" IS NULL AND s."ExpiresAt" > now()),
  (SELECT count(*)
     FROM audit_logs a
     JOIN accepted_invite i ON i."Id" = a."EntityId"
    WHERE a."Action" = 'InviteCreated' AND a."EntityType" = 'Invite'),
  (SELECT count(*)
     FROM audit_logs a
     JOIN accepted_invite i ON i."Id" = a."EntityId"
     JOIN accepted_user u ON u."Id" = a."ActorUserId"
    WHERE a."Action" = 'InviteAccepted' AND a."EntityType" = 'Invite'),
  (SELECT count(*) FROM invites i
    WHERE i."NormalizedEmail" = upper(:'revoked_email')
      AND i."RevokedAt" IS NOT NULL AND i."AcceptedAt" IS NULL),
  (SELECT count(*) FROM users u WHERE u."NormalizedEmail" = upper(:'revoked_email')),
  (SELECT count(*) FROM invites i
    WHERE i."NormalizedEmail" = upper(:'expired_email')
      AND i."ExpiresAt" <= now() AND i."AcceptedAt" IS NULL),
  (SELECT count(*) FROM users u WHERE u."NormalizedEmail" = upper(:'expired_email')),
  (SELECT count(*) FROM invites i
    WHERE i."NormalizedEmail" = upper(:'mismatch_target')
      AND i."AcceptedAt" IS NULL AND i."RevokedAt" IS NULL),
  (SELECT count(*) FROM users u WHERE u."NormalizedEmail" = upper(:'mismatch_target')),
  (SELECT count(*) FROM users u WHERE u."NormalizedEmail" = upper(:'mismatch_other')),
  (SELECT count(*) FROM invites i
    WHERE i."NormalizedEmail" = upper(:'cross_email')
      AND i."TenantId" = CAST(:'foreign_tenant_id' AS uuid)
      AND i."AcceptedAt" IS NULL),
  (SELECT count(*) FROM users u WHERE u."NormalizedEmail" = upper(:'cross_email')),
  (SELECT count(*) FROM invites i WHERE i."NormalizedEmail" = upper(:'cross_admin_email'));
SQL
)"

  local accepted_user_count accepted_invite_count tenant_membership_count workspace_membership_count active_session_count
  local invite_created_audit_count invite_accepted_audit_count revoked_invite_count revoked_user_count
  local expired_invite_count expired_user_count mismatch_invite_count mismatch_target_user_count mismatch_other_user_count
  local cross_foreign_invite_count cross_user_count cross_admin_attempt_invite_count

  IFS='|' read -r \
    accepted_user_count accepted_invite_count tenant_membership_count workspace_membership_count active_session_count \
    invite_created_audit_count invite_accepted_audit_count revoked_invite_count revoked_user_count \
    expired_invite_count expired_user_count mismatch_invite_count mismatch_target_user_count mismatch_other_user_count \
    cross_foreign_invite_count cross_user_count cross_admin_attempt_invite_count <<< "$row"

  if [[ "$accepted_user_count" != "1" ||
        "$accepted_invite_count" != "1" ||
        "$tenant_membership_count" != "1" ||
        "$workspace_membership_count" != "1" ||
        "$active_session_count" != "2" ||
        "$invite_created_audit_count" != "1" ||
        "$invite_accepted_audit_count" != "1" ||
        "$revoked_invite_count" != "1" ||
        "$revoked_user_count" != "0" ||
        "$expired_invite_count" != "1" ||
        "$expired_user_count" != "0" ||
        "$mismatch_invite_count" != "1" ||
        "$mismatch_target_user_count" != "0" ||
        "$mismatch_other_user_count" != "0" ||
        "$cross_foreign_invite_count" != "1" ||
        "$cross_user_count" != "0" ||
        "$cross_admin_attempt_invite_count" != "0" ]]; then
    echo "MBJ-02 PostgreSQL state mismatch: acceptedUser=$accepted_user_count acceptedInvite=$accepted_invite_count tenantMembership=$tenant_membership_count workspaceMembership=$workspace_membership_count sessions=$active_session_count createAudit=$invite_created_audit_count acceptAudit=$invite_accepted_audit_count revokedInvite=$revoked_invite_count revokedUser=$revoked_user_count expiredInvite=$expired_invite_count expiredUser=$expired_user_count mismatchInvite=$mismatch_invite_count mismatchTargetUser=$mismatch_target_user_count mismatchOtherUser=$mismatch_other_user_count foreignInvite=$cross_foreign_invite_count crossUser=$cross_user_count crossAdminAttemptInvite=$cross_admin_attempt_invite_count" >&2
    return 1
  fi

  cat > test-results/mbj02-postgres-state.json <<JSON
{
  "journey": "MBJ-02",
  "acceptedUserCount": $accepted_user_count,
  "acceptedInviteCount": $accepted_invite_count,
  "activeTenantMembershipCount": $tenant_membership_count,
  "activeWorkspaceMembershipCount": $workspace_membership_count,
  "activeSessionCount": $active_session_count,
  "inviteCreatedAuditCount": $invite_created_audit_count,
  "inviteAcceptedAuditCount": $invite_accepted_audit_count,
  "revokedInviteCount": $revoked_invite_count,
  "revokedUserCount": $revoked_user_count,
  "expiredInviteCount": $expired_invite_count,
  "expiredUserCount": $expired_user_count,
  "mismatchUnusedInviteCount": $mismatch_invite_count,
  "mismatchTargetUserCount": $mismatch_target_user_count,
  "mismatchOtherUserCount": $mismatch_other_user_count,
  "foreignTenantUnusedInviteCount": $cross_foreign_invite_count,
  "crossTenantUserCount": $cross_user_count,
  "crossTenantAdminAttemptInviteCount": $cross_admin_attempt_invite_count,
  "secretMaterialRecorded": false
}
JSON
  echo "MBJ-02 PostgreSQL persistence and isolation state verified."
}

echo "Validating MBJ-02 Compose configuration."
"${compose[@]}" config --quiet

echo "Starting isolated PostgreSQL and MBJ-02 application stack."
"${compose[@]}" up --build --detach postgres app
wait_healthy postgres
wait_healthy app

seed_cross_tenant_fixture
run_probe
verify_postgres_state

echo "MBJ-02 administrator invite onboarding acceptance passed."
