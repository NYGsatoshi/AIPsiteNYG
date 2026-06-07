# Smoke Test

## Tenant-Aware Shell

- Sign in as a normal tenant user and confirm the header shows current tenant name, status, role, and app mode.
- Confirm normal users do not see Platform Admin navigation.
- In OnPremSingleTenant mode, confirm the tenant switcher is hidden.
- In SaaS or OnPremMultiTenant with switching enabled, confirm the switcher lists only memberships from `GET /api/tenants/my` and reloads after a successful switch.

## Admin Separation

- Sign in as Tenant Owner/Admin and confirm `/tenant-admin` loads current-tenant usage, quotas, features, and settings summary.
- Confirm Tenant Owner/Admin does not see `/platform-admin` navigation and cannot call `/api/platform/*`.
- Sign in as PlatformAdmin and confirm `/platform-admin` loads platform overview, tenants, usage, and plans.

## Tenant State And Feature Flags

- Suspend a tenant as PlatformAdmin and confirm normal tenant resolution fails.
- Confirm stale active sessions cannot complete tenant-owned writes after the tenant is suspended.
- Disable a tenant feature and confirm it is absent from `GET /api/ui/modules` and hidden from navigation.
- Confirm backend APIs still reject disabled features even if a user manually navigates to a route.

## Quotas And On-Prem Checklist

- Confirm `/tenant-admin` shows storage, user, project, and upload-limit data with warning states around 80% and 95%.
- Open `/onboarding` in OnPremSingleTenant mode and verify the setup checklist is visible.
