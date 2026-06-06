using Microsoft.Extensions.DependencyInjection;
using AipPortal.Application.Auth;
using AipPortal.Application.Channels;
using AipPortal.Application.Groups;
using AipPortal.Application.Messaging;
using AipPortal.Application.Projects;
using AipPortal.Application.Workspaces;

namespace AipPortal.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IWorkspaceAuthorizationService, WorkspaceAuthorizationService>();
        services.AddScoped<IGroupAuthorizationService, GroupAuthorizationService>();
        services.AddScoped<IChannelAuthorizationService, ChannelAuthorizationService>();
        services.AddScoped<IConversationAuthorizationService, ConversationAuthorizationService>();
        services.AddScoped<ProjectAuthorizationService>();
        services.AddScoped<IProjectAuthorizationService>(provider => provider.GetRequiredService<ProjectAuthorizationService>());
        services.AddScoped<ITaskAuthorizationService>(provider => provider.GetRequiredService<ProjectAuthorizationService>());
        services.AddScoped<ICommentAuthorizationService>(provider => provider.GetRequiredService<ProjectAuthorizationService>());
        services.AddScoped<IWorkspaceService, WorkspaceService>();
        services.AddScoped<IGroupService, GroupService>();
        services.AddScoped<IChannelService, ChannelService>();
        services.AddScoped<IConversationService, ConversationService>();
        services.AddScoped<IProjectService, ProjectService>();
        return services;
    }
}
