using AipPortal.Domain.Enums;

namespace AipPortal.Application.Common.Tenancy;

public sealed class TenancyOptions
{
    public AppMode AppMode { get; set; } = AppMode.SaaS;

    public string DefaultTenantSlug { get; set; } = "default";

    public TenantResolutionStrategy TenantResolutionStrategy { get; set; } = TenantResolutionStrategy.Host;

    public bool AllowTenantSwitching { get; set; } = true;

    public bool SeedOnStartup { get; set; }

    public bool AllowDevelopmentHeaderInProduction { get; set; }

    public string DevelopmentTenantHeaderName { get; set; } = "X-Tenant-Slug";

    public string TenantCookieName { get; set; } = "aip_tenant";
}
