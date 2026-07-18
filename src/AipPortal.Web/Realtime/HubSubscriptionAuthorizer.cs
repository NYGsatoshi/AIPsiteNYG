using AipPortal.Application.Auth;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Messaging;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Application.Workspaces;

namespace AipPortal.Web.Realtime;

public sealed class HubSubscriptionAuthorizer(
    IUserSessionService sessions,
    ICurrentUser currentUser,
    ICurrentTenant currentTenant,
    IFeatureFlagService featureFlags,
    IWorkspaceAuthorizationService workspaces,
    IConversationAuthorizationService conversations,
    IProjectAuthorizationService projects) : IHubSubscriptionAuthorizer
{
    public async Task<HubAuthorizationContext?> ValidateConnectionAsync(CancellationToken cancellationToken = default)
    {
        if (!currentTenant.IsAvailable || !currentUser.IsAuthenticated || !currentUser.UserId.HasValue || !currentUser.SessionId.HasValue ||
            !await featureFlags.IsEnabledAsync(FeatureKeys.RealtimeSignalR, cancellationToken))
        {
            return null;
        }

        var session = await sessions.ValidateSessionAsync(currentUser.UserId.Value, currentUser.SessionId.Value, currentTenant.TenantId, true, cancellationToken);
        return session.IsValid
            ? new HubAuthorizationContext(currentUser.UserId.Value, currentUser.SessionId.Value, currentTenant.TenantId)
            : null;
    }

    public async Task<bool> CanSubscribeAsync(HubAuthorizationContext context, RealtimeSubscriptionType subscriptionType, Guid resourceId, CancellationToken cancellationToken = default)
    {
        if (resourceId == Guid.Empty || !currentTenant.IsAvailable || currentTenant.TenantId != context.TenantId ||
            !await featureFlags.IsEnabledAsync(FeatureKeys.AuthorizedRealtimeGroups, cancellationToken))
        {
            return false;
        }

        var session = await sessions.ValidateSessionAsync(context.UserId, context.SessionId, context.TenantId, true, cancellationToken);
        if (!session.IsValid)
        {
            return false;
        }

        return subscriptionType switch
        {
            RealtimeSubscriptionType.User => resourceId == context.UserId,
            RealtimeSubscriptionType.Tenant => resourceId == context.TenantId,
            RealtimeSubscriptionType.Workspace => await workspaces.CanViewWorkspace(context.UserId, resourceId, cancellationToken),
            RealtimeSubscriptionType.Conversation => await conversations.CanViewConversation(context.UserId, resourceId, cancellationToken),
            RealtimeSubscriptionType.Project => await projects.CanViewProject(context.UserId, resourceId, cancellationToken),
            _ => false
        };
    }
}

public sealed record HubAuthorizationContext(Guid UserId, Guid SessionId, Guid TenantId);

public interface IHubSubscriptionAuthorizer
{
    Task<HubAuthorizationContext?> ValidateConnectionAsync(CancellationToken cancellationToken = default);
    Task<bool> CanSubscribeAsync(HubAuthorizationContext context, RealtimeSubscriptionType subscriptionType, Guid resourceId, CancellationToken cancellationToken = default);
}
