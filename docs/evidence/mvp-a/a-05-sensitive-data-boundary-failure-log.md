# A-05 Sensitive Data Boundary Failure Log

Issue: A-05 - [MVP-A][P0][DataBoundary] Verify sensitive data, secret, and error leakage boundary baseline

Date: 2026-06-28

Result: Needs verification

This failure log does not imply production approval, MVP-A Go, production readiness, or acceptance of unrelated MVP-A blockers.

## Summary

One source-level error detail leakage risk was found and fixed during A-05: unhandled exceptions returned `exception.Message` in Development. The response is now generic in every environment, and a regression test covers sensitive-looking exception text.

No confirmed committed raw secret was found in this pass. A-05 remains Needs verification because local reproduction of the redacted Gitleaks scan is blocked, live runtime log/API/UI/export checks were not fully captured, and fresh-runtime authenticated checks remain blocked by P0-001/P0-002.

## Resolved During A-05

### Development Exception Message In API Response

Failure area: API response leakage / error detail leakage

Endpoint or code area: `GlobalExceptionHandlingMiddleware`

Actor: any caller that triggers an unhandled exception in a Development-hosted app

Expected result: response contains a safe error code/message and trace ID only.

Actual result before fix: the middleware returned the raw exception message when `IHostEnvironment.IsDevelopment()` was true.

Sanitized response summary: source inspection showed exception-message echoing could expose internal details. No live raw secret or raw exception body was copied into evidence.

Sanitized log summary: no live runtime log was copied.

Suspected cause: development diagnostics behavior was allowed to reach API response bodies.

Required fix: return the generic `InternalServerError` message in all environments and keep detailed exception data in server logs only.

Whether this blocks MVP-A: yes before fix for A-05 error-boundary acceptance; no confirmed remaining leak after the fix and passing regression test.

Status: Resolved

Evidence: `GlobalExceptionHandlingMiddlewareTests.UnhandledExceptionResponseDoesNotExposeExceptionDetails` passed, and the full backend suite passed 129/129.

## Remaining Verification Blockers

### Redacted Secret Scanner Reproduction

Failure area: repository secret scan

Endpoint or code area: local Gitleaks reproduction / CI security-scan equivalent

Actor: local verifier

Expected result: a redacted secret scanner report is generated and reviewed without raw secret values.

Actual result: local `gitleaks` was not installed, and Docker daemon access was unavailable, so the Dockerized CI scanner could not run locally.

Sanitized response summary: no scanner report was generated.

Sanitized log summary: Docker client was available, but the daemon endpoint was unavailable.

Suspected cause: Docker Desktop engine not running or inaccessible in this Windows host/sandbox context; Gitleaks binary not installed locally.

Required fix: run the CI security-scan job or install/provide a local redacted scanner in a non-production environment.

Whether this blocks MVP-A: yes for A-05 acceptance.

Status: Blocked

### Ignored Local `.env` Provenance

Failure area: config secret boundary

Endpoint or code area: ignored local `.env`

Actor: local verifier

Expected result: committed repo has no raw production secrets, and any local secrets are kept out of evidence and git.

Actual result: `.env` is ignored/untracked and contains sensitive key names. Raw values were intentionally not printed or copied.

Sanitized response summary: two sensitive key names were detected locally; values were not copied.

Sanitized log summary: `git check-ignore` confirms `.env` is ignored.

Suspected cause: local/deployment config exists in the working tree as intended.

Required fix: keep `.env` ignored, do not copy values into evidence, and rotate any value if it was ever shared or committed elsewhere.

Whether this blocks MVP-A: not a committed-secret blocker by itself; provenance and rotation status remain Needs verification.

Status: Needs verification

### Live Runtime Logs

Failure area: log leakage

Endpoint or code area: startup logs, request logs, exception logs, auth-failure logs, DB-failure logs, audit logs, security-event logs

Actor: local verifier

Expected result: logs omit password/token/cookie/session ID, request bodies, authorization headers, connection strings, file/message bodies, and private data.

Actual result: source inspection found no broad request-body logging and found audit metadata key omission, but live log capture was not completed.

Sanitized response summary: no live log body captured.

Sanitized log summary: no live log excerpt copied.

Suspected cause: A-05 focused on source/test evidence; local runtime and Docker constraints remain.

Required fix: run a sanitized live logging pass with synthetic data only.

Whether this blocks MVP-A: yes for A-05 acceptance.

Status: Needs verification

### Authenticated API/UI/Export Smoke

Failure area: private data response boundary

Endpoint or code area: authenticated admin/non-admin/tenant APIs, project/conversation/file screens, downloads, tenant export

Actor: seeded admin, non-admin tenant member, wrong-tenant member

Expected result: authorized users see only allowed synthetic data; unauthorized users receive safe denial; no secret/private body is copied into evidence.

Actual result: automated backend tests cover many synthetic boundaries, but fresh-runtime authenticated smoke remains blocked by P0-001/P0-002.

Sanitized response summary: no authenticated runtime response body copied.

Sanitized log summary: no live UI/API/export log copied.

Suspected cause: existing baseline identity/bootstrap blocker.

Required fix: resolve P0-001/P0-002, then run A-05 API/UI/export smoke with sanitized captures.

Whether this blocks MVP-A: yes for A-05 acceptance.

Status: Needs verification

## No Observed Remaining P0 Leak In Final Automated Tests

The final automated backend pass did not show these leak examples:

- unhandled exception response exposing the sensitive-looking exception text from the regression test;
- login response exposing a session ID;
- sensitive admin setting value being returned by the admin service test;
- unauthorized tenant/project/conversation/file/audit/security-event synthetic data access in the covered backend tests.

This statement is limited to the tested synthetic paths and does not mark A-05 Accepted.
