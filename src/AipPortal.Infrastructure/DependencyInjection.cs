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
        services.AddScoped<ITenantExportRepository, TenantExportRepository>();
        services.AddScoped<IIntegrationRepository, IntegrationRepository>();
        services.AddScoped<AipPortal.Application.Admin.IAdminRepository, AdminRepository>();
        services.AddScoped<IInviteRepository, InviteRepository>();
        services.AddScoped<ISessionRepository, SessionRepository>();
        services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
        services.AddScoped<IGroupRepository, GroupRepository>();
        services.AddScoped<IChannelRepository, ChannelRepository>();
        services.AddScoped<IMessagingRepository, MessagingRepository>();
        services.AddScoped<IProjectRepository, ProjectRepository>();
        services.AddScoped<IEventRepository, EventRepository>();
        services.AddScoped<IStudentRecordRepository, StudentRecordRepository>();
        services.AddScoped<IFormRepository, FormRepository>();
        services.AddScoped<IFileRepository, FileRepository>();
        services.AddScoped<ITenantPlanRepository, TenantPlanRepository>();
        services.AddScoped<IArtifactRepository, ArtifactRepository>();
        services.AddScoped<IPlanningRepository, PlanningRepository>();
        services.AddScoped<IUiShellRepository, UiShellRepository>();
        services.AddScoped<IAnnouncementRepository, AnnouncementRepository>();
        services.AddScoped<IUnitOfWork, EfUnitOfWork>();
        services.Configure<FileStorageOptions>(options =>
        {
            var section = configuration.GetSection("FileStorage");
            options.Provider = section["Provider"] ?? "LocalFileSystem";
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
            options.AllowedContentTypes = section.GetSection("AllowedContentTypes")
                .GetChildren()
                .Select(item => item.Value)
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item!)
                .ToArray();
            options.UseSignedUrls = bool.TryParse(section["UseSignedUrls"], out var useSignedUrls) && useSignedUrls;
            options.BucketName = section["BucketName"];
            options.Region = section["Region"];
            options.Endpoint = section["Endpoint"];
            options.UsePathStyle = bool.TryParse(section["UsePathStyle"], out var usePathStyle) && usePathStyle;
            options.AccessKey = section["AccessKey"];
            options.SecretKey = section["SecretKey"];
        });
        services.AddScoped<IFileUploadPolicy, ConfiguredFileUploadPolicy>();
        services.AddScoped<IFileStorageService>(provider =>
        {
            var options = provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<FileStorageOptions>>().Value;
            return options.Provider switch
            {
                "LocalFileSystem" => provider.GetRequiredService<LocalFileStorageService>(),
                "ObjectStorage" or "S3Compatible" or "OCIObjectStorage" => provider.GetRequiredService<UnsupportedObjectStorageService>(),
                _ => throw new InvalidOperationException($"Unsupported FileStorage:Provider '{options.Provider}'.")
            };
        });
        services.AddScoped<LocalFileStorageService>();
        services.AddScoped<UnsupportedObjectStorageService>();
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
