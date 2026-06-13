using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.PostgreSql;

public sealed class PostgreSqlIntegrationTests
{
    private const string ConnectionStringEnvironmentVariable = "POSTGRES_TEST_CONNECTION_STRING";

    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task MigrationsAndTenantScopedRepositoriesWorkAgainstPostgreSql()
    {
        var connectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return;
        }

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        var currentTenant = new CurrentTenantService();
        var runId = Guid.NewGuid().ToString("N");

        await using var dbContext = new AppDbContext(options, currentTenant);
        var pendingMigrations = await dbContext.Database.GetPendingMigrationsAsync();
        Assert.Empty(pendingMigrations);

        var tenantA = new Tenant { Name = $"CI Tenant A {runId}", DisplayName = "CI Tenant A", Slug = $"ci-a-{runId}" };
        var tenantB = new Tenant { Name = $"CI Tenant B {runId}", DisplayName = "CI Tenant B", Slug = $"ci-b-{runId}" };
        var user = new User
        {
            DisplayName = "CI PostgreSQL User",
            Email = $"ci-{runId}@example.test",
            NormalizedEmail = $"CI-{runId}@EXAMPLE.TEST"
        };

        currentTenant.SetPlatformScope();
        await dbContext.Tenants.AddRangeAsync(tenantA, tenantB);
        await dbContext.Users.AddAsync(user);
        await dbContext.SaveChangesAsync();

        currentTenant.SetTenant(tenantA.Id, tenantA.Slug);
        var workspaceA = new Workspace
        {
            Name = "PostgreSQL Workspace A",
            Slug = $"pg-workspace-a-{runId}",
            CreatedByUserId = user.Id
        };
        await dbContext.Workspaces.AddAsync(workspaceA);
        await dbContext.WorkspaceMembers.AddAsync(new WorkspaceMember
        {
            WorkspaceId = workspaceA.Id,
            UserId = user.Id,
            Role = WorkspaceRole.Owner,
            Status = MembershipStatus.Active,
            JoinedAt = DateTimeOffset.UtcNow
        });
        await dbContext.Projects.AddAsync(new Project
        {
            WorkspaceId = workspaceA.Id,
            OwnerUserId = user.Id,
            CreatedByUserId = user.Id,
            Name = "PostgreSQL Project A",
            Slug = $"pg-project-a-{runId}"
        });
        await dbContext.SaveChangesAsync();

        currentTenant.SetTenant(tenantB.Id, tenantB.Slug);
        var workspaceB = new Workspace
        {
            Name = "PostgreSQL Workspace B",
            Slug = $"pg-workspace-b-{runId}",
            CreatedByUserId = user.Id
        };
        await dbContext.Workspaces.AddAsync(workspaceB);
        await dbContext.WorkspaceMembers.AddAsync(new WorkspaceMember
        {
            WorkspaceId = workspaceB.Id,
            UserId = user.Id,
            Role = WorkspaceRole.Owner,
            Status = MembershipStatus.Active,
            JoinedAt = DateTimeOffset.UtcNow
        });
        await dbContext.Projects.AddAsync(new Project
        {
            WorkspaceId = workspaceB.Id,
            OwnerUserId = user.Id,
            CreatedByUserId = user.Id,
            Name = "PostgreSQL Project B",
            Slug = $"pg-project-b-{runId}"
        });
        await dbContext.SaveChangesAsync();

        var repository = new ProjectRepository(dbContext);

        currentTenant.SetTenant(tenantA.Id, tenantA.Slug);
        var tenantAProjects = await repository.ListVisibleAsync(user.Id);
        Assert.Contains(tenantAProjects, project => project.Name == "PostgreSQL Project A");
        Assert.DoesNotContain(tenantAProjects, project => project.Name == "PostgreSQL Project B");

        currentTenant.SetTenant(tenantB.Id, tenantB.Slug);
        var tenantBProjects = await repository.ListVisibleAsync(user.Id);
        Assert.Contains(tenantBProjects, project => project.Name == "PostgreSQL Project B");
        Assert.DoesNotContain(tenantBProjects, project => project.Name == "PostgreSQL Project A");
    }
}
