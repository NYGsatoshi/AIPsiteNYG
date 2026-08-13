using AipPortal.Application.Realtime;

namespace AipPortal.Application.Notifications;

/// <summary>
/// A metadata-only result of resolving a notification target under the
/// recipient's current authorization.  Display fields and historical target
/// routes are deliberately absent.
/// </summary>
public sealed record NotificationTargetResolution(
    bool IsOwned,
    bool IsAvailable,
    string? Route,
    long StateVersion,
    Guid? WorkspaceId = null);

/// <summary>
/// Centralizes the current-state checks shared by notification opening and
/// durable realtime dispatch.  Delivery routing remains an optimization;
/// this resolver is the authority for the underlying target.
/// </summary>
public interface INotificationTargetResolver
{
    Task<NotificationTargetResolution> ResolveAsync(
        Guid tenantId,
        Guid userId,
        Guid notificationId,
        CancellationToken cancellationToken = default);

    Task<bool> CanDeliverCreatedAsync(
        Guid tenantId,
        Guid recipientUserId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default);

    Task<bool> CanDeliverReadStateAsync(
        Guid tenantId,
        Guid recipientUserId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Resolves the current resource identity and authorization for approved
/// task/project realtime invalidations.  It intentionally exposes no entity
/// data to the Web realtime boundary.
/// </summary>
public interface IRealtimeEventTargetResolver
{
    Task<bool> CanReceiveTaskEventAsync(
        Guid tenantId,
        Guid userId,
        RealtimeSubscriptionType targetType,
        Guid targetResourceId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default);

    Task<bool> CanReceiveProjectEventAsync(
        Guid tenantId,
        Guid userId,
        RealtimeSubscriptionType targetType,
        Guid targetResourceId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default);

    Task<bool> CanReceiveAuthorizationInvalidationAsync(
        Guid tenantId,
        Guid userId,
        RealtimeSubscriptionType targetType,
        Guid targetResourceId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default);
}

public interface INotificationOpenService
{
    Task<NotificationTargetResolution> OpenAsync(
        Guid tenantId,
        Guid userId,
        Guid notificationId,
        CancellationToken cancellationToken = default);
}
