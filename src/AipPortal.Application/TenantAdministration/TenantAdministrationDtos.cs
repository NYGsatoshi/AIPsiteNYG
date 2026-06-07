using AipPortal.Domain.Enums;

namespace AipPortal.Application.TenantAdministration;

public sealed record TenantSettingsResponse(
    Guid Id,
    Guid TenantId,
    string DisplayName,
    Guid? LogoFileId,
    string? ThemeColor,
    string DefaultLocale,
    string TimeZone,
    InvitationMode InvitationMode,
    long StorageQuotaBytes,
    int UserLimit,
    int ProjectLimit,
    long FileUploadLimitBytes,
    string FeatureFlagsJson,
    string NotificationSettingsJson,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record UpdateTenantSettingsRequest(
    string? DisplayName,
    Guid? LogoFileId,
    string? ThemeColor,
    string? DefaultLocale,
    string? TimeZone,
    InvitationMode? InvitationMode,
    long? StorageQuotaBytes,
    int? UserLimit,
    int? ProjectLimit,
    long? FileUploadLimitBytes,
    string? FeatureFlagsJson,
    string? NotificationSettingsJson);

public sealed record TenantFeaturesResponse(Guid TenantId, IReadOnlyList<string> EnabledFeatures);

public sealed record TenantUsageResponse(
    Guid TenantId,
    int ActiveUserCount,
    int TotalUserCount,
    int ProjectCount,
    int TaskCount,
    int FileCount,
    long StorageUsedBytes,
    int ApiRequestCount);

public sealed record PlanResponse(
    Guid Id,
    string Name,
    string? Description,
    int MaxUsers,
    long MaxStorageBytes,
    int MaxProjects,
    int? MaxExternalGuests,
    int? MaxApiRequestsPerDay,
    string EnabledFeaturesJson,
    decimal? PriceMonthly,
    PlanStatus Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record UpsertPlanRequest(
    string? Name,
    string? Description,
    int? MaxUsers,
    long? MaxStorageBytes,
    int? MaxProjects,
    int? MaxExternalGuests,
    int? MaxApiRequestsPerDay,
    string? EnabledFeaturesJson,
    decimal? PriceMonthly,
    PlanStatus? Status);

public sealed record SubscriptionResponse(
    Guid Id,
    Guid TenantId,
    Guid PlanId,
    string? PlanName,
    SubscriptionStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? EndsAt,
    DateTimeOffset? TrialEndsAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record UpdateSubscriptionRequest(
    Guid PlanId,
    SubscriptionStatus Status,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndsAt,
    DateTimeOffset? TrialEndsAt);
