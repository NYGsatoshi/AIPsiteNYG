using AipPortal.Application.Auth;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Messaging;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Application.Workspaces;
using AipPortal.Application.Files;

namespace AipPortal.Web.Realtime;

public sealed class RealtimeDispatchAuthorizer(
    IUserSessionService sessions,
    IWorkspaceAuthorizationService workspaces,
    IConversationAuthorizationService conversations,
    IProjectAuthorizationService projects,
    IFileRepository files,
    IFileAuthorizationService fileAuthorization) : IRealtimeDispatchAuthorizer
{
    public async Task<bool> CanReceiveAsync(HubSubscription subscription, RealtimeSubscriptionType targetType, Guid targetResourceId, DurableEventEnvelope envelope, CancellationToken cancellationToken = default)
    {
        if (subscription.SubscriptionType != targetType || subscription.ResourceId != targetResourceId)
        {
            return false;
        }

        var session = await sessions.ValidateSessionAsync(subscription.UserId, subscription.SessionId, subscription.TenantId, true, cancellationToken);
        if (!session.IsValid)
        {
            return false;
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

        // A workspace subscription is only a delivery optimization. Project
        // and file invalidations must still satisfy the resource's HTTP
        // authorization at the time a delayed Outbox event is dispatched.
        if (envelope.EventType == "Projects.ProjectChanged.v1" && targetType == RealtimeSubscriptionType.Workspace)
        {
            return await projects.CanViewProject(subscription.UserId, envelope.AggregateId, cancellationToken);
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
