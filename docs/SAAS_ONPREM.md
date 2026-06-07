# SaaS And On-Prem Modes

AIP Portal is built as one multi-tenant platform that can run in SaaS or installed on-premise modes.

## SaaS

`AppMode = SaaS`

Tenant resolution can use:

- `Host`: match request host to `Tenant.PrimaryDomain`; localhost falls back to `DefaultTenantSlug`.
- `Subdomain`: use the first host segment as the tenant slug.
- `Session`: use the tenant selection cookie set by `/api/tenants/switch`.
- `HeaderForDevelopmentOnly`: read `X-Tenant-Slug` only when explicitly allowed.
- `ConfigDefault`: use `DefaultTenantSlug`.

SaaS deployments should prefer `Host` or `Subdomain`. Tenant switching is allowed only to tenants where the authenticated user has active membership.

## OnPremSingleTenant

`AppMode = OnPremSingleTenant`

The configured `DefaultTenantSlug` is always used. Tenant switching is disabled, and startup seed creates the default tenant if needed.

This mode is for an installed single organization while still keeping internal data tenant-scoped.

## OnPremMultiTenant

`AppMode = OnPremMultiTenant`

Resolution works like SaaS, but the tenants are operated by the installed organization. This supports cases such as multiple schools or departments inside one installation.

## File Storage

File bodies are stored outside PostgreSQL through the `IFileStorageService` abstraction. The database stores `FileObject` metadata, tenant scope, ownership scope, content type, size, scan/status fields, and the generated storage key.

Supported provider names:

- `LocalFileSystem`: implemented for development and small on-prem deployments.
- `ObjectStorage`, `S3Compatible`, `OCIObjectStorage`: configuration placeholders for SaaS/object-storage deployments; production adapters should keep the same provider-neutral interface.

Local filesystem storage is acceptable for small on-prem deployments when the storage root is backed up and monitored. SaaS deployments should use object storage. On-prem installations can use local filesystem storage, NAS-mounted storage, MinIO, or another S3-compatible object storage service once an adapter is enabled.

Storage keys are tenant-namespaced, for example `tenants/{tenantId}/files/{fileId}` and `tenants/{tenantId}/projects/{projectId}/files/{fileId}`. User-provided file names are metadata only and are never used as storage keys. Downloads go through application authorization and must not expose raw permanent object-storage URLs.

Backups must include both the database and the configured file storage root or bucket. The tenant ID in each storage key makes tenant export, restore, and forensic review easier.

## Plans, Features, And Quotas

On-prem deployments can run without payment integration. `Plan` and `Subscription` still exist as license/configuration objects so the same feature flag and quota paths work in SaaS and installed deployments.

Quota enforcement may be advisory or strict depending on deployment policy. The current foundation enforces file upload size and tenant storage quota through `IQuotaService`; user, project, guest, and API quotas have service hooks for later enforcement.

Feature flags are tenant-scoped and can be derived from plan defaults plus tenant overrides. They control enabled modules such as production tracking, radial menu, docking layout, forms, calendar, API access, and file sharing. Enterprise/on-prem admins can later use the same model for offline license files or centrally managed configuration.

## Seed And Migration

Migration `MultiTenantFoundation` creates a deterministic default tenant:

```text
11111111-1111-1111-1111-111111111111
```

Existing tenant-owned rows are backfilled to that tenant. Runtime seed is idempotent and can be enabled with `Tenancy:SeedOnStartup`; it also runs automatically for `OnPremSingleTenant`.

Do not hardcode production platform-admin passwords. Use a documented setup flow or development-only seed when that feature is added.
