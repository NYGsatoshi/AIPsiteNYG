using AipPortal.Application.Common.Tenancy;
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

        Assert.Equal("Updated Admin", user.DisplayName);
        Assert.True(passwordHasher.VerifyPassword(user.PasswordHash, "second-local-password"));
        Assert.Equal(SystemRole.SystemAdmin, user.SystemRole);
        Assert.Equal(UserStatus.Active, user.Status);
        Assert.Equal(tenant.Id, tenantUser.TenantId);
        Assert.Equal(user.Id, tenantUser.UserId);
        Assert.Equal(TenantUserRole.Owner, tenantUser.Role);
        Assert.Equal(TenantUserStatus.Active, tenantUser.Status);

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
    }

    private static AppDbContext CreateDbContext(CurrentTenantService currentTenant)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new AppDbContext(options, currentTenant);
    }
}
