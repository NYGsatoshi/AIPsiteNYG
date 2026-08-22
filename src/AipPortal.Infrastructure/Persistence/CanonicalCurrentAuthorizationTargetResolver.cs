using System.Text.Json;
using AipPortal.Application.Notifications;
using AipPortal.Application.Realtime;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// Final AND-fence over the legacy/current target resolver. Task notifications
/// and Task/Project realtime must satisfy the same SQL-translatable Project read
/// scope used by HTTP/search/artifact boundaries; this class can only narrow the
/// inner decision and therefore cannot create new access.
/// </summary>
public sealed class CanonicalCurrentAuthorizationTargetResolver(
    AppDbContext dbContext,
    CurrentAuthorizationTargetResolver inner) : INotificationTargetResolver, IRealtimeEventTargetResolver
{
    public async Task<NotificationTargetResolution> ResolveAsync(
        Guid tenantId,
        Guid userId,
        Guid notificationId,
        CancellationToken cancellationToken = default)
    {
        var resolution = await inner.ResolveAsync(tenantId, userId, notificationId, cancellationToken);
        if (!resolution.IsOwned || !resolution.IsAvailable)
        {
            return resolution;
        }

        var target = await FindNotificationTargetAsync(
            tenantId,
            userId,
            notificationId,
            includeDeleted: false,
            cancellationToken);
        if (target is null)
        {
            return Unavailable(resolution.StateVersion);
        }
        if (target.RelatedEntityType is not ("TaskItem" or "Task"))
        {
            return resolution;
        }

        return target.RelatedEntityId.HasValue &&
               await IsTaskVisibleAsync(tenantId, userId, target.RelatedEntityId.Value, cancellationToken)
            ? resolution
            : Unavailable(resolution.StateVersion);
    }

    public async Task<bool> CanDeliverCreatedAsync(
        Guid tenantId,
        Guid recipientUserId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        if (!await inner.CanDeliverCreatedAsync(tenantId, recipientUserId, envelope, cancellationToken))
        {
            return false;
        }

        var target = await FindNotificationTargetAsync(
            tenantId,
            recipientUserId,
            envelope.AggregateId,
            includeDeleted: false,
            cancellationToken);
        return target is not null &&
               (target.RelatedEntityType is not ("TaskItem" or "Task") ||
                (target.RelatedEntityId.HasValue &&
                 await IsTaskVisibleAsync(tenantId, recipientUserId, target.RelatedEntityId.Value, cancellationToken)));
    }

    public async Task<bool> CanDeliverReadStateAsync(
        Guid tenantId,
        Guid recipientUserId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        if (!await inner.CanDeliverReadStateAsync(tenantId, recipientUserId, envelope, cancellationToken))
        {
            return false;
        }

        if (!TryGetNullableGuid(envelope.Payload, "notificationId", out var notificationId) || !notificationId.HasValue)
        {
            return true;
        }

        var target = await FindNotificationTargetAsync(
            tenantId,
            recipientUserId,
            notificationId.Value,
            includeDeleted: true,
            cancellationToken);
        return target is not null &&
               (target.RelatedEntityType is not ("TaskItem" or "Task") ||
                (target.RelatedEntityId.HasValue &&
                 await IsTaskVisibleAsync(tenantId, recipientUserId, target.RelatedEntityId.Value, cancellationToken)));
    }

    public async Task<IReadOnlySet<Guid>> FilterAvailableNotificationIdsAsync(
        Guid tenantId,
        Guid userId,
        IReadOnlyCollection<Guid> notificationIds,
        CancellationToken cancellationToken = default)
    {
        var innerAvailable = await inner.FilterAvailableNotificationIdsAsync(
            tenantId,
            userId,
            notificationIds,
            cancellationToken);
        if (innerAvailable.Count == 0)
        {
            return innerAvailable;
        }

        var requestedIds = innerAvailable.ToArray();
        var targets = await dbContext.Notifications
            .AsNoTracking()
            .Where(item =>
                requestedIds.Contains(item.Id) &&
                item.TenantId == tenantId &&
                item.UserId == userId &&
                item.DeletedAt == null)
            .Select(item => new NotificationTarget(item.Id, item.RelatedEntityType, item.RelatedEntityId))
            .ToListAsync(cancellationToken);

        var available = new HashSet<Guid>();
        foreach (var target in targets)
        {
            if (target.RelatedEntityType is not ("TaskItem" or "Task"))
            {
                available.Add(target.NotificationId);
                continue;
            }

            if (target.RelatedEntityId.HasValue &&
                await IsTaskVisibleAsync(tenantId, userId, target.RelatedEntityId.Value, cancellationToken))
            {
                available.Add(target.NotificationId);
            }
        }

        return available;
    }

    public async Task<bool> CanReceiveTaskEventAsync(
        Guid tenantId,
        Guid userId,
        RealtimeSubscriptionType targetType,
        Guid targetResourceId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        return await inner.CanReceiveTaskEventAsync(
                   tenantId,
                   userId,
                   targetType,
                   targetResourceId,
                   envelope,
                   cancellationToken) &&
               TryGetGuid(envelope.Payload, "projectId", out var projectId) &&
               await IsProjectVisibleAsync(tenantId, userId, projectId, cancellationToken);
    }

    public async Task<bool> CanReceiveProjectEventAsync(
        Guid tenantId,
        Guid userId,
        RealtimeSubscriptionType targetType,
        Guid targetResourceId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        return await inner.CanReceiveProjectEventAsync(
                   tenantId,
                   userId,
                   targetType,
                   targetResourceId,
                   envelope,
                   cancellationToken) &&
               TryGetGuid(envelope.Payload, "projectId", out var projectId) &&
               await IsProjectVisibleAsync(tenantId, userId, projectId, cancellationToken);
    }

    public Task<bool> CanReceiveAuthorizationInvalidationAsync(
        Guid tenantId,
        Guid userId,
        RealtimeSubscriptionType targetType,
        Guid targetResourceId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default) =>
        inner.CanReceiveAuthorizationInvalidationAsync(
            tenantId,
            userId,
            targetType,
            targetResourceId,
            envelope,
            cancellationToken);

    private async Task<bool> IsTaskVisibleAsync(
        Guid tenantId,
        Guid userId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        var task = await dbContext.TaskItems
            .AsNoTracking()
            .Where(item =>
                item.Id == taskId &&
                item.TenantId == tenantId &&
                item.DeletedAt == null)
            .Select(item => new { item.ProjectId, item.WorkspaceId })
            .SingleOrDefaultAsync(cancellationToken);
        if (task is null)
        {
            return false;
        }

        return await dbContext.VisibleProjectsFor(userId).AnyAsync(project =>
            project.Id == task.ProjectId &&
            project.TenantId == tenantId &&
            project.WorkspaceId == task.WorkspaceId,
            cancellationToken);
    }

    private Task<bool> IsProjectVisibleAsync(
        Guid tenantId,
        Guid userId,
        Guid projectId,
        CancellationToken cancellationToken) =>
        dbContext.VisibleProjectsFor(userId).AnyAsync(project =>
            project.Id == projectId && project.TenantId == tenantId,
            cancellationToken);

    private Task<NotificationTarget?> FindNotificationTargetAsync(
        Guid tenantId,
        Guid userId,
        Guid notificationId,
        bool includeDeleted,
        CancellationToken cancellationToken) =>
        dbContext.Notifications
            .AsNoTracking()
            .Where(item =>
                item.Id == notificationId &&
                item.TenantId == tenantId &&
                item.UserId == userId &&
                (includeDeleted || item.DeletedAt == null))
            .Select(item => new NotificationTarget(item.Id, item.RelatedEntityType, item.RelatedEntityId))
            .SingleOrDefaultAsync(cancellationToken);

    private static NotificationTargetResolution Unavailable(long stateVersion) =>
        new(true, false, null, stateVersion);

    private static bool TryGetGuid(JsonElement payload, string name, out Guid value)
    {
        value = Guid.Empty;
        return payload.ValueKind == JsonValueKind.Object &&
               payload.TryGetProperty(name, out var property) &&
               property.ValueKind == JsonValueKind.String &&
               Guid.TryParse(property.GetString(), out value);
    }

    private static bool TryGetNullableGuid(JsonElement payload, string name, out Guid? value)
    {
        value = null;
        if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty(name, out var property))
        {
            return false;
        }
        if (property.ValueKind == JsonValueKind.Null)
        {
            return true;
        }
        if (property.ValueKind == JsonValueKind.String && Guid.TryParse(property.GetString(), out var parsed))
        {
            value = parsed;
            return true;
        }
        return false;
    }

    private sealed record NotificationTarget(
        Guid NotificationId,
        string? RelatedEntityType,
        Guid? RelatedEntityId);
}

/// <summary>
/// Production notification resolver: current canonical authorization is checked
/// before and after navigation metadata resolution. Artifact/Message route
/// canonicalization remains owned by NotificationNavigationTargetResolver.
/// </summary>
public sealed class CanonicalNotificationTargetResolver(
    CanonicalCurrentAuthorizationTargetResolver currentAuthorization,
    NotificationNavigationTargetResolver navigation) : INotificationTargetResolver
{
    public async Task<NotificationTargetResolution> ResolveAsync(
        Guid tenantId,
        Guid userId,
        Guid notificationId,
        CancellationToken cancellationToken = default)
    {
        var initial = await currentAuthorization.ResolveAsync(
            tenantId,
            userId,
            notificationId,
            cancellationToken);
        if (!initial.IsOwned || !initial.IsAvailable)
        {
            return initial;
        }

        var navigated = await navigation.ResolveAsync(
            tenantId,
            userId,
            notificationId,
            cancellationToken);
        if (!navigated.IsOwned || !navigated.IsAvailable)
        {
            return navigated;
        }

        var final = await currentAuthorization.ResolveAsync(
            tenantId,
            userId,
            notificationId,
            cancellationToken);
        if (!final.IsOwned ||
            !final.IsAvailable ||
            final.StateVersion != initial.StateVersion ||
            !string.Equals(final.Route, initial.Route, StringComparison.Ordinal))
        {
            return final.IsOwned
                ? new NotificationTargetResolution(true, false, null, final.StateVersion)
                : final;
        }

        return navigated with { StateVersion = final.StateVersion };
    }

    public Task<bool> CanDeliverCreatedAsync(
        Guid tenantId,
        Guid recipientUserId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default) =>
        currentAuthorization.CanDeliverCreatedAsync(
            tenantId,
            recipientUserId,
            envelope,
            cancellationToken);

    public Task<bool> CanDeliverReadStateAsync(
        Guid tenantId,
        Guid recipientUserId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default) =>
        currentAuthorization.CanDeliverReadStateAsync(
            tenantId,
            recipientUserId,
            envelope,
            cancellationToken);

    public Task<IReadOnlySet<Guid>> FilterAvailableNotificationIdsAsync(
        Guid tenantId,
        Guid userId,
        IReadOnlyCollection<Guid> notificationIds,
        CancellationToken cancellationToken = default) =>
        currentAuthorization.FilterAvailableNotificationIdsAsync(
            tenantId,
            userId,
            notificationIds,
            cancellationToken);
}
