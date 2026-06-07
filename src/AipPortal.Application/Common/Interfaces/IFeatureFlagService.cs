using AipPortal.Application.Common;

namespace AipPortal.Application.Common.Interfaces;

public static class FeatureKeys
{
    public const string ProductionTracking = nameof(ProductionTracking);
    public const string AdvancedGanttChart = nameof(AdvancedGanttChart);
    public const string ExternalGuestAccess = nameof(ExternalGuestAccess);
    public const string FileSharing = nameof(FileSharing);
    public const string Calendar = nameof(Calendar);
    public const string Attendance = nameof(Attendance);
    public const string Forms = nameof(Forms);
    public const string TenantExport = nameof(TenantExport);
    public const string WebhookIntegration = nameof(WebhookIntegration);
    public const string ApiAccess = nameof(ApiAccess);
    public const string CustomBranding = nameof(CustomBranding);
    public const string AuditLogViewer = nameof(AuditLogViewer);
    public const string RadialMenu = nameof(RadialMenu);
    public const string DockingLayout = nameof(DockingLayout);

    public static readonly IReadOnlyList<string> All =
    [
        ProductionTracking,
        AdvancedGanttChart,
        ExternalGuestAccess,
        FileSharing,
        Calendar,
        Attendance,
        Forms,
        TenantExport,
        WebhookIntegration,
        ApiAccess,
        CustomBranding,
        AuditLogViewer,
        RadialMenu,
        DockingLayout
    ];
}

public interface IFeatureFlagService
{
    Task<bool> IsEnabledAsync(string featureKey, CancellationToken cancellationToken = default);

    Task<Result> RequireEnabledAsync(string featureKey, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<string>> GetEnabledFeaturesAsync(Guid tenantId, CancellationToken cancellationToken = default);
}
