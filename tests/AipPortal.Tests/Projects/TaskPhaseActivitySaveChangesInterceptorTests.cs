using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.Projects;

public sealed class TaskPhaseActivitySaveChangesInterceptorTests
{
    [Fact]
    [Trait("Scope", "Issue369")]
    public async Task WorkflowStageChangeAppendsTaskLinkedStatusActivityInTheSameSaveBoundary()
    {
        var tenantScope = new CurrentTenantService();
        tenantScope.SetPlatformScope();
        var actorId = Guid.NewGuid();
        var occurredAt = new DateTimeOffset(2026, 8, 29, 10, 0, 0, TimeSpan.Zero);
        var interceptor = new TaskPhaseActivitySaveChangesInterceptor(
            new StubCurrentUser(actorId, isAuthenticated: true),
            new FixedClock(occurredAt));
        await using var context = Context(tenantScope, interceptor);
        var task = SeedTask();
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var tracked = await context.TaskItems.SingleAsync(item => item.Id == task.Id);
        var review = new TaskWorkflowStage
        {
            TenantId = tracked.TenantId,
            WorkspaceId = tracked.WorkspaceId,
            ProjectId = tracked.ProjectId,
            DefinitionId = Guid.NewGuid(),
            Name = "Review",
            InternalCategory = TaskStageCategory.Review,
            SortKey = 4000
        };
        tracked.WorkflowStage = review;
        tracked.WorkflowStageId = review.Id;

        await context.SaveChangesAsync();

        var activity = Assert.Single(await context.ActivityLogs.AsNoTracking().ToListAsync());
        Assert.Equal(task.Id, activity.TaskItemId);
        Assert.Equal(task.ProjectId, activity.ProjectId);
        Assert.Equal(task.TenantId, activity.TenantId);
        Assert.Equal(actorId, activity.AuthorUserId);
        Assert.Equal(ActivityLogType.StatusUpdate, activity.ActivityType);
        Assert.Equal("Workflow phase changed to Review.", activity.Body);
        Assert.Equal(occurredAt, activity.OccurredAt);
    }

    [Fact]
    [Trait("Scope", "Issue369")]
    public async Task NonPhaseTaskEditDoesNotCreatePhaseActivity()
    {
        var tenantScope = new CurrentTenantService();
        tenantScope.SetPlatformScope();
        var interceptor = new TaskPhaseActivitySaveChangesInterceptor(
            new StubCurrentUser(Guid.NewGuid(), isAuthenticated: true),
            new FixedClock(new DateTimeOffset(2026, 8, 29, 10, 5, 0, TimeSpan.Zero)));
        await using var context = Context(tenantScope, interceptor);
        var task = SeedTask();
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var tracked = await context.TaskItems.SingleAsync(item => item.Id == task.Id);
        tracked.Title = "Updated title only";
        await context.SaveChangesAsync();

        Assert.Empty(await context.ActivityLogs.AsNoTracking().ToListAsync());
    }

    [Fact]
    [Trait("Scope", "Issue369")]
    public async Task WorkflowStageChangeWithoutAuthenticatedAuthorFailsClosed()
    {
        var tenantScope = new CurrentTenantService();
        tenantScope.SetPlatformScope();
        var interceptor = new TaskPhaseActivitySaveChangesInterceptor(
            new StubCurrentUser(Guid.NewGuid(), isAuthenticated: false),
            new FixedClock(new DateTimeOffset(2026, 8, 29, 10, 10, 0, TimeSpan.Zero)));
        await using var context = Context(tenantScope, interceptor);
        var task = SeedTask();
        context.TaskItems.Add(task);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var tracked = await context.TaskItems.SingleAsync(item => item.Id == task.Id);
        tracked.WorkflowStageId = Guid.NewGuid();

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
        Assert.Contains("TASK_PHASE_ACTIVITY_AUTHOR_REQUIRED", exception.Message, StringComparison.Ordinal);
        Assert.Empty(await context.ActivityLogs.AsNoTracking().ToListAsync());
    }

    private static AppDbContext Context(
        CurrentTenantService tenantScope,
        TaskPhaseActivitySaveChangesInterceptor interceptor) => new(
        new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .AddInterceptors(interceptor)
            .Options,
        tenantScope);

    private static TaskItem SeedTask() => new()
    {
        TenantId = Guid.NewGuid(),
        WorkspaceId = Guid.NewGuid(),
        ProjectId = Guid.NewGuid(),
        WorkflowStageId = Guid.NewGuid(),
        CreatedByUserId = Guid.NewGuid(),
        Title = "Phase history task"
    };

    private sealed class FixedClock(DateTimeOffset utcNow) : IClock
    {
        public DateTimeOffset UtcNow { get; } = utcNow;
    }

    private sealed class StubCurrentUser(Guid? userId, bool isAuthenticated) : ICurrentUser
    {
        public Guid? UserId { get; } = userId;
        public Guid? SessionId => null;
        public string? Email => null;
        public SystemRole? SystemRole => null;
        public bool IsAuthenticated { get; } = isAuthenticated;
    }
}
