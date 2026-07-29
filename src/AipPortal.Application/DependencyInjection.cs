using Microsoft.Extensions.DependencyInjection;
using AipPortal.Application.Admin;
using AipPortal.Application.Auth;
using AipPortal.Application.Announcements;
using AipPortal.Application.Artifacts;
using AipPortal.Application.Audit;
using AipPortal.Application.Channels;
using AipPortal.Application.Communication;
using AipPortal.Application.Events;
using AipPortal.Application.Files;
using AipPortal.Application.Forms;
using AipPortal.Application.Groups;
using AipPortal.Application.Integrations;
using AipPortal.Application.Messaging;
using AipPortal.Application.Notifications;
using AipPortal.Application.Planning;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Application.Search;
using AipPortal.Application.StudentRecords;
using AipPortal.Application.Tenancy;
using AipPortal.Application.TenantAdministration;
using AipPortal.Application.TenantExports;
using AipPortal.Application.UiShell;
using AipPortal.Application.Workspaces;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;

namespace AipPortal.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<CurrentTenantService>();
        services.AddScoped<ICurrentTenant>(provider => provider.GetRequiredService<CurrentTenantService>());
        services.AddScoped<ICurrentTenantAccessor>(provider => provider.GetRequiredService<CurrentTenantService>());
        services.AddScoped<ITenantAuthorizationService, TenantAuthorizationService>();
        services.AddScoped<ITenantService, TenantService>();
        services.AddScoped<ITenantExportService, TenantExportService>();
        services.AddScoped<IFeatureFlagService, FeatureFlagService>();
        services.AddScoped<IQuotaService, QuotaService>();
        services.AddScoped<ITenantAdministrationService, TenantAdministrationService>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IUserSessionService, UserSessionService>();
        services.AddScoped<IAuthorizationStateChangePublisher, AuthorizationStateChangePublisher>();
        services.AddScoped<IBusinessInvalidationPublisher, BusinessInvalidationPublisher>();
        services.AddScoped<IAdminService, AdminService>();
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
        services.AddScoped<IStudentRecordSchoolAccessContextProvider, WorkspaceSchoolAccessContextProvider>();
        services.AddScoped<IStudentRecordAuthorizationService, StudentRecordAuthorizationService>();
        services.AddScoped<INotificationApplicationService, NotificationApplicationService>();
        services.AddScoped<ICommunicationPollingService, CommunicationPollingService>();
        services.AddSingleton(new CommunicationSafetyOptions());
        services.AddSingleton<ICommunicationSafetyGuard, InMemoryCommunicationSafetyGuard>();
        services.AddScoped<IAnnouncementService, AnnouncementService>();
        services.AddScoped<IWorkspaceService, WorkspaceService>();
        services.AddScoped<IGroupService, GroupService>();
        services.AddScoped<IChannelService, ChannelService>();
        services.AddScoped<IConversationService, ConversationService>();
        services.AddScoped<IntegrationService>();
        services.AddScoped<IIntegrationService>(provider => provider.GetRequiredService<IntegrationService>());
        services.AddScoped<IApiTokenValidator>(provider => provider.GetRequiredService<IntegrationService>());
        services.AddScoped<IProjectService, ProjectService>();
        // Minimal hosts may register only IUnitOfWork after AddApplication. Reuse that
        // same scoped instance when it also supports the Task-specific save contract.
        // Full Infrastructure registration supplies a later explicit binding and wins.
        services.AddScoped<ITaskCommandUnitOfWork>(provider =>
            provider.GetRequiredService<IUnitOfWork>() as ITaskCommandUnitOfWork
            ?? throw new InvalidOperationException("IUnitOfWork must implement ITaskCommandUnitOfWork for Task commands."));
        services.AddScoped<ITaskCommandService, TaskCommandService>();
        services.AddScoped<IProjectKanbanService, ProjectKanbanService>();
        services.AddScoped<ITaskSubresourceService, TaskSubresourceService>();
        services.AddScoped<ITaskWorkspaceTimeZoneResolver, TaskWorkspaceTimeZoneResolver>();
        services.AddScoped<IEventService, EventService>();
        services.AddScoped<IFormService, FormService>();
        services.AddScoped<IFileService, FileService>();
        services.AddScoped<IFileObjectService>(provider => provider.GetRequiredService<IFileService>() as IFileObjectService
            ?? throw new InvalidOperationException("IFileService must be implemented by IFileObjectService."));
        services.AddScoped<IArtifactService, ArtifactService>();
        services.AddScoped<IPlanningService, PlanningService>();
        services.AddScoped<IUiShellService, UiShellService>();
        services.AddScoped<IStudentRecordService, StudentRecordService>();
        return services;
    }
}
