using AipPortal.Application.Auth;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Messaging;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Application.Workspaces;

namespace AipPortal.Web.Realtime;

public sealed class RealtimeDispatchAuthorizer(
    IUserSessionService sessions,
    IWorkspaceAuthorizationService workspaces,
    IConversationAuthorizationService conversations,
    IProjectAuthorizationService projects) : IRealtimeDispatchAuthorizer
{
    public async Task<bool> CanReceiveAsync(HubSubscription subscription, RealtimeSubscriptionType targetType, Guid targetResourceId, CancellationToken cancellationToken = default)
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

        return targetType switch
        {
            RealtimeSubscriptionType.User => subscription.UserId == targetResourceId,
            RealtimeSubscriptionType.Tenant => subscription.TenantId == targetResourceId,
            RealtimeSubscriptionType.Workspace => await workspaces.CanViewWorkspace(subscription.UserId, targetResourceId, cancellationToken),
            RealtimeSubscriptionType.Conversation => await conversations.CanViewConversation(subscription.UserId, targetResourceId, cancellationToken),
            RealtimeSubscriptionType.Project => await projects.CanViewProject(subscription.UserId, targetResourceId, cancellationToken),
            _ => false
        };
    }
}

public interface IRealtimeDispatchAuthorizer
{
    Task<bool> CanReceiveAsync(HubSubscription subscription, RealtimeSubscriptionType targetType, Guid targetResourceId, CancellationToken cancellationToken = default);
}
