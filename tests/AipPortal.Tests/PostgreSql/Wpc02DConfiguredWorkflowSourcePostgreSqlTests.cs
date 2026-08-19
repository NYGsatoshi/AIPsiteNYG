using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.PostgreSql;

[Trait("Scope", "WPC02D")]
public sealed class Wpc02DConfiguredWorkflowSourcePostgreSqlTests
{
    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task PersistedConfiguredWorkflowSourceUsesWorkspaceThenTenantThenCanonicalFallback()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedConfiguredGraphAsync(database, "precedence");

            await using var db = CreateTenantContext(database, graph.TenantId, graph.TenantSlug);
            var project = await db.Projects.SingleAsync(item => item.Id == graph.ProjectId);
            var resolver = new ProjectTaskWorkflowResolver(new ConfiguredProjectTaskWorkflowSource(db));

            var workspace = await resolver.ResolveAsync(project);
            Assert.True(workspace.IsSuccess, workspace.Error);
            Assert.Equal("Workspace Template", workspace.Value!.DisplayName);
            Assert.StartsWith($"TaskWorkflowTemplate/{graph.WorkspaceTemplateId:D}/v", workspace.Value.SourceIdentity);
            Assert.Equal(new[] { "Workspace Todo", "Workspace Done" }, workspace.Value.Stages.Select(stage => stage.Name).ToArray());

            var workspaceRow = await db.Workspaces.SingleAsync(item => item.Id == graph.WorkspaceId);
            workspaceRow.DefaultTaskWorkflowTemplateId = null;
            await db.SaveChangesAsync();

            var tenant = await resolver.ResolveAsync(project);
            Assert.True(tenant.IsSuccess, tenant.Error);
            Assert.Equal("Tenant Template", tenant.Value!.DisplayName);
            Assert.StartsWith($"TaskWorkflowTemplate/{graph.TenantTemplateId:D}/v", tenant.Value.SourceIdentity);
            Assert.Equal(new[] { "Tenant Ready", "Tenant Complete" }, tenant.Value.Stages.Select(stage => stage.Name).ToArray());

            var settings = await db.TenantSettings.SingleAsync(item => item.TenantId == graph.TenantId);
            settings.DefaultTaskWorkflowTemplateId = null;
            await db.SaveChangesAsync();

            var fallback = await resolver.ResolveAsync(project);
            Assert.True(fallback.IsSuccess, fallback.Error);
            Assert.Equal(ProjectTaskWorkflowResolver.CanonicalFallbackIdentity, fallback.Value!.SourceIdentity);
            Assert.Equal(6, fallback.Value.Stages.Count);
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task PersistedWorkspaceTemplateIsCopiedIntoProjectWorkflow()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graph = await SeedConfiguredGraphAsync(database, "copy");

            await using var db = CreateTenantContext(database, graph.TenantId, graph.TenantSlug);
            var project = await db.Projects.SingleAsync(item => item.Id == graph.ProjectId);
            var provisioner = new ProjectTaskWorkflowActivationProvisioner(
                new ProjectActivationWorkflowStore(db),
                new ProjectTaskWorkflowResolver(new ConfiguredProjectTaskWorkflowSource(db)));

            var staged = await provisioner.StageAsync(project);
            Assert.True(staged.IsSuccess, staged.Error);
            await db.SaveChangesAsync();

            var definition = await db.TaskWorkflowDefinitions
                .AsNoTracking()
                .SingleAsync(item => item.ProjectId == graph.ProjectId);
            Assert.Equal("Workspace Template", definition.Name);
            Assert.False(definition.ReviewEnforcementEnabled);

            var stages = await db.TaskWorkflowStages
                .AsNoTracking()
                .Where(item => item.ProjectId == graph.ProjectId)
                .OrderBy(item => item.SortKey)
                .ToListAsync();
            Assert.Collection(
                stages,
                stage =>
                {
                    Assert.Equal("Workspace Todo", stage.Name);
                    Assert.Equal(TaskStageCategory.Todo, stage.InternalCategory);
                    Assert.True(stage.IsInitialStage);
                    Assert.False(stage.IsTerminalStage);
                    Assert.Equal(3, stage.WipWarningLimit);
                },
                stage =>
                {
                    Assert.Equal("Workspace Done", stage.Name);
                    Assert.Equal(TaskStageCategory.Done, stage.InternalCategory);
                    Assert.False(stage.IsInitialStage);
                    Assert.True(stage.IsTerminalStage);
                    Assert.Null(stage.WipWarningLimit);
                });
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ConfiguredWorkflowDefaultReferencesRejectCrossTenantTemplates()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var platformTenant = new CurrentTenantService();
            platformTenant.SetPlatformScope();
            await using var platform = new AppDbContext(Options(database), platformTenant);

            var tenantA = NewTenant("cross-a");
            var tenantB = NewTenant("cross-b");
            var user = NewUser("cross-owner");
            platform.Tenants.AddRange(tenantA, tenantB);
            platform.Users.Add(user);
            await platform.SaveChangesAsync();

            var foreignTemplate = new TaskWorkflowTemplate
            {
                TenantId = tenantB.Id,
                Name = "Foreign Template",
                ReviewEnforcementEnabled = true
            };
            platform.Set<TaskWorkflowTemplate>().Add(foreignTemplate);
            await platform.SaveChangesAsync();

            var currentTenantA = new CurrentTenantService();
            currentTenantA.SetTenant(tenantA.Id, tenantA.Slug);
            await using (var seedA = new AppDbContext(Options(database), currentTenantA))
            {
                var workspace = new Workspace
                {
                    TenantId = tenantA.Id,
                    Name = "Cross Tenant Workspace",
                    Slug = $"cross-tenant-{Guid.NewGuid():N}",
                    CreatedByUserId = user.Id,
                    Status = WorkspaceStatus.Active
                };
                seedA.Workspaces.Add(workspace);
                seedA.TenantSettings.Add(new TenantSettings
                {
                    TenantId = tenantA.Id,
                    DisplayName = "Tenant A"
                });
                await seedA.SaveChangesAsync();
            }

            await using (var workspaceAttempt = new AppDbContext(Options(database), currentTenantA))
            {
                var workspace = await workspaceAttempt.Workspaces.SingleAsync();
                workspace.DefaultTaskWorkflowTemplateId = foreignTemplate.Id;
                await Assert.ThrowsAsync<DbUpdateException>(() => workspaceAttempt.SaveChangesAsync());
            }

            await using (var tenantAttempt = new AppDbContext(Options(database), currentTenantA))
            {
                var settings = await tenantAttempt.TenantSettings.SingleAsync();
                settings.DefaultTaskWorkflowTemplateId = foreignTemplate.Id;
                await Assert.ThrowsAsync<DbUpdateException>(() => tenantAttempt.SaveChangesAsync());
            }
        });
    }

    private static async Task<ConfiguredGraph> SeedConfiguredGraphAsync(string connectionString, string suffix)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetPlatformScope();
        await using var db = new AppDbContext(Options(connectionString), currentTenant);

        var tenant = NewTenant(suffix);
        var owner = NewUser($"{suffix}-owner");
        db.Tenants.Add(tenant);
        db.Users.Add(owner);
        await db.SaveChangesAsync();

        currentTenant.SetTenant(tenant.Id, tenant.Slug);
        var workspaceTemplate = NewTemplate(
            tenant.Id,
            "Workspace Template",
            reviewEnforcementEnabled: false,
            ("Workspace Todo", TaskStageCategory.Todo, 1000L, 3, true, false),
            ("Workspace Done", TaskStageCategory.Done, 2000L, null, false, true));
        var tenantTemplate = NewTemplate(
            tenant.Id,
            "Tenant Template",
            reviewEnforcementEnabled: true,
            ("Tenant Ready", TaskStageCategory.Backlog, 1000L, null, true, false),
            ("Tenant Complete", TaskStageCategory.Done, 2000L, null, false, true));
        db.Set<TaskWorkflowTemplate>().AddRange(workspaceTemplate, tenantTemplate);
        await db.SaveChangesAsync();

        var workspace = new Workspace
        {
            TenantId = tenant.Id,
            Name = $"Configured Workspace {suffix}",
            Slug = $"configured-{suffix}-{Guid.NewGuid():N}",
            CreatedByUserId = owner.Id,
            Status = WorkspaceStatus.Active,
            DefaultTaskWorkflowTemplateId = workspaceTemplate.Id
        };
        var settings = new TenantSettings
        {
            TenantId = tenant.Id,
            DisplayName = $"Configured Tenant {suffix}",
            DefaultTaskWorkflowTemplateId = tenantTemplate.Id
        };
        var project = new Project
        {
            TenantId = tenant.Id,
            WorkspaceId = workspace.Id,
            OwnerUserId = owner.Id,
            CreatedByUserId = owner.Id,
            Name = $"Configured Project {suffix}",
            Slug = $"configured-project-{suffix}-{Guid.NewGuid():N}",
            Status = ProjectStatus.Planning,
            Visibility = ProjectVisibility.MembersOnly,
            ActivationState = ProjectActivationState.NeverActivated,
            VersionNo = 1
        };
        db.Workspaces.Add(workspace);
        db.TenantSettings.Add(settings);
        db.Projects.Add(project);
        await db.SaveChangesAsync();

        return new ConfiguredGraph(
            tenant.Id,
            tenant.Slug,
            workspace.Id,
            project.Id,
            workspaceTemplate.Id,
            tenantTemplate.Id);
    }

    private static TaskWorkflowTemplate NewTemplate(
        Guid tenantId,
        string name,
        bool reviewEnforcementEnabled,
        params (string Name, TaskStageCategory Category, long SortKey, int? Wip, bool Initial, bool Terminal)[] stages)
    {
        var template = new TaskWorkflowTemplate
        {
            TenantId = tenantId,
            Name = name,
            ReviewEnforcementEnabled = reviewEnforcementEnabled,
            VersionNo = 1
        };
        foreach (var stage in stages)
        {
            template.Stages.Add(new TaskWorkflowTemplateStage
            {
                TenantId = tenantId,
                TemplateId = template.Id,
                Name = stage.Name,
                InternalCategory = stage.Category,
                SortKey = stage.SortKey,
                WipWarningLimit = stage.Wip,
                IsInitialStage = stage.Initial,
                IsTerminalStage = stage.Terminal,
                VersionNo = 1
            });
        }
        return template;
    }

    private static Tenant NewTenant(string suffix) => new()
    {
        Name = $"WPC02D Tenant {suffix} {Guid.NewGuid():N}",
        DisplayName = $"WPC02D Tenant {suffix}",
        Slug = $"wpc02d-template-{suffix}-{Guid.NewGuid():N}",
        Status = TenantStatus.Active
    };

    private static User NewUser(string suffix) => new()
    {
        DisplayName = $"WPC02D {suffix}",
        Email = $"{suffix}-{Guid.NewGuid():N}@example.test".ToLowerInvariant(),
        NormalizedEmail = $"{suffix}-{Guid.NewGuid():N}@example.test".ToUpperInvariant(),
        Status = UserStatus.Active,
        SystemRole = SystemRole.NormalUser
    };

    private static AppDbContext CreateTenantContext(
        string connectionString,
        Guid tenantId,
        string tenantSlug)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(tenantId, tenantSlug);
        return new AppDbContext(Options(connectionString), currentTenant);
    }

    private static DbContextOptions<AppDbContext> Options(string connectionString) =>
        new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .AddInterceptors(new ProjectGovernanceSaveChangesInterceptor())
            .Options;

    private sealed record ConfiguredGraph(
        Guid TenantId,
        string TenantSlug,
        Guid WorkspaceId,
        Guid ProjectId,
        Guid WorkspaceTemplateId,
        Guid TenantTemplateId);
}
