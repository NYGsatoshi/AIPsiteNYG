using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Tenancy;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using AipPortal.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.Persistence;

public sealed class AppDbContextSeedTests
{
    [Fact]
    public async Task DefaultTenantAndPlansAreIdempotent()
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetPlatformScope();
        await using var dbContext = CreateDbContext(currentTenant);
        var options = new TenancyOptions { DefaultTenantSlug = "default" };

        var firstTenant = await AppDbContextSeed.SeedDefaultTenantAsync(dbContext, options);
        await AppDbContextSeed.SeedPlansAsync(dbContext);
        var secondTenant = await AppDbContextSeed.SeedDefaultTenantAsync(dbContext, options);
        await AppDbContextSeed.SeedPlansAsync(dbContext);

        Assert.Equal(firstTenant.Id, secondTenant.Id);
        Assert.Equal(1, await dbContext.Tenants.CountAsync());
        Assert.Equal(4, await dbContext.Plans.CountAsync());
        Assert.Equal(4, await dbContext.Plans.Select(plan => plan.Name).Distinct().CountAsync());
    }

    [Fact]
    public async Task LocalAdminSeedIsIdempotentAndUpdatesExistingAdmin()
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetPlatformScope();
        await using var dbContext = CreateDbContext(currentTenant);
        var tenant = await AppDbContextSeed.SeedDefaultTenantAsync(dbContext, new TenancyOptions { DefaultTenantSlug = "default" });
        var passwordHasher = new Pbkdf2PasswordHasher();

        await AppDbContextSeed.SeedLocalAdminAsync(
            dbContext,
            passwordHasher,
            tenant.Id,
            "admin@example.com",
            "first-local-password",
            "Local Admin");

        await AppDbContextSeed.SeedLocalAdminAsync(
            dbContext,
            passwordHasher,
            tenant.Id,
            "admin@example.com",
            "second-local-password",
            "Updated Admin");

        var user = await dbContext.Users.SingleAsync();
        var passwordHashAfterPasswordChange = user.PasswordHash;
        var tenantUser = await dbContext.TenantUsers.SingleAsync();
        var workspace = await dbContext.Workspaces.SingleAsync();
        var workspaceMember = await dbContext.WorkspaceMembers.SingleAsync();

        Assert.Equal("Updated Admin", user.DisplayName);
        Assert.True(passwordHasher.VerifyPassword(user.PasswordHash, "second-local-password"));
        Assert.Equal(SystemRole.SystemAdmin, user.SystemRole);
        Assert.Equal(UserStatus.Active, user.Status);
        Assert.Equal(tenant.Id, tenantUser.TenantId);
        Assert.Equal(user.Id, tenantUser.UserId);
        Assert.Equal(TenantUserRole.Owner, tenantUser.Role);
        Assert.Equal(TenantUserStatus.Active, tenantUser.Status);
        Assert.Equal(tenant.Id, workspace.TenantId);
        Assert.Equal("default-workspace", workspace.Slug);
        Assert.Equal(WorkspaceStatus.Active, workspace.Status);
        Assert.Equal(tenant.Id, workspaceMember.TenantId);
        Assert.Equal(workspace.Id, workspaceMember.WorkspaceId);
        Assert.Equal(user.Id, workspaceMember.UserId);
        Assert.Equal(WorkspaceRole.Owner, workspaceMember.Role);
        Assert.Equal(MembershipStatus.Active, workspaceMember.Status);

        await AppDbContextSeed.SeedLocalAdminAsync(
            dbContext,
            passwordHasher,
            tenant.Id,
            "admin@example.com",
            "second-local-password",
            "Updated Admin");

        Assert.Equal(passwordHashAfterPasswordChange, user.PasswordHash);
    }

    [Fact]
    public async Task LocalAdminSeedPromotesExistingUserAndReusesTenantMembership()
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetPlatformScope();
        await using var dbContext = CreateDbContext(currentTenant);
        var tenant = await AppDbContextSeed.SeedDefaultTenantAsync(dbContext, new TenancyOptions { DefaultTenantSlug = "default" });
        var passwordHasher = new Pbkdf2PasswordHasher();

        var existingUser = new Domain.Entities.User
        {
            DisplayName = "Existing User",
            Email = "admin@example.com",
            NormalizedEmail = "ADMIN@EXAMPLE.COM",
            PasswordHash = passwordHasher.HashPassword("old-password"),
            SystemRole = SystemRole.User,
            Status = UserStatus.Suspended,
            FailedLoginAttempts = 3,
            LockoutEndAt = DateTimeOffset.UtcNow.AddHours(1),
            CreatedAt = DateTimeOffset.UtcNow
        };
        existingUser.MarkDeleted(DateTimeOffset.UtcNow);

        await dbContext.Users.AddAsync(existingUser);
        await dbContext.TenantUsers.AddAsync(new Domain.Entities.TenantUser
        {
            TenantId = tenant.Id,
            UserId = existingUser.Id,
            Role = TenantUserRole.Member,
            Status = TenantUserStatus.Invited,
            JoinedAt = default,
            CreatedAt = DateTimeOffset.UtcNow
        });
        await dbContext.SaveChangesAsync();

        await AppDbContextSeed.SeedLocalAdminAsync(
            dbContext,
            passwordHasher,
            tenant.Id,
            "admin@example.com",
            "new-password",
            "Seeded Admin");

        var user = await dbContext.Users.SingleAsync();
        var tenantUser = await dbContext.TenantUsers.SingleAsync();
        var workspaceMember = await dbContext.WorkspaceMembers.SingleAsync();

        Assert.Equal(existingUser.Id, user.Id);
        Assert.Equal("Seeded Admin", user.DisplayName);
        Assert.True(passwordHasher.VerifyPassword(user.PasswordHash, "new-password"));
        Assert.Equal(SystemRole.SystemAdmin, user.SystemRole);
        Assert.Equal(UserStatus.Active, user.Status);
        Assert.Equal(0, user.FailedLoginAttempts);
        Assert.Null(user.LockoutEndAt);
        Assert.False(user.IsDeleted);
        Assert.Equal(TenantUserRole.Owner, tenantUser.Role);
        Assert.Equal(TenantUserStatus.Active, tenantUser.Status);
        Assert.NotEqual(default, tenantUser.JoinedAt);
        Assert.Equal(user.Id, workspaceMember.UserId);
        Assert.Equal(WorkspaceRole.Owner, workspaceMember.Role);
        Assert.Equal(MembershipStatus.Active, workspaceMember.Status);
    }

    [Fact]
    public async Task BootstrapAdminPromotesExistingUserWithoutChangingPassword()
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetPlatformScope();
        await using var dbContext = CreateDbContext(currentTenant);
        var tenant = await AppDbContextSeed.SeedDefaultTenantAsync(dbContext, new TenancyOptions { DefaultTenantSlug = "default" });
        var passwordHasher = new Pbkdf2PasswordHasher();
        var existingHash = passwordHasher.HashPassword("existing-password");

        await dbContext.Users.AddAsync(new Domain.Entities.User
        {
            DisplayName = "Existing User",
            Email = "admin@example.com",
            NormalizedEmail = "ADMIN@EXAMPLE.COM",
            PasswordHash = existingHash,
            SystemRole = SystemRole.User,
            Status = UserStatus.Active,
            CreatedAt = DateTimeOffset.UtcNow
        });
        await dbContext.SaveChangesAsync();

        await AppDbContextSeed.EnsureBootstrapAdminAsync(
            dbContext,
            passwordHasher,
            tenant.Id,
            "admin@example.com");

        var user = await dbContext.Users.SingleAsync();
        var tenantUser = await dbContext.TenantUsers.SingleAsync();
        var workspaceMember = await dbContext.WorkspaceMembers.SingleAsync();

        Assert.Equal(existingHash, user.PasswordHash);
        Assert.Equal(SystemRole.SystemAdmin, user.SystemRole);
        Assert.Equal(TenantUserRole.Owner, tenantUser.Role);
        Assert.Equal(WorkspaceRole.Owner, workspaceMember.Role);
    }

    [Fact]
    public async Task BrowserSmokeSeedDelegatesWorkspaceCreateToTenantMemberIdempotently()
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetPlatformScope();
        await using var dbContext = CreateDbContext(currentTenant);
        var tenant = await AppDbContextSeed.SeedDefaultTenantAsync(
            dbContext,
            new TenancyOptions { DefaultTenantSlug = "default" });
        var passwordHasher = new Pbkdf2PasswordHasher();
        var storage = new MemoryFileStorage();

        await AppDbContextSeed.SeedBrowserSmokeAsync(
            dbContext,
            passwordHasher,
            storage,
            tenant.Id,
            "browser-smoke@example.test",
            "Browser-smoke-password!234");

        var actor = await dbContext.Users.SingleAsync(
            user => user.Email == "browser-smoke@example.test");
        var firstGrant = await dbContext.Set<CapabilityGrant>().SingleAsync(
            grant =>
                grant.TenantId == tenant.Id &&
                grant.SubjectUserId == actor.Id &&
                grant.CapabilityKey == CapabilityKeys.WorkspaceCreate);
        var firstGrantId = firstGrant.Id;
        var firstGrantedAt = firstGrant.GrantedAt;
        var firstTaskArtifact = await dbContext.Artifacts.SingleAsync(
            artifact => artifact.Name == "Browser Smoke Task Artifact");
        var firstTaskArtifactId = firstTaskArtifact.Id;
        var seededTask = await dbContext.TaskItems.SingleAsync(
            task => task.Title == "Browser smoke task");
        seededTask.IsBlocked = true;
        seededTask.BlockedReason = "Stale state from a prior browser run.";
        await dbContext.SaveChangesAsync();

        await AppDbContextSeed.SeedBrowserSmokeAsync(
            dbContext,
            passwordHasher,
            storage,
            tenant.Id,
            "browser-smoke@example.test",
            "Browser-smoke-password!234");

        var tenantMembership = await dbContext.TenantUsers.SingleAsync(
            membership => membership.TenantId == tenant.Id && membership.UserId == actor.Id);
        var grant = Assert.Single(await dbContext.Set<CapabilityGrant>()
            .Where(candidate =>
                candidate.TenantId == tenant.Id &&
                candidate.SubjectUserId == actor.Id &&
                candidate.CapabilityKey == CapabilityKeys.WorkspaceCreate)
            .ToListAsync());

        Assert.Equal(SystemRole.User, actor.SystemRole);
        Assert.Equal(TenantUserRole.Member, tenantMembership.Role);
        Assert.Equal(TenantUserStatus.Active, tenantMembership.Status);
        Assert.Equal(firstGrantId, grant.Id);
        Assert.Equal(firstGrantedAt, grant.GrantedAt);
        Assert.Equal(CapabilityScopeType.Tenant, grant.ScopeType);
        Assert.Equal(tenant.Id, grant.ScopeId);
        Assert.Equal(actor.Id, grant.GrantedByUserId);
        Assert.Null(grant.ExpiresAt);
        Assert.Null(grant.RevokedAt);

        var taskArtifact = Assert.Single(await dbContext.Artifacts
            .Where(artifact => artifact.Name == "Browser Smoke Task Artifact")
            .ToListAsync());
        Assert.Equal(firstTaskArtifactId, taskArtifact.Id);
        Assert.Equal(tenant.Id, taskArtifact.TenantId);
        Assert.NotNull(taskArtifact.TaskItemId);
        Assert.Equal(ArtifactType.Document, taskArtifact.ArtifactType);
        Assert.Equal(ArtifactStatus.Approved, taskArtifact.Status);
        Assert.False(taskArtifact.IsDeleted);
        var artifactTask = await dbContext.TaskItems.SingleAsync(task => task.Id == taskArtifact.TaskItemId);
        Assert.Equal(taskArtifact.ProjectId, artifactTask.ProjectId);
        Assert.False(artifactTask.IsBlocked);
        Assert.Null(artifactTask.BlockedReason);

        currentTenant.SetTenant(tenant.Id, tenant.Slug);
        var tenants = new TenantRepository(dbContext);
        var workspaces = new WorkspaceRepository(dbContext);
        var evaluator = new CapabilityGrantEvaluator(
            new CapabilityGrantRepository(dbContext),
            tenants,
            workspaces,
            currentTenant,
            new SystemClock());
        var authorization = new WorkspaceAuthorizationService(
            new UserRepository(dbContext),
            workspaces,
            new TenantAuthorizationService(tenants),
            evaluator);

        Assert.True(await authorization.CanCreateWorkspace(actor.Id, tenant.Id));
    }

    private static AppDbContext CreateDbContext(CurrentTenantService currentTenant)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new AppDbContext(options, currentTenant);
    }

    private sealed class MemoryFileStorage : IFileStorageService
    {
        public async Task<Result> SaveAsync(
            string storageKey,
            Stream stream,
            string contentType,
            CancellationToken cancellationToken = default)
        {
            await stream.CopyToAsync(Stream.Null, cancellationToken);
            return Result.Success();
        }

        public Task<Stream> OpenReadAsync(
            string storageKey,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<Stream>(Stream.Null);

        public Task DeleteAsync(
            string storageKey,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<bool> ExistsAsync(
            string storageKey,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(true);

        public Task<string?> CreateSignedReadUrlAsync(
            string storageKey,
            TimeSpan expiresIn,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<string?>(null);
    }
}
