# Tenancy

Tenant is the highest-level isolation unit in AIP Portal. A tenant can be a school, organization, company, NPO, municipality, studio, or internal pilot environment.

## Core Model

`Tenant` stores the platform-level organization record:

- `Id`, `Name`, `Slug`, `DisplayName`, `PrimaryDomain`
- `Status`: `Active`, `Suspended`, `Archived`, `Deleted`
- nullable `PlanId`
- audit timestamps and soft-delete timestamp

`TenantUser` stores tenant membership and role:

- `TenantId`, `UserId`
- `Role`: `Owner`, `Admin`, `Staff`, `Member`, `Guest`
- `Status`: `Active`, `Suspended`, `Invited`, `Left`, `Archived`
- `JoinedAt`, nullable `InvitedByUserId`

A user can belong to multiple tenants. Active duplicate membership for the same tenant is blocked by a unique filtered index.

## Current Tenant

Requests resolve server-side into `ICurrentTenant`:

- `TenantId`
- `TenantSlug`
- `IsAvailable`
- `IsPlatformScope`

Normal tenant-scoped endpoints require `IsAvailable`. Platform endpoints under `/api/platform/*` are explicitly marked as platform scope by middleware and may operate without a tenant filter.

Never trust `TenantId` from client request bodies. Create/update use cases must use the current server-side tenant context.

## Global Query Filter

All entities implementing `ITenantEntity` receive an EF Core global query filter:

```text
currentTenant.IsPlatformScope ||
(currentTenant.IsAvailable && entity.TenantId == currentTenant.TenantId)
```

`AppDbContext` also stamps `TenantId` on added tenant entities. If an added or modified tenant entity has a `TenantId` that differs from the current tenant, save is rejected unless the current operation is explicit platform scope.

`IgnoreQueryFilters` is allowed only in platform/tenant infrastructure services with explicit predicates and comments explaining the bypass.

## Deployment Modes

`Tenancy` configuration:

```json
{
  "AppMode": "SaaS",
  "DefaultTenantSlug": "default",
  "TenantResolutionStrategy": "Host",
  "AllowTenantSwitching": true
}
```

Modes:

- `SaaS`: resolve tenant by host, subdomain, session selection, or development header depending on configuration.
- `OnPremSingleTenant`: always resolves the configured default tenant and disables switching.
- `OnPremMultiTenant`: same resolution mechanics as SaaS, operated by the installed organization.

`HeaderForDevelopmentOnly` must not be enabled in production unless `AllowDevelopmentHeaderInProduction` is explicitly true.

## PlatformAdmin vs TenantAdmin

System role `PlatformAdmin` can manage tenants through `/api/platform/*`. Existing `SystemAdmin` is retained as an enum alias for compatibility.

Tenant roles live in `TenantUser`. Tenant `Owner` and `Admin` can manage users inside the current tenant only. Tenant admins cannot create, suspend, list, or modify other tenants.

## Isolation Risks

High-risk areas:

- New entities missing `ITenantEntity`.
- Normal services using `IgnoreQueryFilters`.
- Accepting `TenantId` from client DTOs.
- Cross-tenant joins that do not include tenant predicates.
- File, search, notification, and audit queries that omit `TenantId`.
- Platform admin APIs that do not explicitly verify `PlatformAdmin`.

When adding a tenant-owned feature, add `TenantId`, implement `ITenantEntity`, add tenant-aware unique indexes, and write a tenant isolation test.
