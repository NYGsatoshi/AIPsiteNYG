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

## Seed And Migration

Migration `MultiTenantFoundation` creates a deterministic default tenant:

```text
11111111-1111-1111-1111-111111111111
```

Existing tenant-owned rows are backfilled to that tenant. Runtime seed is idempotent and can be enabled with `Tenancy:SeedOnStartup`; it also runs automatically for `OnPremSingleTenant`.

Do not hardcode production platform-admin passwords. Use a documented setup flow or development-only seed when that feature is added.
