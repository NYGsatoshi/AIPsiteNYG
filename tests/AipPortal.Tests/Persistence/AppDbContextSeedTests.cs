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
        var tenantUser = await dbContext.TenantUsers.SingleAsync();

        Assert.Equal("Updated Admin", user.DisplayName);
        Assert.Equal(SystemRole.SystemAdmin, user.SystemRole);
        Assert.Equal(UserStatus.Active, user.Status);
        Assert.Equal(tenant.Id, tenantUser.TenantId);
        Assert.Equal(user.Id, tenantUser.UserId);
        Assert.Equal(TenantUserRole.Owner, tenantUser.Role);
        Assert.Equal(TenantUserStatus.Active, tenantUser.Status);
    }

    private static AppDbContext CreateDbContext(CurrentTenantService currentTenant)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new AppDbContext(options, currentTenant);
    }
}
