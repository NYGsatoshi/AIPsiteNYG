using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using AipPortal.Application;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Audit;
using AipPortal.Infrastructure.Files;
using AipPortal.Infrastructure.Persistence;
using AipPortal.Infrastructure.Security;
using AipPortal.Web.Controllers;
using AipPortal.Web.Extensions;
using AipPortal.Web.Middleware;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AipPortal.Tests.Tenancy;

public sealed class HttpTenantIsolationTests
{
    [Fact]
    public async Task AuthenticatedHttpRequestsStayTenantScopedAcrossCoreWorkflows()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, "/api/tenants/current", data.TenantA.Slug, data.TenantB.Slug);
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, "/api/workspaces", "WorkspaceA", "WorkspaceB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceA.Id}", "WorkspaceA", "WorkspaceB");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceB.Id}");

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceA.Id}/groups", "GroupA", "GroupB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/groups/{data.GroupA.Id}", "GroupA", "GroupB");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/groups/{data.GroupB.Id}");

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, "/api/projects?archived=false", "ProjectA", "ProjectB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/projects/{data.ProjectA.Id}", "ProjectA", "ProjectB");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/projects/{data.ProjectB.Id}");

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/projects/{data.ProjectA.Id}/tasks", "TaskA", "TaskB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id}", "TaskA", "TaskB");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/tasks/{data.TaskB.Id}");

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, "/api/conversations", "ConversationA", "ConversationB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}", "ConversationA", "ConversationB");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationB.Id}");

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileA.Id}", data.FileA.OriginalFileName, data.FileB.OriginalFileName);
        await AssertStatusAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileA.Id}/download", HttpStatusCode.OK);
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileB.Id}");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileB.Id}/download");
    }

    [Fact]
    public async Task FileMetadataAndDeniedResponsesDoNotExposeStorageIdentifiers()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        var allowedMetadata = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileA.Id}");
        var allowedBody = await allowedMetadata.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, allowedMetadata.StatusCode);
        Assert.Contains(data.FileA.OriginalFileName, allowedBody, StringComparison.Ordinal);
        Assert.DoesNotContain("storageKey", allowedBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("storedFileName", allowedBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(data.FileA.StorageKey, allowedBody, StringComparison.Ordinal);

        var deniedMetadata = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileB.Id}");
        var deniedMetadataBody = await deniedMetadata.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedMetadata.StatusCode);
        Assert.DoesNotContain(data.FileB.OriginalFileName, deniedMetadataBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.FileB.StorageKey, deniedMetadataBody, StringComparison.Ordinal);

        var deniedDownload = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileB.Id}/download");
        var deniedDownloadBody = await deniedDownload.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedDownload.StatusCode);
        Assert.DoesNotContain(data.FileB.OriginalFileName, deniedDownloadBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.FileB.StorageKey, deniedDownloadBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FileDownloadResponsesUsePrivateCacheHeaders()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        var response = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileA.Id}/download");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains(response.Headers.Pragma, value => string.Equals(value.Name, "no-cache", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task UploadSanitizesOriginalFileNameAndDoesNotReturnStorageIdentifiers()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var content = new MultipartFormDataContent
        {
            { new StringContent(AttachmentOwnerType.TaskItem.ToString()), "OwnerType" },
            { new StringContent(data.TaskB.Id.ToString("D")), "OwnerId" }
        };
        var file = new ByteArrayContent("hello"u8.ToArray());
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/plain");
        content.Add(file, "File", @"..\secret.txt");

        var response = await app.SendAsync(data.TenantBMember, data.TenantB.Slug, "/api/files", HttpMethod.Post, content);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("secret.txt", body, StringComparison.Ordinal);
        Assert.DoesNotContain("..", body, StringComparison.Ordinal);
        Assert.DoesNotContain("storageKey", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("storedFileName", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain($"tenants/{data.TenantB.Id:D}", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AuthenticatedHttpNotificationsStayUserAndTenantScoped()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        await AssertOkContainsOnlyAsync(app, data.TenantAMember, data.TenantA.Slug, "/api/notifications?page=1&pageSize=20", "TenantA notification", "TenantB notification");
        await AssertOkContainsOnlyAsync(app, data.TenantBMember, data.TenantB.Slug, "/api/notifications?page=1&pageSize=20", "TenantB notification", "TenantA notification");
        await AssertBadRequestAsync(app, data.TenantAMember, data.TenantA.Slug, $"/api/notifications/{data.NotificationB.Id}/read", HttpMethod.Patch);
    }

    [Fact]
    public async Task TenantHeaderDoesNotGrantAccessWithoutResourceMembership()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        await AssertOkContainsOnlyAsync(app, data.Outsider, data.TenantA.Slug, "/api/workspaces", "", "WorkspaceA");
        await AssertBadRequestAsync(app, data.Outsider, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceA.Id}");
        await AssertBadRequestAsync(app, data.Outsider, data.TenantA.Slug, $"/api/projects/{data.ProjectA.Id}");
        await AssertBadRequestAsync(app, data.Outsider, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}");
        await AssertBadRequestAsync(app, data.Outsider, data.TenantA.Slug, $"/api/files/{data.FileA.Id}/download");
    }

    [Fact]
    public async Task MissingAuthenticationIsRejectedBeforeTenantDataIsReturned()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/workspaces");
        request.Headers.TryAddWithoutValidation("X-Tenant-Slug", app.Data.TenantA.Slug);
        var response = await app.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private static async Task AssertOkContainsOnlyAsync(
        HttpTenantIsolationTestApp app,
        User user,
        string tenantSlug,
        string path,
        string expected,
        string unexpected)
    {
        var response = await app.SendAsync(user, tenantSlug, path);
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(response.StatusCode == HttpStatusCode.OK, $"Expected OK from {path}, got {response.StatusCode}: {body}");
        if (!string.IsNullOrEmpty(expected))
        {
            Assert.Contains(expected, body, StringComparison.Ordinal);
        }

        Assert.DoesNotContain(unexpected, body, StringComparison.Ordinal);
    }

    private static Task AssertBadRequestAsync(
        HttpTenantIsolationTestApp app,
        User user,
        string tenantSlug,
        string path,
        HttpMethod? method = null)
    {
        return AssertStatusAsync(app, user, tenantSlug, path, HttpStatusCode.BadRequest, method);
    }

    private static async Task AssertStatusAsync(
        HttpTenantIsolationTestApp app,
        User user,
        string tenantSlug,
        string path,
        HttpStatusCode expectedStatus,
        HttpMethod? method = null)
    {
        var response = await app.SendAsync(user, tenantSlug, path, method);
        Assert.Equal(expectedStatus, response.StatusCode);
    }

    private sealed class HttpTenantIsolationTestApp : IAsyncDisposable
    {
        private HttpTenantIsolationTestApp(WebApplication app, HttpClient client, TenantIsolationTestData data)
        {
            App = app;
            Client = client;
            Data = data;
        }

        private WebApplication App { get; }
        public HttpClient Client { get; }
        public TenantIsolationTestData Data { get; }

        public static async Task<HttpTenantIsolationTestApp> CreateAsync()
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = Environments.Development
            });
            builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Tenancy:AppMode"] = "SaaS",
                ["Tenancy:TenantResolutionStrategy"] = "HeaderForDevelopmentOnly",
                ["Tenancy:AllowDevelopmentHeaderTenantResolution"] = "true",
                ["Tenancy:AllowDevelopmentHeaderInProduction"] = "false",
                ["Tenancy:DevelopmentTenantHeaderName"] = "X-Tenant-Slug",
                ["Security:CookieSecurePolicy"] = "SameAsRequest",
                ["Security:RequireHttps"] = "false",
                ["Security:EnableHsts"] = "false",
                ["Security:EnableCsrfProtection"] = "false",
                ["Security:EnableRateLimiting"] = "false",
                ["FileStorage:Provider"] = "LocalFileSystem",
                ["FileStorage:RootPath"] = Path.Combine(Path.GetTempPath(), "aip-http-tenant-tests", Guid.NewGuid().ToString("N")),
                ["FileStorage:MaxFileSizeBytes"] = "10485760",
                ["FileStorage:AllowedExtensions:0"] = ".txt",
                ["FileStorage:AllowedContentTypes:0"] = "text/plain"
            });

            builder.Services
                .AddApplication()
                .AddWebServices(builder.Configuration);
            builder.Services.AddControllers().AddApplicationPart(typeof(WorkspacesController).Assembly);
            builder.Services
                .AddAuthentication(TestAuthHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { });
            builder.Services.AddAuthorization();
            var databaseName = Guid.NewGuid().ToString("N");
            builder.Services.AddDbContext<AppDbContext>(options =>
                options.UseInMemoryDatabase(databaseName));
            AddInfrastructureLikeServices(builder.Services, builder.Configuration);

            var app = builder.Build();
            app.UseMiddleware<TenantResolutionMiddleware>();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();

            await app.StartAsync();

            TenantIsolationTestData data;
            await using (var scope = app.Services.CreateAsyncScope())
            {
                var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
                data = await TenantIsolationTestData.SeedAsync(dbContext, currentTenant);
            }

            var addresses = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()?.Addresses;
            var address = addresses?.Single() ?? throw new InvalidOperationException("Test server address was not available.");
            return new HttpTenantIsolationTestApp(app, new HttpClient { BaseAddress = new Uri(address) }, data);
        }

        public Task<HttpResponseMessage> SendAsync(User user, string tenantSlug, string path, HttpMethod? method = null, HttpContent? content = null)
        {
            var request = new HttpRequestMessage(method ?? HttpMethod.Get, path);
            request.Headers.TryAddWithoutValidation("X-Test-User-Id", user.Id.ToString("D"));
            request.Headers.TryAddWithoutValidation("X-Test-Email", user.Email);
            request.Headers.TryAddWithoutValidation("X-Test-System-Role", user.SystemRole.ToString());
            request.Headers.TryAddWithoutValidation("X-Tenant-Slug", tenantSlug);
            request.Content = content;
            return Client.SendAsync(request);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await App.DisposeAsync();
        }

        private static void AddInfrastructureLikeServices(IServiceCollection services, IConfiguration configuration)
        {
            services.Configure<FileStorageOptions>(configuration.GetSection("FileStorage"));
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
            services.AddScoped<IFormRepository, FormRepository>();
            services.AddScoped<IFileRepository, FileRepository>();
            services.AddScoped<ITenantPlanRepository, TenantPlanRepository>();
            services.AddScoped<IArtifactRepository, ArtifactRepository>();
            services.AddScoped<IPlanningRepository, PlanningRepository>();
            services.AddScoped<IUiShellRepository, UiShellRepository>();
            services.AddScoped<IAnnouncementRepository, AnnouncementRepository>();
            services.AddScoped<IUnitOfWork, EfUnitOfWork>();
            services.AddScoped<IFileUploadPolicy, ConfiguredFileUploadPolicy>();
            services.AddScoped<IFileStorageService, InMemoryFileStorageService>();
            services.AddScoped<IPasswordHasher, Pbkdf2PasswordHasher>();
            services.AddScoped<ITokenHasher, Sha256TokenHasher>();
            services.AddScoped<IAuditLogger, DbAuditLogger>();
            services.AddScoped<INotificationService, DbNotificationService>();
            services.AddScoped<AipPortal.Application.Search.ISearchService, DbSearchService>();
            services.AddScoped<AipPortal.Application.Audit.IAuditQueryService, DbAuditQueryService>();
            services.AddSingleton<IClock, AipPortal.Infrastructure.Security.SystemClock>();
        }
    }

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string SchemeName = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-User-Id", out var userId) ||
                !Guid.TryParse(userId.ToString(), out var parsedUserId))
            {
                return Task.FromResult(AuthenticateResult.NoResult());
            }

            var email = Request.Headers.TryGetValue("X-Test-Email", out var emailHeader)
                ? emailHeader.ToString()
                : "test@example.test";
            var systemRole = Request.Headers.TryGetValue("X-Test-System-Role", out var roleHeader)
                ? roleHeader.ToString()
                : SystemRole.User.ToString();

            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, parsedUserId.ToString("D")),
                new(ClaimTypes.Email, email),
                new("system_role", systemRole),
                new(ClaimTypes.Role, systemRole)
            };
            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }

    private sealed class InMemoryFileStorageService : IFileStorageService
    {
        private readonly Dictionary<string, byte[]> files = new(StringComparer.Ordinal);

        public async Task<Result> SaveAsync(string storageKey, Stream stream, string contentType, CancellationToken cancellationToken = default)
        {
            using var memory = new MemoryStream();
            await stream.CopyToAsync(memory, cancellationToken);
            files[storageKey] = memory.ToArray();
            return Result.Success();
        }

        public Task<Stream> OpenReadAsync(string storageKey, CancellationToken cancellationToken = default)
        {
            files.TryGetValue(storageKey, out var bytes);
            return Task.FromResult<Stream>(new MemoryStream(bytes ?? "test file"u8.ToArray()));
        }

        public Task DeleteAsync(string storageKey, CancellationToken cancellationToken = default)
        {
            files.Remove(storageKey);
            return Task.CompletedTask;
        }

        public Task<bool> ExistsAsync(string storageKey, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(true);
        }

        public Task<string?> CreateSignedReadUrlAsync(string storageKey, TimeSpan expiresIn, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<string?>(null);
        }
    }
}
