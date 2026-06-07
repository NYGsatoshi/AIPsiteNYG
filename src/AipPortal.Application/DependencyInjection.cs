using Microsoft.Extensions.DependencyInjection;
using AipPortal.Application.Auth;
using AipPortal.Application.Announcements;
using AipPortal.Application.Artifacts;
using AipPortal.Application.Audit;
using AipPortal.Application.Channels;
using AipPortal.Application.Events;
using AipPortal.Application.Files;
using AipPortal.Application.Forms;
using AipPortal.Application.Groups;
using AipPortal.Application.Messaging;
using AipPortal.Application.Notifications;
using AipPortal.Application.Planning;
using AipPortal.Application.Projects;
using AipPortal.Application.Search;
using AipPortal.Application.UiShell;
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
        services.AddScoped<IEventAuthorizationService, EventAuthorizationService>();
        services.AddScoped<IFormAuthorizationService, FormAuthorizationService>();
        services.AddScoped<IFileAuthorizationService, FileAuthorizationService>();
        services.AddScoped<IArtifactAuthorizationService, ArtifactAuthorizationService>();
        services.AddScoped<INotificationApplicationService, NotificationApplicationService>();
        services.AddScoped<IAnnouncementService, AnnouncementService>();
        services.AddScoped<IWorkspaceService, WorkspaceService>();
        services.AddScoped<IGroupService, GroupService>();
        services.AddScoped<IChannelService, ChannelService>();
        services.AddScoped<IConversationService, ConversationService>();
        services.AddScoped<IProjectService, ProjectService>();
        services.AddScoped<IEventService, EventService>();
        services.AddScoped<IFormService, FormService>();
        services.AddScoped<IFileService, FileService>();
        services.AddScoped<IArtifactService, ArtifactService>();
        services.AddScoped<IPlanningService, PlanningService>();
        services.AddScoped<IUiShellService, UiShellService>();
        return services;
    }
}
