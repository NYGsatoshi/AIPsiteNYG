using AipPortal.Application.Common.Interfaces;
using AipPortal.Infrastructure.Files;
using AipPortal.Infrastructure.Audit;
using AipPortal.Infrastructure.Persistence;
using AipPortal.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace AipPortal.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");

        services.AddDbContext<AppDbContext>(options =>
            options.UseNpgsql(connectionString));

        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<ITenantRepository, TenantRepository>();
        services.AddScoped<AipPortal.Application.Admin.IAdminRepository, AdminRepository>();
        services.AddScoped<IInviteRepository, InviteRepository>();
        services.AddScoped<ISessionRepository, SessionRepository>();
        services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
        services.AddScoped<IGroupRepository, GroupRepository>();
        services.AddScoped<IChannelRepository, ChannelRepository>();
        services.AddScoped<IMessagingRepository, MessagingRepository>();
        services.AddScoped<IProjectRepository, ProjectRepository>();
        services.AddScoped<IEventRepository, EventRepository>();
        services.AddScoped<IFormRepository, FormRepository>();
        services.AddScoped<IFileRepository, FileRepository>();
        services.AddScoped<IArtifactRepository, ArtifactRepository>();
        services.AddScoped<IPlanningRepository, PlanningRepository>();
        services.AddScoped<IUiShellRepository, UiShellRepository>();
        services.AddScoped<IAnnouncementRepository, AnnouncementRepository>();
        services.AddScoped<IUnitOfWork, EfUnitOfWork>();
        services.Configure<FileStorageOptions>(options =>
        {
            var section = configuration.GetSection("FileStorage");
            options.RootPath = section["RootPath"] ?? string.Empty;
            if (long.TryParse(section["MaxFileSizeBytes"], out var maxFileSizeBytes))
            {
                options.MaxFileSizeBytes = maxFileSizeBytes;
            }

            options.AllowedExtensions = section.GetSection("AllowedExtensions")
                .GetChildren()
                .Select(item => item.Value)
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item!)
                .ToArray();
        });
        services.AddScoped<IFileStorageService, LocalFileStorageService>();
        services.AddScoped<IPasswordHasher, Pbkdf2PasswordHasher>();
        services.AddScoped<ITokenHasher, Sha256TokenHasher>();
        services.AddScoped<IAuditLogger, DbAuditLogger>();
        services.AddScoped<INotificationService, DbNotificationService>();
        services.AddScoped<AipPortal.Application.Search.ISearchService, DbSearchService>();
        services.AddScoped<AipPortal.Application.Audit.IAuditQueryService, DbAuditQueryService>();
        services.AddSingleton<IClock, SystemClock>();

        return services;
    }
}
