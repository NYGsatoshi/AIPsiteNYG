# API Contracts

This document is the active API convention guide. For endpoint examples, use `docs/API_SMOKE_TESTS.http`.

## General Rules

- REST APIs are the source of truth for the bundled frontend.
- Controllers stay thin and call Application services.
- APIs return DTOs, never EF entities.
- Request DTOs must not expose server-managed fields unless the use case explicitly requires them.
- Use async I/O for database and file operations.
- Keep broad list APIs paginated, filtered, or otherwise bounded.
- Avoid leaking whether records exist across tenant/resource boundaries.

## Request Conventions

- Use JSON request bodies for create/update commands.
- Use route IDs for target resources.
- Use query parameters for paging, search text, filters, and sorting.
- Use server-side current tenant context; do not accept `TenantId` from normal tenant endpoint bodies.
- Use generated storage keys and server-managed ownership for uploads.

## Response Conventions

- Return response DTOs shaped for the current use case.
- Keep response fields explicit; do not expose hashes, raw tokens, secrets, storage credentials, internal file paths, or EF navigation graphs.
- Return raw API token values only once during token creation.
- Include compact metadata where useful, such as IDs, display names, status, timestamps, and current user's role/permissions.

## Errors

Use the shared error response shape from `src/AipPortal.Web/Models/ErrorResponse.cs`.

Error responses should include:

- safe message
- trace ID or correlation ID when available
- validation details for bad input when safe

Production errors must not expose stack traces, connection strings, SQL, secrets, file paths, raw request bodies, or internal exception details.

## Validation

Validate input before executing use cases:

- Required fields and length limits.
- Enum/status values.
- Date/time ordering.
- Paging bounds.
- File size, extension, and MIME type.
- Feature flag availability.
- Quota availability.

Use Application-level validation for rules that need database state or authorization context.

## Authorization Expectations

- Authenticate protected endpoints.
- Enforce tenant access before resource access.
- Enforce resource authorization in Application services.
- Platform APIs live under `/api/platform/*` and require PlatformAdmin.
- Tenant administration APIs apply only to the current tenant.
- File download endpoints must authorize before returning bytes or storage redirects.
- Search, notifications, audit logs, exports, integrations, webhooks, and API tokens must be tenant-scoped.

## Pagination And Filtering

Use `PagedResponse<T>` for potentially large result sets.

List APIs should define:

- page number or cursor
- page size with a maximum
- allowed sort fields
- allowed filters
- tenant/resource scope

Never return unbounded tables to the browser UI.

## Uploads

Upload endpoints must:

- Authorize the user and target resource.
- Check feature flags and quotas.
- Validate file size, extension, and MIME type.
- Store metadata in PostgreSQL.
- Store bytes through `IFileStorageService`.
- Generate tenant-namespaced storage keys.
- Return metadata DTOs, not raw filesystem paths or permanent object URLs.

## CSRF And Browser Calls

When cookie auth and `Security:EnableCsrfProtection` are enabled, unsafe browser requests must include the `X-CSRF-TOKEN` header obtained from `GET /api/security/csrf-token`.

Safe `GET` requests do not require a CSRF token.

## Testing API Changes

For API changes, update or add tests according to risk:

- Unit/service tests for Application authorization and validation.
- HTTP integration tests for auth, CSRF, tenant resolution, and route behavior.
- Tenant isolation tests for tenant-owned resources.
- Upload tests for validation and authorization.
- API smoke examples in `docs/API_SMOKE_TESTS.http` when endpoint behavior changes.
