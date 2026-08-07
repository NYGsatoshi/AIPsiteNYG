using System.Text.Json;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Notifications;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// The single current-state resolver used by notification open and by durable
/// dispatch.  It deliberately returns only authorization decisions and safe
/// navigation metadata; callers never receive Task, Project, or Workspace
/// display data from this boundary.
/// </summary>
public sealed class CurrentAuthorizationTargetResolver(
    AppDbContext dbContext,
    ICurrentTenant currentTenant) : INotificationTargetResolver, IRealtimeEventTargetResolver
{
    private static readonly HashSet<string> TaskEventTypes = new(StringComparer.Ordinal)
    {
        "Projects.TaskChanged.v1",
        "Projects.TaskAssignmentChanged.v1",
        "Projects.TaskWorkflowChanged.v1",
        "Projects.TaskCommentChanged.v1"
    };

    public async Task<NotificationTargetResolution> ResolveAsync(
        Guid tenantId,
        Guid userId,
        Guid notificationId,
        CancellationToken cancellationToken = default)
    {
        if (!IsTenantInScope(tenantId) || userId == Guid.Empty || notificationId == Guid.Empty)
        {
            return NotOwned();
        }

        var notification = await dbContext.Notifications
            .AsNoTracking()
            .SingleOrDefaultAsync(item =>
                item.Id == notificationId &&
                item.TenantId == tenantId &&
                item.UserId == userId &&
                item.DeletedAt == null,
                cancellationToken);
        if (notification is null)
        {
            return NotOwned();
        }

        if (!await HasCurrentTenantUserAsync(tenantId, userId, cancellationToken))
        {
            return Unavailable(notification.StateVersion);
        }

        if (notification.RelatedEntityType is "TaskItem" or "Task")
        {
            if (!notification.RelatedEntityId.HasValue)
            {
                return Unavailable(notification.StateVersion);
            }

            var target = await ResolveTaskTargetAsync(tenantId, userId, notification.RelatedEntityId.Value, cancellationToken);
            return target is null
                ? Unavailable(notification.StateVersion)
                : new NotificationTargetResolution(
                    true,
                    true,
                    $"/projects/{target.ProjectId}/tasks/{target.TaskId}",
                    notification.StateVersion);
        }

        if (string.Equals(notification.RelatedEntityType, TaskDeadlineDigestPolicy.RelatedEntityType, StringComparison.Ordinal))
        {
            if (!notification.RelatedEntityId.HasValue)
            {
                return Unavailable(notification.StateVersion);
            }

            var target = await ResolveDigestTargetAsync(
                tenantId,
                userId,
                notification.Id,
                notification.RelatedEntityId.Value,
                cancellationToken);
            return target is null
                ? Unavailable(notification.StateVersion)
                : new NotificationTargetResolution(true, true, "/tasks", notification.StateVersion, target.WorkspaceId);
        }

        // This endpoint is intentionally narrow.  Legacy and unknown targets
        // cannot turn a persisted historical route into navigation authority.
        return Unavailable(notification.StateVersion);
    }

    public async Task<bool> CanDeliverCreatedAsync(
        Guid tenantId,
        Guid recipientUserId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        if (!IsTenantInScope(tenantId) ||
            envelope.EventType != "Notifications.NotificationCreated.v1" ||
            envelope.TenantId != tenantId ||
            !TryGetGuid(envelope.Payload, "notificationId", out var notificationId) ||
            notificationId != envelope.AggregateId ||
            !IsReferenceOnlyNotificationCreatedPayload(envelope.Payload, notificationId, envelope.AggregateVersion))
        {
            return false;
        }

        var resolution = await ResolveAsync(tenantId, recipientUserId, notificationId, cancellationToken);
        return resolution.IsOwned && resolution.IsAvailable;
    }

    public async Task<bool> CanDeliverReadStateAsync(
        Guid tenantId,
        Guid recipientUserId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        if (!IsTenantInScope(tenantId) ||
            envelope.EventType != "Notifications.NotificationReadStateChanged.v1" ||
            envelope.TenantId != tenantId ||
            !await HasCurrentTenantUserAsync(tenantId, recipientUserId, cancellationToken))
        {
            return false;
        }

        var hasNotificationId = TryGetNullableGuid(envelope.Payload, "notificationId", out var notificationId);
        if (!hasNotificationId)
        {
            return false;
        }

        if (!notificationId.HasValue)
        {
            return envelope.AggregateId == recipientUserId &&
                string.Equals(GetString(envelope.Payload, "change"), "allRead", StringComparison.Ordinal);
        }

        if (envelope.AggregateId != notificationId.Value)
        {
            return false;
        }

        // A delayed/replayed state signal is not allowed to outlive the
        // notification's currently authorized target. The response contains no
        // target projection, but it still reveals recipient-private state and
        // therefore shares the same current-target fence as notification open.
        var resolution = await ResolveAsync(tenantId, recipientUserId, notificationId.Value, cancellationToken);
        return resolution.IsOwned && resolution.IsAvailable;
    }

    public async Task<bool> CanReceiveTaskEventAsync(
        Guid tenantId,
        Guid userId,
        RealtimeSubscriptionType targetType,
        Guid targetResourceId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        if (!IsTenantInScope(tenantId) ||
            !TaskEventTypes.Contains(envelope.EventType) ||
            envelope.TenantId != tenantId ||
            envelope.AggregateType != "Task" ||
            !TryGetGuid(envelope.Payload, "taskId", out var taskId) ||
            taskId != envelope.AggregateId ||
            !TryGetGuid(envelope.Payload, "projectId", out var projectId))
        {
            return false;
        }

        var target = await ResolveTaskTargetAsync(tenantId, userId, taskId, cancellationToken);
        if (target is null || target.ProjectId != projectId)
        {
            return false;
        }

        return targetType switch
        {
            RealtimeSubscriptionType.User => targetResourceId == userId,
            RealtimeSubscriptionType.Project => targetResourceId == target.ProjectId,
            RealtimeSubscriptionType.Workspace => targetResourceId == target.WorkspaceId,
            _ => false
        };
    }

    public async Task<bool> CanReceiveProjectEventAsync(
        Guid tenantId,
        Guid userId,
        RealtimeSubscriptionType targetType,
        Guid targetResourceId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        if (!IsTenantInScope(tenantId) ||
            envelope.EventType != "Projects.ProjectChanged.v1" ||
            envelope.TenantId != tenantId ||
            envelope.AggregateType != "Project" ||
            !TryGetGuid(envelope.Payload, "projectId", out var projectId) ||
            projectId != envelope.AggregateId ||
            !TryGetGuid(envelope.Payload, "workspaceId", out var workspaceId))
        {
            return false;
        }

        var project = await ResolveProjectTargetAsync(tenantId, userId, projectId, cancellationToken);
        if (project is null || project.WorkspaceId != workspaceId)
        {
            return false;
        }

        return targetType switch
        {
            RealtimeSubscriptionType.Project => targetResourceId == project.ProjectId,
            RealtimeSubscriptionType.Workspace => targetResourceId == project.WorkspaceId,
            RealtimeSubscriptionType.User => targetResourceId == userId,
            _ => false
        };
    }

    public Task<bool> CanReceiveAuthorizationInvalidationAsync(
        Guid tenantId,
        Guid userId,
        RealtimeSubscriptionType targetType,
        Guid targetResourceId,
        DurableEventEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        var allowed = IsTenantInScope(tenantId) &&
            envelope.EventType == "Security.AuthorizationStateChanged.v1" &&
            envelope.TenantId == tenantId &&
            targetType == RealtimeSubscriptionType.User &&
            targetResourceId == userId &&
            envelope.AggregateId == userId &&
            TryGetGuid(envelope.Payload, "affectedUserId", out var affectedUserId) &&
            affectedUserId == userId;
        return Task.FromResult(allowed);
    }

    private async Task<ResolvedTaskTarget?> ResolveTaskTargetAsync(
        Guid tenantId,
        Guid userId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        if (!await HasCurrentTenantUserAsync(tenantId, userId, cancellationToken))
        {
            return null;
        }

        var task = await dbContext.TaskItems
            .AsNoTracking()
            .SingleOrDefaultAsync(item =>
                item.Id == taskId &&
                item.TenantId == tenantId &&
                item.DeletedAt == null,
                cancellationToken);
        if (task is null)
        {
            return null;
        }

        var project = await ResolveProjectTargetAsync(tenantId, userId, task.ProjectId, cancellationToken);
        return project is null || project.WorkspaceId != task.WorkspaceId
            ? null
            : new ResolvedTaskTarget(task.Id, project.ProjectId, project.WorkspaceId);
    }

    private async Task<ResolvedProjectTarget?> ResolveProjectTargetAsync(
        Guid tenantId,
        Guid userId,
        Guid projectId,
        CancellationToken cancellationToken)
    {
        if (!await HasCurrentTenantUserAsync(tenantId, userId, cancellationToken))
        {
            return null;
        }

        var project = await dbContext.Projects
            .AsNoTracking()
            .SingleOrDefaultAsync(item =>
                item.Id == projectId &&
                item.TenantId == tenantId &&
                item.DeletedAt == null &&
                item.Status != ProjectStatus.Archived &&
                item.Status != ProjectStatus.Deleted,
                cancellationToken);
        if (project is null)
        {
            return null;
        }

        var member = await dbContext.WorkspaceMembers
            .AsNoTracking()
            .SingleOrDefaultAsync(item =>
                item.TenantId == tenantId &&
                item.WorkspaceId == project.WorkspaceId &&
                item.UserId == userId &&
                item.Status == MembershipStatus.Active,
                cancellationToken);
        if (member is null ||
            !await dbContext.Workspaces.AsNoTracking().AnyAsync(item =>
                item.Id == project.WorkspaceId &&
                item.TenantId == tenantId &&
                item.DeletedAt == null &&
                item.Status == WorkspaceStatus.Active,
                cancellationToken))
        {
            return null;
        }

        var isProjectMember = await dbContext.ProjectMembers
            .AsNoTracking()
            .AnyAsync(item => item.TenantId == tenantId && item.ProjectId == projectId && item.UserId == userId, cancellationToken);
        if (!isProjectMember && project.GroupId.HasValue)
        {
            var canManageWorkspace = member.Role is WorkspaceRole.Owner or WorkspaceRole.Admin;
            var isActiveGroupMember = await dbContext.Groups
                .AsNoTracking()
                .Where(group =>
                    group.Id == project.GroupId.Value &&
                    group.TenantId == tenantId &&
                    group.WorkspaceId == project.WorkspaceId &&
                    group.DeletedAt == null &&
                    group.Status == GroupStatus.Active)
                .AnyAsync(group => group.Members.Any(groupMember => groupMember.UserId == userId), cancellationToken);
            if (!canManageWorkspace && !isActiveGroupMember)
            {
                return null;
            }
        }

        return new ResolvedProjectTarget(project.Id, project.WorkspaceId);
    }

    private async Task<ResolvedDigestTarget?> ResolveDigestTargetAsync(
        Guid tenantId,
        Guid userId,
        Guid notificationId,
        Guid digestJobId,
        CancellationToken cancellationToken)
    {
        var digest = await dbContext.TaskDeadlineDigestJobs
            .AsNoTracking()
            .SingleOrDefaultAsync(item =>
                item.Id == digestJobId &&
                item.TenantId == tenantId &&
                item.UserId == userId &&
                item.NotificationId == notificationId,
                cancellationToken);
        if (digest is null || !await HasCurrentWorkspaceMembershipAsync(tenantId, userId, digest.WorkspaceId, cancellationToken))
        {
            return null;
        }

        return new ResolvedDigestTarget(digest.WorkspaceId);
    }

    private async Task<bool> HasCurrentTenantUserAsync(Guid tenantId, Guid userId, CancellationToken cancellationToken)
    {
        return await dbContext.Users.AsNoTracking().AnyAsync(user =>
            user.Id == userId &&
            user.DeletedAt == null &&
            user.Status == UserStatus.Active,
            cancellationToken) &&
            await dbContext.Tenants.AsNoTracking().AnyAsync(tenant =>
                tenant.Id == tenantId &&
                tenant.DeletedAt == null &&
                tenant.Status == TenantStatus.Active,
                cancellationToken) &&
            await dbContext.TenantUsers.AsNoTracking().AnyAsync(member =>
                member.TenantId == tenantId &&
                member.UserId == userId &&
                member.Status == TenantUserStatus.Active,
                cancellationToken);
    }

    private async Task<bool> HasCurrentWorkspaceMembershipAsync(
        Guid tenantId,
        Guid userId,
        Guid workspaceId,
        CancellationToken cancellationToken)
    {
        return await dbContext.Workspaces.AsNoTracking().AnyAsync(workspace =>
            workspace.Id == workspaceId &&
            workspace.TenantId == tenantId &&
            workspace.DeletedAt == null &&
            workspace.Status == WorkspaceStatus.Active,
            cancellationToken) &&
            await dbContext.WorkspaceMembers.AsNoTracking().AnyAsync(member =>
                member.TenantId == tenantId &&
                member.WorkspaceId == workspaceId &&
                member.UserId == userId &&
                member.Status == MembershipStatus.Active,
                cancellationToken);
    }

    private bool IsTenantInScope(Guid tenantId) =>
        tenantId != Guid.Empty && currentTenant.IsAvailable && currentTenant.TenantId == tenantId;

    private static NotificationTargetResolution NotOwned() => new(false, false, null, 0);

    private static NotificationTargetResolution Unavailable(long stateVersion) => new(true, false, null, stateVersion);

    private static bool TryGetGuid(JsonElement payload, string name, out Guid value)
    {
        value = Guid.Empty;
        if (payload.ValueKind != JsonValueKind.Object ||
            !payload.TryGetProperty(name, out var property))
        {
            return false;
        }

        return property.ValueKind == JsonValueKind.String &&
            Guid.TryParse(property.GetString(), out value);
    }

    /// <summary>
    /// Task/digest notification signals deliberately contain only identity and
    /// ordering metadata. Enforcing that at delivery makes a replay of an
    /// accidentally widened historical payload fail closed instead of
    /// exposing a Task title, route, or relationship state.
    /// </summary>
    private static bool IsReferenceOnlyNotificationCreatedPayload(
        JsonElement payload,
        Guid notificationId,
        long? aggregateVersion)
    {
        if (payload.ValueKind != JsonValueKind.Object || aggregateVersion is not > 0)
        {
            return false;
        }

        var expectedProperties = new HashSet<string>(StringComparer.Ordinal)
        {
            "notificationId",
            "stateVersion",
            "requiresRefetch"
        };
        var propertyCount = 0;
        foreach (var property in payload.EnumerateObject())
        {
            if (!expectedProperties.Contains(property.Name))
            {
                return false;
            }

            propertyCount++;
        }

        return propertyCount == expectedProperties.Count &&
            TryGetGuid(payload, "notificationId", out var payloadNotificationId) &&
            payloadNotificationId == notificationId &&
            TryGetLong(payload, "stateVersion", out var stateVersion) &&
            stateVersion == aggregateVersion &&
            payload.TryGetProperty("requiresRefetch", out var requiresRefetch) &&
            requiresRefetch.ValueKind is JsonValueKind.True;
    }

    private static bool TryGetLong(JsonElement payload, string name, out long value)
    {
        value = 0;
        return payload.ValueKind == JsonValueKind.Object &&
            payload.TryGetProperty(name, out var property) &&
            property.ValueKind == JsonValueKind.Number &&
            property.TryGetInt64(out value);
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

        if (property.ValueKind != JsonValueKind.String || !Guid.TryParse(property.GetString(), out var parsed))
        {
            return false;
        }

        value = parsed;
        return true;
    }

    private static string? GetString(JsonElement payload, string name) =>
        payload.ValueKind == JsonValueKind.Object &&
        payload.TryGetProperty(name, out var property) &&
        property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private sealed record ResolvedTaskTarget(Guid TaskId, Guid ProjectId, Guid WorkspaceId);

    private sealed record ResolvedProjectTarget(Guid ProjectId, Guid WorkspaceId);

    private sealed record ResolvedDigestTarget(Guid WorkspaceId);
}
