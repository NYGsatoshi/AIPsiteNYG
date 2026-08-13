using AipPortal.Application.Auth;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Messaging;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Application.Workspaces;
using AipPortal.Application.Files;
using AipPortal.Application.Notifications;

namespace AipPortal.Web.Realtime;

public sealed class RealtimeDispatchAuthorizer(
    IUserSessionService sessions,
    IWorkspaceAuthorizationService workspaces,
    IConversationAuthorizationService conversations,
    IProjectAuthorizationService projects,
    IFileRepository files,
    IFileAuthorizationService fileAuthorization,
    INotificationTargetResolver notifications,
    IRealtimeEventTargetResolver eventTargets) : IRealtimeDispatchAuthorizer
{
    public async Task<bool> CanReceiveAsync(HubSubscription subscription, RealtimeSubscriptionType targetType, Guid targetResourceId, DurableEventEnvelope envelope, CancellationToken cancellationToken = default)
    {
        if (subscription.SubscriptionType != targetType || subscription.ResourceId != targetResourceId)
        {
            return false;
        }

        if (subscription.TenantId != envelope.TenantId)
        {
            return false;
        }

        // This event is deliberately sent before an invalidated user route is
        // removed.  It has no protected data, but its recipient-only identity
        // is still checked rather than trusting historical routing metadata.
        if (envelope.EventType == "Security.AuthorizationStateChanged.v1")
        {
            return await eventTargets.CanReceiveAuthorizationInvalidationAsync(
                subscription.TenantId,
                subscription.UserId,
                targetType,
                targetResourceId,
                envelope,
                cancellationToken);
        }

        var session = await sessions.ValidateSessionAsync(subscription.UserId, subscription.SessionId, subscription.TenantId, true, cancellationToken);
        if (!session.IsValid)
        {
            return false;
        }

        if (envelope.EventType == "Notifications.NotificationCreated.v1")
        {
            return targetType == RealtimeSubscriptionType.User &&
                targetResourceId == subscription.UserId &&
                await notifications.CanDeliverCreatedAsync(subscription.TenantId, subscription.UserId, envelope, cancellationToken);
        }

        if (envelope.EventType == "Notifications.NotificationReadStateChanged.v1")
        {
            return targetType == RealtimeSubscriptionType.User &&
                targetResourceId == subscription.UserId &&
                await notifications.CanDeliverReadStateAsync(subscription.TenantId, subscription.UserId, envelope, cancellationToken);
        }

        if (envelope.EventType is "Projects.TaskChanged.v1" or
            "Projects.TaskAssignmentChanged.v1" or
            "Projects.TaskWorkflowChanged.v1" or
            "Projects.TaskCommentChanged.v1")
        {
            return await eventTargets.CanReceiveTaskEventAsync(
                subscription.TenantId,
                subscription.UserId,
                targetType,
                targetResourceId,
                envelope,
                cancellationToken);
        }

        if (envelope.EventType == "Projects.ProjectChanged.v1")
        {
            return await eventTargets.CanReceiveProjectEventAsync(
                subscription.TenantId,
                subscription.UserId,
                targetType,
                targetResourceId,
                envelope,
                cancellationToken);
        }

        var targetAllowed = targetType switch
        {
            RealtimeSubscriptionType.User => subscription.UserId == targetResourceId,
            RealtimeSubscriptionType.Tenant => subscription.TenantId == targetResourceId,
            RealtimeSubscriptionType.Workspace => await workspaces.CanViewWorkspace(subscription.UserId, targetResourceId, cancellationToken),
            RealtimeSubscriptionType.Conversation => await conversations.CanViewConversation(subscription.UserId, targetResourceId, cancellationToken),
            RealtimeSubscriptionType.Project => await projects.CanViewProject(subscription.UserId, targetResourceId, cancellationToken),
            _ => false
        };
        if (!targetAllowed)
        {
            return false;
        }

        if (envelope.EventType == "Files.FileChanged.v1")
        {
            var attachment = await files.GetAttachmentByFileObjectAsync(envelope.AggregateId, cancellationToken);
            return attachment is not null && await fileAuthorization.CanViewAttachment(subscription.UserId, attachment, cancellationToken);
        }

        return true;
    }
}

public interface IRealtimeDispatchAuthorizer
{
    Task<bool> CanReceiveAsync(HubSubscription subscription, RealtimeSubscriptionType targetType, Guid targetResourceId, DurableEventEnvelope envelope, CancellationToken cancellationToken = default);
}
