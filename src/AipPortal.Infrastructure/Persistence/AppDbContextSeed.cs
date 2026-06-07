using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Application.Common.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public static class AppDbContextSeed
{
    public static readonly Guid DefaultTenantId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    public static async Task<Tenant> SeedDefaultTenantAsync(
        AppDbContext dbContext,
        TenancyOptions options,
        CancellationToken cancellationToken = default)
    {
        var slug = string.IsNullOrWhiteSpace(options.DefaultTenantSlug)
            ? "default"
            : options.DefaultTenantSlug.Trim().ToLowerInvariant();

        var tenant = await dbContext.Tenants.FirstOrDefaultAsync(candidate => candidate.Slug == slug, cancellationToken);
        if (tenant is not null)
        {
            return tenant;
        }

        tenant = await dbContext.Tenants.FirstOrDefaultAsync(cancellationToken);
        if (tenant is not null)
        {
            return tenant;
        }

        tenant = new Tenant(DefaultTenantId)
        {
            Name = "Default Tenant",
            Slug = slug,
            DisplayName = "Default Tenant",
            Status = TenantStatus.Active
        };

        await dbContext.Tenants.AddAsync(tenant, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        return tenant;
    }

    public static async Task SeedUiShellAsync(AppDbContext dbContext, Guid tenantId, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        await SeedModulesAsync(dbContext, now, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        var modules = await dbContext.FeatureModules.ToDictionaryAsync(module => module.Key, cancellationToken);
        await SeedPanelsAsync(dbContext, modules, now, cancellationToken);
        await SeedCommandsAsync(dbContext, modules, now, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        var commands = await dbContext.CommandDefinitions.ToDictionaryAsync(command => command.Key, cancellationToken);
        await SeedRadialMenusAsync(dbContext, commands, tenantId, now, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public static async Task SeedPlansAsync(AppDbContext dbContext, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var features = "[\"ProductionTracking\",\"AdvancedGanttChart\",\"ExternalGuestAccess\",\"FileSharing\",\"Calendar\",\"Attendance\",\"Forms\",\"WebhookIntegration\",\"ApiAccess\",\"CustomBranding\",\"AuditLogViewer\",\"RadialMenu\",\"DockingLayout\"]";
        var plans = new (string Name, string Description, int Users, long Storage, int Projects, PlanStatus Status)[]
        {
            ("InternalPilot", "Internal pilot and development plan.", 100, 10L * 1024 * 1024 * 1024, 100, PlanStatus.InternalOnly),
            ("SchoolPilot", "Small school pilot plan.", 150, 25L * 1024 * 1024 * 1024, 150, PlanStatus.Active),
            ("Standard", "Standard SaaS plan foundation.", 500, 100L * 1024 * 1024 * 1024, 500, PlanStatus.Active),
            ("Enterprise", "Enterprise and on-prem configuration plan.", 5000, 1024L * 1024 * 1024 * 1024, 5000, PlanStatus.Active)
        };

        var existing = await dbContext.Plans.Select(plan => plan.Name).ToListAsync(cancellationToken);
        foreach (var plan in plans.Where(plan => !existing.Contains(plan.Name)))
        {
            await dbContext.Plans.AddAsync(new Plan
            {
                Name = plan.Name,
                Description = plan.Description,
                MaxUsers = plan.Users,
                MaxStorageBytes = plan.Storage,
                MaxProjects = plan.Projects,
                EnabledFeaturesJson = features,
                Status = plan.Status,
                CreatedAt = now
            }, cancellationToken);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedModulesAsync(AppDbContext dbContext, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var modules = new (string Key, string Name, string Route, string Icon, int Sort)[]
        {
            ("Dashboard", "Dashboard", "/dashboard", "layout-dashboard", 10),
            ("Workspaces", "Workspaces", "/workspaces", "building", 20),
            ("Groups", "Groups", "/groups", "users", 30),
            ("Channels", "Channels", "/channels", "messages-square", 40),
            ("Messaging", "Messaging", "/messages", "message-circle", 50),
            ("Announcements", "Announcements", "/announcements", "megaphone", 60),
            ("Notifications", "Notifications", "/notifications", "bell", 70),
            ("Files", "Files", "/files", "paperclip", 80),
            ("Projects", "Projects", "/projects", "folder-kanban", 90),
            ("ProductionTracking", "Production Tracking", "/production", "gantt-chart", 100),
            ("Feedback", "Feedback", "/feedback", "message-square-text", 110),
            ("Search", "Search", "/search", "search", 120),
            ("Admin", "Admin", "/admin", "shield", 130)
        };

        var existing = await dbContext.FeatureModules.Select(module => module.Key).ToListAsync(cancellationToken);
        foreach (var module in modules.Where(module => !existing.Contains(module.Key)))
        {
            await dbContext.FeatureModules.AddAsync(new FeatureModule
            {
                Key = module.Key,
                Name = module.Name,
                DefaultRoute = module.Route,
                Icon = module.Icon,
                RequiredRole = module.Key == "Admin" ? SystemRole.Admin : null,
                SortOrder = module.Sort,
                CreatedAt = now
            }, cancellationToken);
        }
    }

    private static async Task SeedPanelsAsync(AppDbContext dbContext, IReadOnlyDictionary<string, FeatureModule> modules, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var panels = new (string Key, string Title, string Module, int Sort)[]
        {
            ("dashboard.overview", "Overview", "Dashboard", 10),
            ("project.summary", "Project Summary", "Projects", 20),
            ("project.taskList", "Task List", "Projects", 30),
            ("project.gantt", "Gantt", "ProductionTracking", 40),
            ("project.members", "Members", "Projects", 50),
            ("project.artifacts", "Artifacts", "Files", 60),
            ("project.comments", "Comments", "Projects", 70),
            ("project.activityLogs", "Activity Logs", "Projects", 80),
            ("messaging.conversationList", "Conversations", "Messaging", 90),
            ("messaging.conversationDetail", "Conversation Detail", "Messaging", 100),
            ("notifications.list", "Notifications", "Notifications", 110)
        };

        var existing = await dbContext.PanelDefinitions.Select(panel => panel.Key).ToListAsync(cancellationToken);
        foreach (var panel in panels.Where(panel => !existing.Contains(panel.Key)))
        {
            await dbContext.PanelDefinitions.AddAsync(new PanelDefinition
            {
                FeatureModuleId = modules[panel.Module].Id,
                Key = panel.Key,
                Name = panel.Title,
                Route = "/" + panel.Key.Replace('.', '/'),
                DefaultPosition = "Center",
                MinWidth = 280,
                MinHeight = 180,
                DefaultWidth = 640,
                DefaultHeight = 420,
                SortOrder = panel.Sort,
                CreatedAt = now
            }, cancellationToken);
        }
    }

    private static async Task SeedCommandsAsync(AppDbContext dbContext, IReadOnlyDictionary<string, FeatureModule> modules, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var commands = new (string Key, string Label, string Module, CommandContextType Context, string? Route, int Sort)[]
        {
            ("project.open", "Open Project", "Projects", CommandContextType.Project, "/projects/{contextId}", 10),
            ("project.create", "Create Project", "Projects", CommandContextType.Global, "/projects/new", 20),
            ("project.members", "Project Members", "Projects", CommandContextType.Project, "/projects/{contextId}/members", 30),
            ("task.create", "Create Task", "Projects", CommandContextType.Project, "/projects/{contextId}/tasks/new", 40),
            ("task.changeStatus", "Change Status", "Projects", CommandContextType.TaskItem, null, 50),
            ("task.assignUser", "Assign User", "Projects", CommandContextType.TaskItem, null, 60),
            ("task.addComment", "Add Comment", "Projects", CommandContextType.TaskItem, null, 70),
            ("task.complete", "Complete Task", "Projects", CommandContextType.TaskItem, null, 80),
            ("artifact.upload", "Upload Artifact", "Files", CommandContextType.Project, null, 90),
            ("activityLog.create", "Create Activity Log", "Projects", CommandContextType.Project, null, 100),
            ("dm.open", "Open DM", "Messaging", CommandContextType.Global, "/messages", 110),
            ("notification.open", "Open Notification", "Notifications", CommandContextType.Global, "/notifications", 120),
            ("gantt.open", "Open Gantt", "ProductionTracking", CommandContextType.Project, "/projects/{contextId}/gantt", 130)
        };

        var existing = await dbContext.CommandDefinitions.Select(command => command.Key).ToListAsync(cancellationToken);
        foreach (var command in commands.Where(command => !existing.Contains(command.Key)))
        {
            await dbContext.CommandDefinitions.AddAsync(new CommandDefinition
            {
                FeatureModuleId = modules[command.Module].Id,
                Key = command.Key,
                Name = command.Label,
                ActionType = command.Route is null ? CommandActionType.ClientAction : CommandActionType.Navigate,
                Route = command.Route,
                ContextType = command.Context,
                SortOrder = command.Sort,
                CreatedAt = now
            }, cancellationToken);
        }
    }

    private static async Task SeedRadialMenusAsync(
        AppDbContext dbContext,
        IReadOnlyDictionary<string, CommandDefinition> commands,
        Guid tenantId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await SeedProfileAsync(dbContext, commands, "default.project", "Default Project", CommandContextType.Project, new[]
        {
            (RadialMenuDirection.Up, "project.open"),
            (RadialMenuDirection.UpRight, "project.members"),
            (RadialMenuDirection.Right, "dm.open"),
            (RadialMenuDirection.DownRight, "task.addComment"),
            (RadialMenuDirection.Down, "task.create"),
            (RadialMenuDirection.DownLeft, "activityLog.create"),
            (RadialMenuDirection.Left, "artifact.upload"),
            (RadialMenuDirection.UpLeft, "gantt.open")
        }, tenantId, now, cancellationToken);

        await SeedProfileAsync(dbContext, commands, "default.task", "Default Task", CommandContextType.TaskItem, new[]
        {
            (RadialMenuDirection.Up, "task.changeStatus"),
            (RadialMenuDirection.UpRight, "task.assignUser"),
            (RadialMenuDirection.Right, "task.addComment"),
            (RadialMenuDirection.DownRight, "artifact.upload"),
            (RadialMenuDirection.Down, "task.complete"),
            (RadialMenuDirection.DownLeft, "activityLog.create"),
            (RadialMenuDirection.Left, "project.open"),
            (RadialMenuDirection.UpLeft, "gantt.open")
        }, tenantId, now, cancellationToken);
    }

    private static async Task SeedProfileAsync(
        AppDbContext dbContext,
        IReadOnlyDictionary<string, CommandDefinition> commands,
        string key,
        string name,
        CommandContextType context,
        IReadOnlyList<(RadialMenuDirection Direction, string CommandKey)> items,
        Guid tenantId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (await dbContext.RadialMenuProfiles.AnyAsync(profile => profile.TenantId == tenantId && profile.ProfileKey == key, cancellationToken))
        {
            return;
        }

        var profile = new RadialMenuProfile
        {
            TenantId = tenantId,
            ProfileKey = key,
            Name = name,
            ContextType = context,
            Scope = context == CommandContextType.Project ? RadialMenuScope.Project : RadialMenuScope.Global,
            IsDefault = true,
            CreatedAt = now
        };

        await dbContext.RadialMenuProfiles.AddAsync(profile, cancellationToken);
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            await dbContext.RadialMenuItems.AddAsync(new RadialMenuItem
            {
                TenantId = tenantId,
                RadialMenuProfileId = profile.Id,
                CommandDefinitionId = commands[item.CommandKey].Id,
                CommandKey = item.CommandKey,
                Direction = item.Direction,
                Label = commands[item.CommandKey].Name,
                Icon = commands[item.CommandKey].Icon,
                SortOrder = i
            }, cancellationToken);
        }
    }
}
