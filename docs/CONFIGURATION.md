# Configuration

AIP Portal supports these deployment profiles:

- `Development`: local development with safe setup switches and development tenant header resolution.
- `SaaS`: hosted multi-tenant deployment.
- `OnPremSingleTenant`: installed single-tenant deployment using a configured default tenant.
- `OnPremMultiTenant`: installed multi-tenant deployment.
- `Test`: repeatable automated test profile.

Profiles are selected through ASP.NET Core environment/config files such as `appsettings.Development.json`, `appsettings.SaaS.example.json`, `appsettings.OnPremSingleTenant.example.json`, `appsettings.OnPremMultiTenant.example.json`, and `appsettings.Test.json`. Environment variables override JSON config.

## Tenancy

- `Tenancy:AppMode`: `SaaS`, `OnPremSingleTenant`, or `OnPremMultiTenant`.
- `Tenancy:DefaultTenantSlug`: required for `OnPremSingleTenant`; used as localhost/config fallback.
- `Tenancy:TenantResolutionStrategy`: `Host`, `Subdomain`, `Session`, `HeaderForDevelopmentOnly`, or `ConfigDefault`.
- `Tenancy:AllowTenantSwitching`: enables user tenant switching when membership allows it.
- `Tenancy:AllowDevelopmentHeaderTenantResolution`: enables development header resolution.
- `Tenancy:AllowDevelopmentHeaderInProduction`: must remain false in production.

## FileStorage

- `FileStorage:Provider`: `LocalFileSystem`, `ObjectStorage`, `S3Compatible`, or `OCIObjectStorage`.
- `FileStorage:RootPath`: required for `LocalFileSystem`.
- `FileStorage:BucketName`, `Endpoint`, `Region`: required by object storage providers according to provider.
- `FileStorage:MaxFileSizeBytes`: positive upload limit.
- `FileStorage:AllowedExtensions`: non-empty list of extensions with leading dots.
- `FileStorage:AllowedContentTypes`: non-empty list of MIME types accepted by upload endpoints.
- `FileStorage:UseSignedUrls`: enables provider signed URL use when the adapter supports it.

## Security

- `Security:CookieSecurePolicy`: `Always` in production.
- `Security:RequireHttps`: true in production.
- `Security:EnableHsts`: true in production.
- `Security:EnableCsrfProtection`: reserved switch for CSRF middleware/policies.
- `Security:EnableRateLimiting`: reserved switch for rate limiting middleware/policies.
- `Security:LoginLockoutEnabled`: enables login lockout policy.
- `Security:MaxFailedLoginAttempts`: positive when lockout is enabled.

## Platform

- `Platform:EnablePlatformAdmin`: enables platform admin operations.
- `Platform:PlatformAdminSetupMode`: development/setup only; invalid in production.
- `Platform:AllowTenantCreationFromAdmin`: allows PlatformAdmin-created tenants.
- `Platform:EnablePlansAndSubscriptions`: exposes plan/subscription foundation.
- `Platform:EnableUsageQuota`: exposes quota and usage foundation.

## Features

- `Features:EnableRadialMenu`
- `Features:EnableDockingLayout`
- `Features:EnableForms`
- `Features:EnableEvents`
- `Features:EnableProductionTracking`
- `Features:EnableWebhooks`
- `Features:EnableApiTokens`

Startup validation fails fast for invalid app mode, unsafe production tenant header resolution, unsafe production cookies/HTTPS/HSTS, missing file storage settings, invalid upload limits/extensions/content types, and production setup mode.
