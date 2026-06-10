using AipPortal.Application.Audit;
using AipPortal.Application.Auth;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Tenancy;
using AipPortal.Application.TenantAdministration;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Files;
using AipPortal.Infrastructure.Persistence;
using AipPortal.Web.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace AipPortal.Tests.Tenancy;

public sealed class TenantIsolationSecurityTests
{
    [Fact]
    public async Task TenantContextsReturnOnlyTheirOwnResourceGraph()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();

        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);
        await AssertOnlyTenantAsync(dbContext, data.TenantA.Id);
        Assert.Equal(data.WorkspaceA.Id, (await dbContext.Workspaces.SingleAsync()).Id);
        Assert.Equal(data.ProjectA.Id, (await dbContext.Projects.SingleAsync()).Id);
        Assert.Equal(data.TaskA.Id, (await dbContext.TaskItems.SingleAsync()).Id);
        Assert.Equal(data.FileA.Id, (await dbContext.FileObjects.SingleAsync()).Id);
        Assert.Equal(data.ConversationA.Id, (await dbContext.Conversations.SingleAsync()).Id);
        Assert.Equal(data.AnnouncementA.Id, (await dbContext.Announcements.SingleAsync()).Id);

        currentTenant.SetTenant(data.TenantB.Id, data.TenantB.Slug);
        await AssertOnlyTenantAsync(dbContext, data.TenantB.Id);
        Assert.Equal(data.WorkspaceB.Id, (await dbContext.Workspaces.SingleAsync()).Id);
        Assert.Equal(data.ProjectB.Id, (await dbContext.Projects.SingleAsync()).Id);
        Assert.Equal(data.TaskB.Id, (await dbContext.TaskItems.SingleAsync()).Id);
        Assert.Equal(data.FileB.Id, (await dbContext.FileObjects.SingleAsync()).Id);
        Assert.Equal(data.ConversationB.Id, (await dbContext.Conversations.SingleAsync()).Id);
        Assert.Equal(data.AnnouncementB.Id, (await dbContext.Announcements.SingleAsync()).Id);
    }

    [Fact]
    public async Task TenantAContextCannotQueryTenantBRecordsById()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();

        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);

        Assert.Null(await dbContext.Workspaces.FirstOrDefaultAsync(workspace => workspace.Id == data.WorkspaceB.Id));
        Assert.Null(await dbContext.Groups.FirstOrDefaultAsync(group => group.Id == data.GroupB.Id));
        Assert.Null(await dbContext.Projects.FirstOrDefaultAsync(project => project.Id == data.ProjectB.Id));
        Assert.Null(await dbContext.TaskItems.FirstOrDefaultAsync(task => task.Id == data.TaskB.Id));
        Assert.Null(await dbContext.FileObjects.FirstOrDefaultAsync(file => file.Id == data.FileB.Id));
        Assert.Null(await dbContext.Conversations.FirstOrDefaultAsync(conversation => conversation.Id == data.ConversationB.Id));
        Assert.Null(await dbContext.Announcements.FirstOrDefaultAsync(announcement => announcement.Id == data.AnnouncementB.Id));
    }

    [Fact]
    public async Task NormalTenantScopeExcludesOtherTenantNotificationsAuditAndSecurityEvents()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();

        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);

        Assert.All(await dbContext.Notifications.ToListAsync(), notification => Assert.Equal(data.TenantA.Id, notification.TenantId));
        Assert.All(await dbContext.AuditLogs.ToListAsync(), log => Assert.Equal(data.TenantA.Id, log.TenantId));
        Assert.All(await dbContext.SecurityEvents.ToListAsync(), item => Assert.Equal(data.TenantA.Id, item.TenantId));
    }

    [Fact]
    public async Task CreatingTenantEntityStampsCurrentTenantAndMismatchedUpdateIsRejected()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();
        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);

        var workspace = new Workspace
        {
            Name = "Stamped",
            Slug = "stamped",
            CreatedByUserId = data.TenantAOwner.Id
        };

        dbContext.Workspaces.Add(workspace);
        await dbContext.SaveChangesAsync();
        Assert.Equal(data.TenantA.Id, workspace.TenantId);

        workspace.TenantId = data.TenantB.Id;
        await Assert.ThrowsAsync<InvalidOperationException>(() => dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task PlatformScopeMustSetTenantIdExplicitlyForTenantOwnedData()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();
        currentTenant.SetPlatformScope();

        dbContext.Workspaces.Add(new Workspace
        {
            Name = "Missing tenant",
            Slug = "missing-tenant",
            CreatedByUserId = data.PlatformAdmin.Id
        });

        await Assert.ThrowsAsync<InvalidOperationException>(() => dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task SuspendedTenantContextCannotSaveTenantOwnedWritesAfterResolution()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();

        currentTenant.SetPlatformScope();
        data.TenantA.Status = TenantStatus.Suspended;
        await dbContext.SaveChangesAsync();

        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);
        dbContext.Workspaces.Add(new Workspace
        {
            Name = "Blocked",
            Slug = "blocked",
            CreatedByUserId = data.TenantAOwner.Id
        });

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => dbContext.SaveChangesAsync());
        Assert.Contains("not active", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ActiveTenantContextCanStillSaveTenantOwnedWrites()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();

        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);
        var workspace = new Workspace
        {
            Name = "Allowed",
            Slug = "allowed",
            CreatedByUserId = data.TenantAOwner.Id
        };
        dbContext.Workspaces.Add(workspace);

        await dbContext.SaveChangesAsync();

        Assert.Equal(data.TenantA.Id, workspace.TenantId);
    }

    [Fact]
    public async Task TenantSwitchingRequiresActiveMembershipAndEnabledMode()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();

        var crossTenantService = CreateTenantService(dbContext, currentTenant, data.CrossTenantUser, new TenancyOptions { AllowTenantSwitching = true });
        Assert.True((await crossTenantService.SwitchTenantAsync(data.TenantA.Id)).IsSuccess);
        Assert.True((await crossTenantService.SwitchTenantAsync(data.TenantB.Id)).IsSuccess);

        var tenantAMemberService = CreateTenantService(dbContext, currentTenant, data.TenantAMember, new TenancyOptions { AllowTenantSwitching = true });
        var tenantAToB = await tenantAMemberService.SwitchTenantAsync(data.TenantB.Id);
        Assert.False(tenantAToB.IsSuccess);
        Assert.Equal("Tenant membership is required.", tenantAToB.Error);

        var outsiderService = CreateTenantService(dbContext, currentTenant, data.Outsider, new TenancyOptions { AllowTenantSwitching = true });
        var outsiderToA = await outsiderService.SwitchTenantAsync(data.TenantA.Id);
        Assert.False(outsiderToA.IsSuccess);
        Assert.Equal("Tenant membership is required.", outsiderToA.Error);

        var onPremService = CreateTenantService(dbContext, currentTenant, data.CrossTenantUser, new TenancyOptions { AppMode = AppMode.OnPremSingleTenant, AllowTenantSwitching = true });
        Assert.Equal("Tenant switching is disabled.", (await onPremService.SwitchTenantAsync(data.TenantA.Id)).Error);
    }

    [Fact]
    public async Task SuspendedTenantCannotBeResolvedOrSwitchedInto()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();
        var httpContextAccessor = new HttpContextAccessor { HttpContext = new DefaultHttpContext() };
        httpContextAccessor.HttpContext.Request.Headers["X-Tenant-Slug"] = data.SuspendedTenant.Slug;
        var resolver = new HttpTenantResolver(
            httpContextAccessor,
            new FakeWebHostEnvironment(Environments.Development),
            Options.Create(new TenancyOptions
            {
                TenantResolutionStrategy = TenantResolutionStrategy.HeaderForDevelopmentOnly,
                AllowDevelopmentHeaderTenantResolution = true
            }),
            dbContext);

        var resolved = await resolver.ResolveAsync();
        Assert.False(resolved.IsResolved);
        Assert.Contains("Suspended", resolved.FailureReason, StringComparison.OrdinalIgnoreCase);

        var service = CreateTenantService(dbContext, currentTenant, data.SuspendedTenantUser, new TenancyOptions { AllowTenantSwitching = true });
        var switched = await service.SwitchTenantAsync(data.SuspendedTenant.Id);
        Assert.False(switched.IsSuccess);
        Assert.Equal("Tenant is not available.", switched.Error);
    }

    [Fact]
    public async Task PlatformAdminCanSuspendAndActivateTenantsAndActionsAreAudited()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();
        var audit = new CapturingAuditLogger();
        var service = CreateTenantService(dbContext, currentTenant, data.PlatformAdmin, new TenancyOptions(), audit);

        Assert.True((await service.ListPlatformTenantsAsync()).IsSuccess);
        Assert.True((await service.SuspendTenantAsync(data.TenantB.Id)).IsSuccess);
        Assert.Equal(TenantStatus.Suspended, (await dbContext.Tenants.FindAsync(data.TenantB.Id))!.Status);
        Assert.True((await service.ActivateTenantAsync(data.TenantB.Id)).IsSuccess);
        Assert.Equal(TenantStatus.Active, (await dbContext.Tenants.FindAsync(data.TenantB.Id))!.Status);
        Assert.Contains(audit.Entries, entry => entry.Action == "TenantSuspended" && entry.TenantId == data.TenantB.Id);
        Assert.Contains(audit.Entries, entry => entry.Action == "TenantActivated" && entry.TenantId == data.TenantB.Id);
    }

    [Fact]
    public async Task PlatformAdminDoesNotBypassTenantFiltersOnNormalTenantScope()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();

        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);
        var visible = await dbContext.Workspaces.AsNoTracking().ToListAsync();

        Assert.Single(visible);
        Assert.Equal(data.WorkspaceA.Id, visible[0].Id);
    }

    [Fact]
    public async Task TenantAdminAuditQuerySeesOnlyCurrentTenantLogs()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();
        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);
        var service = new DbAuditQueryService(
            dbContext,
            new TestCurrentUser(data.TenantAAdmin),
            currentTenant,
            new TenantRepository(dbContext),
            new WorkspaceAuthorizationService(new UserRepository(dbContext), new WorkspaceRepository(dbContext)));

        var result = await service.ListAuditLogsAsync(new AuditLogQuery(Page: 1, PageSize: 20));

        Assert.True(result.IsSuccess);
        var items = result.Value!.Items;
        Assert.Single(items);
        Assert.Equal(data.WorkspaceA.Id, items[0].WorkspaceId);
    }

    [Fact]
    public async Task TenantFeatureOverridesAndQuotaLimitsStayTenantScoped()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();
        var plans = new TenantPlanRepository(dbContext);
        var quota = new QuotaService(plans);

        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);
        var tenantAFeatures = new FeatureFlagService(plans, currentTenant);
        Assert.False(await tenantAFeatures.IsEnabledAsync(FeatureKeys.ProductionTracking));
        Assert.False(await tenantAFeatures.IsEnabledAsync(FeatureKeys.FileSharing));
        Assert.False((await quota.CanCreateProjectAsync(data.TenantA.Id)).IsSuccess);
        Assert.False((await quota.CanUploadFileAsync(data.TenantA.Id, 55)).IsSuccess);
        Assert.False((await quota.CanUploadFileAsync(data.TenantA.Id, 95)).IsSuccess);

        currentTenant.SetTenant(data.TenantB.Id, data.TenantB.Slug);
        var tenantBFeatures = new FeatureFlagService(plans, currentTenant);
        Assert.True(await tenantBFeatures.IsEnabledAsync(FeatureKeys.ProductionTracking));
        Assert.True(await tenantBFeatures.IsEnabledAsync(FeatureKeys.FileSharing));
        Assert.True((await quota.CanCreateProjectAsync(data.TenantB.Id)).IsSuccess);
        Assert.True((await quota.CanUploadFileAsync(data.TenantB.Id, 55)).IsSuccess);
    }

    [Fact]
    public async Task FileMetadataUsesTenantNamespacedStorageKeysAndSignedUrlsAreNotExposedByLocalStorage()
    {
        var (dbContext, currentTenant, data) = await CreateSeededContextAsync();
        currentTenant.SetTenant(data.TenantA.Id, data.TenantA.Slug);

        var file = await dbContext.FileObjects.SingleAsync();
        Assert.StartsWith($"tenants/{data.TenantA.Id:D}/", file.StorageKey, StringComparison.Ordinal);

        var storage = new LocalFileStorageService(Options.Create(new FileStorageOptions
        {
            RootPath = Path.Combine(Path.GetTempPath(), "aip-tenant-isolation", Guid.NewGuid().ToString("N")),
            MaxFileSizeBytes = 1024,
            AllowedExtensions = [".txt"],
            AllowedContentTypes = ["text/plain"]
        }));
        Assert.Null(await storage.CreateSignedReadUrlAsync(file.StorageKey, TimeSpan.FromMinutes(5)));
    }

    private static async Task AssertOnlyTenantAsync(AppDbContext dbContext, Guid tenantId)
    {
        Assert.All(await dbContext.Workspaces.ToListAsync(), item => Assert.Equal(tenantId, item.TenantId));
        Assert.All(await dbContext.Groups.ToListAsync(), item => Assert.Equal(tenantId, item.TenantId));
        Assert.All(await dbContext.Projects.ToListAsync(), item => Assert.Equal(tenantId, item.TenantId));
        Assert.All(await dbContext.TaskItems.ToListAsync(), item => Assert.Equal(tenantId, item.TenantId));
        Assert.All(await dbContext.FileObjects.ToListAsync(), item => Assert.Equal(tenantId, item.TenantId));
        Assert.All(await dbContext.Conversations.ToListAsync(), item => Assert.Equal(tenantId, item.TenantId));
        Assert.All(await dbContext.Announcements.ToListAsync(), item => Assert.Equal(tenantId, item.TenantId));
        Assert.All(await dbContext.Notifications.ToListAsync(), item => Assert.Equal(tenantId, item.TenantId));
        Assert.All(await dbContext.AuditLogs.ToListAsync(), item => Assert.Equal(tenantId, item.TenantId));
    }

    private static async Task<(AppDbContext DbContext, CurrentTenantService CurrentTenant, TenantIsolationTestData Data)> CreateSeededContextAsync()
    {
        var currentTenant = new CurrentTenantService();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var dbContext = new AppDbContext(options, currentTenant);
        var data = await TenantIsolationTestData.SeedAsync(dbContext, currentTenant);
        return (dbContext, currentTenant, data);
    }

    private static TenantService CreateTenantService(
        AppDbContext dbContext,
        ICurrentTenant currentTenant,
        User user,
        TenancyOptions options,
        IAuditLogger? auditLogger = null)
    {
        var repository = new TenantRepository(dbContext);
        return new TenantService(
            repository,
            new TenantAuthorizationService(repository),
            currentTenant,
            new TestCurrentUser(user),
            auditLogger ?? new CapturingAuditLogger(),
            new EfUnitOfWork(dbContext),
            new FakeUserSessionService(),
            options);
    }

    private sealed class TestCurrentUser(User user) : ICurrentUser
    {
        public Guid? UserId => user.Id;
        public Guid? SessionId => Guid.NewGuid();
        public string? Email => user.Email;
        public SystemRole? SystemRole => user.SystemRole;
        public bool IsAuthenticated => true;
    }

    private sealed class CapturingAuditLogger : IAuditLogger
    {
        public List<AuditLogEntry> Entries { get; } = [];

        public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default)
        {
            Entries.Add(entry);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeUserSessionService : IUserSessionService
    {
        public Task<SessionValidationResult> ValidateSessionAsync(Guid userId, Guid sessionId, Guid? tenantId, bool requireActiveTenantMembership, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(SessionValidationResult.Success());
        }

        public Task<Result> RevokeSessionAsync(Guid sessionId, Guid? actorUserId, string reason, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result.Success());
        }

        public Task<Result<int>> RevokeUserSessionsAsync(Guid userId, Guid? actorUserId, string reason, Guid? exceptSessionId = null, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result<int>.Success(0));
        }
    }

    private sealed class FakeWebHostEnvironment(string environmentName) : IWebHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;
        public string ApplicationName { get; set; } = "AipPortal.Tests";
        public string WebRootPath { get; set; } = string.Empty;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
