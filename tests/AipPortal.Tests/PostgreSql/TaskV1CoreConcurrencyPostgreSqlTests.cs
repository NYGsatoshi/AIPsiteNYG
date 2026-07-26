using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Files;
using AipPortal.Application.Messaging;
using AipPortal.Application.Projects;
using AipPortal.Application.Realtime;
using AipPortal.Application.Workspaces;
using AipPortal.Application.Groups;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Audit;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;

namespace AipPortal.Tests.PostgreSql;

/// <summary>
/// Exercises the versioned Task command boundary with two independent request
/// scopes.  The scopes share only a deterministic clock coordinator; each owns
/// its DbContext, repositories, authorization services, audit logger, outbox,
/// and EfUnitOfWork.
/// </summary>
[Collection("PostgreSqlTaskV1")]
public sealed class TaskV1CoreConcurrencyPostgreSqlTests
{
    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task UpdateDetails_OneServiceWriterWins_LoserIsCleanAndCanRetry()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var expected = harness.Graph.Task.VersionNo;
        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();

        // Both requests read the same authoritative version before their writes.
        Assert.Equal(expected, (await first.Commands.GetAsync(harness.Graph.Task.Id)).Value!.Version);
        Assert.Equal(expected, (await second.Commands.GetAsync(harness.Graph.Task.Id)).Value!.Version);

        harness.Race.Arm();
        var firstTask = ExecuteAsync(first, () => first.Commands.UpdateDetailsAsync(harness.Graph.Task.Id, Details("first", expected)));
        var secondTask = ExecuteAsync(second, () => second.Commands.UpdateDetailsAsync(harness.Graph.Task.Id, Details("second", expected)));
        var results = await Task.WhenAll(firstTask, secondTask);

        Assert.Equal(1, results.Count(result => result.Result.IsSuccess));
        var winner = results.Single(result => result.Result.IsSuccess);
        var loser = results.Single(result => !result.Result.IsSuccess);
        Assert.Equal("TASK_STALE_VERSION", Code(loser.Result.Error));
        Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());

        await using (var verify = harness.CreateScope())
        {
            var task = await verify.Db.TaskItems.SingleAsync(item => item.Id == harness.Graph.Task.Id);
            Assert.Equal(winner.Result.Value!.Title, task.Title);
            Assert.Equal(2, task.VersionNo);
            Assert.Single(await verify.Db.AuditLogs.Where(log => log.EntityId == task.Id && log.Action == "TaskDetailsUpdated").ToListAsync());
            Assert.Single(await verify.Db.OutboxEvents.Where(evt => evt.AggregateId == task.Id && evt.EventType == "Projects.TaskChanged.v1").ToListAsync());
            Assert.Equal("unrelated", await verify.Db.TaskItems.Where(item => item.Id == harness.Graph.UnrelatedTask.Id).Select(item => item.Title).SingleAsync());
        }

        await using var retry = harness.CreateScope();
        var current = (await retry.Commands.GetAsync(harness.Graph.Task.Id)).Value!;
        var retried = await retry.Commands.UpdateDetailsAsync(harness.Graph.Task.Id, Details("retry", current.Version));
        Assert.True(retried.IsSuccess);
        Assert.Equal("retry", retried.Value!.Title);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task CreateSubtask_ParentConflictRollsBackLoserChildWatchAuditAndOutbox()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();

        harness.Race.Arm();
        var firstTask = ExecuteAsync(first, () => first.Subresources.CreateSubtaskAsync(harness.Graph.Task.Id, new CreateTaskSubtaskRequest("first child", null, TaskPriority.Medium)));
        var secondTask = ExecuteAsync(second, () => second.Subresources.CreateSubtaskAsync(harness.Graph.Task.Id, new CreateTaskSubtaskRequest("second child", null, TaskPriority.Medium)));
        var results = await Task.WhenAll(firstTask, secondTask);

        Assert.Equal(1, results.Count(result => result.Result.IsSuccess));
        var winner = results.Single(result => result.Result.IsSuccess);
        var loser = results.Single(result => !result.Result.IsSuccess);
        Assert.Equal("TASK_STALE_VERSION", Code(loser.Result.Error));
        Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());

        await using (var verify = harness.CreateScope())
        {
            var children = await verify.Db.TaskItems.Where(item => item.ParentTaskItemId == harness.Graph.Task.Id).ToListAsync();
            var child = Assert.Single(children);
            Assert.Equal(winner.Result.Value!.Title, child.Title);
            Assert.Single(await verify.Db.WorkItemWatchStates.Where(state => state.TaskItemId == child.Id && state.UserId == harness.Graph.User.Id && state.AutomaticSources == WorkItemWatchAutomaticSource.Creator).ToListAsync());
            Assert.Equal(2, (await verify.Db.TaskItems.SingleAsync(item => item.Id == harness.Graph.Task.Id)).VersionNo);
            Assert.Single(await verify.Db.AuditLogs.Where(log => log.EntityId == child.Id && log.Action == "TaskCreated").ToListAsync());
            Assert.Single(await verify.Db.AuditLogs.Where(log => log.EntityId == harness.Graph.Task.Id && log.Action == "TaskSubtasksChanged").ToListAsync());
            Assert.Single(await verify.Db.OutboxEvents.Where(evt => evt.AggregateId == child.Id).ToListAsync());
            Assert.Single(await verify.Db.OutboxEvents.Where(evt => evt.AggregateId == harness.Graph.Task.Id).ToListAsync());
        }

        await using var retry = harness.CreateScope();
        var retried = await retry.Subresources.CreateSubtaskAsync(harness.Graph.Task.Id, new CreateTaskSubtaskRequest("retry child", null, TaskPriority.Medium));
        Assert.True(retried.IsSuccess);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task Checklist_CreateUpdateDeleteAndReorder_AreAggregateAtomic()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var firstItem = await CreateChecklistAsync(harness, "first");
        var secondItem = await CreateChecklistAsync(harness, "second");

        await using (var createA = harness.CreateScope())
        await using (var createB = harness.CreateScope())
        {
            var before = await SnapshotAsync(harness);
            harness.Race.Arm();
            var creates = await Task.WhenAll(
                ExecuteAsync(createA, () => createA.Subresources.CreateChecklistAsync(harness.Graph.Task.Id, new CreateTaskChecklistRequest("racing a"))),
                ExecuteAsync(createB, () => createB.Subresources.CreateChecklistAsync(harness.Graph.Task.Id, new CreateTaskChecklistRequest("racing b"))));
            Assert.Equal(1, creates.Count(result => result.Result.IsSuccess));
            var loser = creates.Single(result => !result.Result.IsSuccess);
            Assert.Equal("TASK_STALE_VERSION", Code(loser.Result.Error));
            Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());
            await using var verify = harness.CreateScope();
            Assert.Equal(3, await verify.Db.TaskChecklistItems.CountAsync(value => value.TaskItemId == harness.Graph.Task.Id));
            await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskChecklistCreated", 1, 1);
        }

        await using (var updateA = harness.CreateScope())
        await using (var updateB = harness.CreateScope())
        {
            var before = await SnapshotAsync(harness);
            harness.Race.Arm();
            var updates = await Task.WhenAll(
                ExecuteAsync(updateA, () => updateA.Subresources.UpdateChecklistAsync(harness.Graph.Task.Id, firstItem.Id, new UpdateTaskChecklistRequest("completed", true, firstItem.Version))),
                ExecuteAsync(updateB, () => updateB.Subresources.UpdateChecklistAsync(harness.Graph.Task.Id, firstItem.Id, new UpdateTaskChecklistRequest("other", false, firstItem.Version))));
            Assert.Equal(1, updates.Count(result => result.Result.IsSuccess));
            var winner = updates.Single(result => result.Result.IsSuccess).Result.Value!;
            var loser = updates.Single(result => !result.Result.IsSuccess);
            Assert.Equal("TASK_STALE_VERSION", Code(loser.Result.Error));
            Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());
            await using var verify = harness.CreateScope();
            var item = await verify.Db.TaskChecklistItems.SingleAsync(value => value.Id == firstItem.Id);
            Assert.Equal(winner.Text, item.Text);
            Assert.Equal(winner.IsCompleted, item.IsCompleted);
            Assert.Equal(winner.IsCompleted ? harness.Graph.User.Id : null, item.CompletedByUserId);
            Assert.Equal(winner.IsCompleted, item.CompletedAt.HasValue);
            Assert.Equal(2, item.VersionNo);
            await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskChecklistUpdated", 1, 1);
        }

        await using (var reorderA = harness.CreateScope())
        await using (var reorderB = harness.CreateScope())
        {
            var current = await ChecklistAsync(harness);
            var ids = current.Items.Select(item => item.Id).ToArray();
            var before = await SnapshotAsync(harness);
            harness.Race.Arm();
            var reorders = await Task.WhenAll(
                ExecuteAsync(reorderA, () => reorderA.Subresources.ReorderChecklistAsync(harness.Graph.Task.Id, new ReorderTaskChecklistRequest(ids.Reverse().ToArray(), current.TaskVersion))),
                ExecuteAsync(reorderB, () => reorderB.Subresources.ReorderChecklistAsync(harness.Graph.Task.Id, new ReorderTaskChecklistRequest(ids, current.TaskVersion))));
            Assert.Equal(1, reorders.Count(result => result.Result.IsSuccess));
            var winner = reorders.Single(result => result.Result.IsSuccess).Result.Value!;
            var loser = reorders.Single(result => !result.Result.IsSuccess);
            Assert.Equal("TASK_STALE_VERSION", Code(loser.Result.Error));
            Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());
            Assert.Equal(winner.Items.Select(item => item.Id), (await ChecklistAsync(harness)).Items.Select(item => item.Id));
            await using var verify = harness.CreateScope();
            var expectedSortKeys = winner.Items.Select((item, index) => (item.Id, SortKey: (index + 1) * 1024L)).ToDictionary(value => value.Id, value => value.SortKey);
            var persisted = await verify.Db.TaskChecklistItems.Where(value => value.TaskItemId == harness.Graph.Task.Id).ToListAsync();
            Assert.All(persisted, item => Assert.Equal(expectedSortKeys[item.Id], item.SortKey));
            await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskChecklistReordered", 1, 1);
        }

        await using (var delete = harness.CreateScope())
        {
            var current = await delete.Subresources.ListChecklistAsync(harness.Graph.Task.Id);
            var item = current.Value!.Single(value => value.Id == secondItem.Id);
            Assert.True((await delete.Subresources.DeleteChecklistAsync(harness.Graph.Task.Id, item.Id, item.Version)).IsSuccess);
        }

        await using var final = harness.CreateScope();
        Assert.DoesNotContain(await final.Db.TaskChecklistItems.ToListAsync(), item => item.Id == secondItem.Id);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task Checklist_CompleteAndReopen_SetAndClearMetadata()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var item = await CreateChecklistAsync(harness, "reopen me");
        var before = await SnapshotAsync(harness);

        await using (var complete = harness.CreateScope())
        {
            var result = await complete.Subresources.UpdateChecklistAsync(harness.Graph.Task.Id, item.Id, new UpdateTaskChecklistRequest(null, true, item.Version));
            Assert.True(result.IsSuccess);
        }

        await using (var check = harness.CreateScope())
        {
            var persisted = await check.Db.TaskChecklistItems.SingleAsync(value => value.Id == item.Id);
            Assert.True(persisted.IsCompleted);
            Assert.Equal(new DateTimeOffset(2026, 7, 26, 0, 0, 0, TimeSpan.Zero), persisted.CompletedAt);
            Assert.Equal(harness.Graph.User.Id, persisted.CompletedByUserId);
            Assert.Equal(item.Version + 1, persisted.VersionNo);
        }

        await using (var reopen = harness.CreateScope())
        {
            var current = await reopen.Subresources.ListChecklistAsync(harness.Graph.Task.Id);
            var result = await reopen.Subresources.UpdateChecklistAsync(harness.Graph.Task.Id, item.Id, new UpdateTaskChecklistRequest(null, false, current.Value!.Single(value => value.Id == item.Id).Version));
            Assert.True(result.IsSuccess);
        }

        await using var verify = harness.CreateScope();
        var reopened = await verify.Db.TaskChecklistItems.SingleAsync(value => value.Id == item.Id);
        Assert.False(reopened.IsCompleted);
        Assert.Null(reopened.CompletedAt);
        Assert.Null(reopened.CompletedByUserId);
        Assert.Equal(item.Version + 2, reopened.VersionNo);
        await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskChecklistUpdated", 2, 2);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task CompatibilityTaskAndAssignmentMutationsKeepCommittedTaskAndEventVersionsAligned()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var taskId = harness.Graph.UnrelatedTask.Id;

        await using (var update = harness.CreateScope())
        {
            var before = await SnapshotAsync(update.Db, taskId);
            var result = await update.Compatibility.UpdateTaskAsync(taskId, new UpdateTaskItemRequest(null, "compatibility update", null, null, null, null, null, null));
            Assert.True(result.IsSuccess);
            await using var verify = harness.CreateScope();
            await AssertTaskMutationSequenceAsync(verify.Db, before, taskId, ["TaskUpdated"]);
        }

        TaskAssignmentResponse assignment;
        await using (var add = harness.CreateScope())
        {
            var before = await SnapshotAsync(add.Db, taskId);
            var result = await add.Compatibility.AddAssignmentAsync(taskId, new AddTaskAssignmentRequest(harness.Graph.MentionUser.Id, TaskAssignmentRole.Assignee, 2));
            Assert.True(result.IsSuccess);
            assignment = result.Value!;
            await using var verify = harness.CreateScope();
            await AssertTaskMutationSequenceAsync(verify.Db, before, taskId, ["TaskAssigned"]);
        }

        await using (var update = harness.CreateScope())
        {
            var before = await SnapshotAsync(update.Db, taskId);
            var result = await update.Compatibility.UpdateAssignmentAsync(assignment.Id, new UpdateTaskAssignmentRequest(TaskAssignmentRole.Reviewer, 3, 1));
            Assert.True(result.IsSuccess);
            await using var verify = harness.CreateScope();
            await AssertTaskMutationSequenceAsync(verify.Db, before, taskId, ["TaskAssignmentUpdated"]);
        }

        await using (var delete = harness.CreateScope())
        {
            var before = await SnapshotAsync(delete.Db, taskId);
            Assert.True((await delete.Compatibility.DeleteAssignmentAsync(assignment.Id)).IsSuccess);
            await using var verify = harness.CreateScope();
            Assert.Null(await verify.Db.TaskAssignments.SingleOrDefaultAsync(value => value.Id == assignment.Id));
            await AssertTaskMutationSequenceAsync(verify.Db, before, taskId, ["TaskAssignmentRemoved"]);
        }

        await using (var delete = harness.CreateScope())
        {
            var before = await SnapshotAsync(delete.Db, harness.Graph.Task.Id);
            Assert.True((await delete.Compatibility.DeleteTaskAsync(harness.Graph.Task.Id)).IsSuccess);
            await using var verify = harness.CreateScope();
            Assert.NotNull((await verify.Db.TaskItems.SingleAsync(value => value.Id == harness.Graph.Task.Id)).DeletedAt);
            await AssertTaskMutationSequenceAsync(verify.Db, before, harness.Graph.Task.Id, ["TaskArchived"]);
        }
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task CompatibilityAssignmentRaceCommitsOnlyOneWriterAndAllowsRetry()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var taskId = harness.Graph.Task.Id;
        var before = await SnapshotAsync(harness);
        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();
        harness.Race.Arm();
        var results = await Task.WhenAll(
            ExecuteAsync(first, () => first.Compatibility.AddAssignmentAsync(taskId, new AddTaskAssignmentRequest(harness.Graph.MentionUser.Id, TaskAssignmentRole.Owner, 1))),
            ExecuteAsync(second, () => second.Compatibility.AddAssignmentAsync(taskId, new AddTaskAssignmentRequest(harness.Graph.MentionUser.Id, TaskAssignmentRole.Support, 1))));

        Assert.Equal(1, results.Count(value => value.Result.IsSuccess));
        var loser = results.Single(value => !value.Result.IsSuccess);
        Assert.Equal("TASK_STALE_VERSION", Code(loser.Result.Error));
        Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());

        await using (var verify = harness.CreateScope())
        {
            Assert.Single(await verify.Db.TaskAssignments.Where(value => value.TaskItemId == taskId).ToListAsync());
            await AssertTaskMutationSequenceAsync(verify.Db, before, taskId, ["TaskAssigned"]);
        }

        var winnerRole = results.Single(value => value.Result.IsSuccess).Result.Value!.Role;
        var retryRole = winnerRole == TaskAssignmentRole.Owner ? TaskAssignmentRole.Support : TaskAssignmentRole.Owner;
        await using var retry = harness.CreateScope();
        var retried = await retry.Compatibility.AddAssignmentAsync(taskId, new AddTaskAssignmentRequest(harness.Graph.MentionUser.Id, retryRole, 1));
        Assert.True(retried.IsSuccess);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task Checklist_UpdateVsDelete_OneAtomicWinner()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var item = await CreateChecklistAsync(harness, "original");
        var before = await SnapshotAsync(harness);
        await using var update = harness.CreateScope();
        await using var delete = harness.CreateScope();
        harness.Race.Arm();
        var updateTask = ExecuteChecklistUpdateAsync(update, () => update.Subresources.UpdateChecklistAsync(harness.Graph.Task.Id, item.Id, new UpdateTaskChecklistRequest("updated", true, item.Version)));
        var deleteTask = ExecuteChecklistDeleteAsync(delete, () => delete.Subresources.DeleteChecklistAsync(harness.Graph.Task.Id, item.Id, item.Version));
        var results = await Task.WhenAll(updateTask, deleteTask);
        var loser = AssertOneWinner(results);
        Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());

        await using var verify = harness.CreateScope();
        var persisted = await verify.Db.TaskChecklistItems.SingleOrDefaultAsync(value => value.Id == item.Id);
        if (persisted is null)
            await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskChecklistDeleted", 1, 1);
        else
        {
            Assert.Equal("updated", persisted.Text);
            Assert.True(persisted.IsCompleted);
            Assert.Equal(harness.Graph.User.Id, persisted.CompletedByUserId);
            await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskChecklistUpdated", 1, 1);
        }
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task Checklist_DeleteVsDelete_OneAtomicWinner()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var item = await CreateChecklistAsync(harness, "delete twice");
        var before = await SnapshotAsync(harness);
        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();
        harness.Race.Arm();
        var results = await Task.WhenAll(
            ExecuteAsync(first, () => first.Subresources.DeleteChecklistAsync(harness.Graph.Task.Id, item.Id, item.Version)),
            ExecuteAsync(second, () => second.Subresources.DeleteChecklistAsync(harness.Graph.Task.Id, item.Id, item.Version)));
        var loser = AssertOneWinner(results.Select(value => (value.Scope, value.Result.IsSuccess, value.Result.Error)).ToArray());
        Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());

        await using var verify = harness.CreateScope();
        Assert.Null(await verify.Db.TaskChecklistItems.SingleOrDefaultAsync(value => value.Id == item.Id));
        await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskChecklistDeleted", 1, 1);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ChildDetailMutation_ParentVersionAuditAndOutboxCommitOrRollbackTogether()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        await using var creator = harness.CreateScope();
        var created = await creator.Subresources.CreateSubtaskAsync(harness.Graph.Task.Id, new CreateTaskSubtaskRequest("child", null, TaskPriority.Medium));
        Assert.True(created.IsSuccess);
        var child = created.Value!;

        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();
        harness.Race.Arm();
        var results = await Task.WhenAll(
            ExecuteAsync(first, () => first.Commands.UpdateDetailsAsync(child.Id, Details(child.Title, child.Version, TaskPriority.Medium, 25, new DateOnly(2026, 7, 27), new DateOnly(2026, 7, 28)))),
            ExecuteAsync(second, () => second.Commands.UpdateDetailsAsync(child.Id, Details(child.Title, child.Version, TaskPriority.Medium, 75, new DateOnly(2026, 7, 29), new DateOnly(2026, 7, 30)))));

        Assert.Equal(1, results.Count(result => result.Result.IsSuccess));
        var loser = results.Single(result => !result.Result.IsSuccess);
        Assert.Equal("TASK_STALE_VERSION", Code(loser.Result.Error));
        Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());

        await using var verify = harness.CreateScope();
        var persistedChild = await verify.Db.TaskItems.SingleAsync(item => item.Id == child.Id);
        var persistedParent = await verify.Db.TaskItems.SingleAsync(item => item.Id == harness.Graph.Task.Id);
        Assert.Equal(2, persistedChild.VersionNo);
        Assert.Equal(3, persistedParent.VersionNo);
        Assert.Equal(2, await verify.Db.AuditLogs.CountAsync(log => log.EntityId == child.Id));
        Assert.Equal(2, await verify.Db.AuditLogs.CountAsync(log => log.EntityId == persistedParent.Id && log.Action == "TaskSubtasksChanged"));
        Assert.Equal(2, await verify.Db.OutboxEvents.CountAsync(evt => evt.AggregateId == child.Id));
        Assert.Equal(2, await verify.Db.OutboxEvents.CountAsync(evt => evt.AggregateId == persistedParent.Id));
        var detail = (await verify.Commands.GetAsync(persistedParent.Id)).Value!;
        Assert.Equal(persistedChild.ProgressPercent, detail.ProgressPercent);
        Assert.Equal(persistedChild.PlannedStartDate, detail.PlannedStartDate);
        Assert.Equal(persistedChild.PlannedEndDate, detail.PlannedEndDate);

        await using var retry = harness.CreateScope();
        var authoritative = (await retry.Commands.GetAsync(child.Id)).Value!;
        var retried = await retry.Commands.UpdateDetailsAsync(child.Id, Details(child.Title, authoritative.Version, TaskPriority.Medium, 60, new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 2)));
        Assert.True(retried.IsSuccess);
        await using var afterRetry = harness.CreateScope();
        var retriedChild = await afterRetry.Db.TaskItems.SingleAsync(item => item.Id == child.Id);
        var retriedParent = await afterRetry.Db.TaskItems.SingleAsync(item => item.Id == harness.Graph.Task.Id);
        Assert.Equal(3, retriedChild.VersionNo);
        Assert.Equal(4, retriedParent.VersionNo);
        Assert.Equal(60, retriedChild.ProgressPercent);
        Assert.Equal(60, (await afterRetry.Commands.GetAsync(retriedParent.Id)).Value!.ProgressPercent);
        Assert.Single(await afterRetry.Db.OutboxEvents.Where(value => value.AggregateId == retriedChild.Id && value.AggregateVersion == retriedChild.VersionNo).ToListAsync());
        Assert.Single(await afterRetry.Db.OutboxEvents.Where(value => value.AggregateId == retriedParent.Id && value.AggregateVersion == retriedParent.VersionNo).ToListAsync());
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ChildTransitionRace_ParentAndChildCommitTogether()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var child = await CreateSubtaskAsync(harness, "transition child");
        var result = await AssertChildMutationRaceAsync(
            harness, child.Id, child.Version, "TaskTransitioned",
            scope => scope.Commands.TransitionAsync(child.Id, new TaskTransitionRequest(harness.Graph.DoneStage.Id, child.Version)));
        Assert.Equal(TaskItemStatus.Completed, result.Child.Status);
        Assert.Equal(100, result.Child.ProgressPercent);
        await using var verify = harness.CreateScope();
        Assert.Equal(100, (await verify.Commands.GetAsync(harness.Graph.Task.Id)).Value!.ProgressPercent);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ChildCancelRace_ParentAndChildCommitTogether()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var child = await CreateSubtaskAsync(harness, "cancel child");
        var result = await AssertChildMutationRaceAsync(
            harness, child.Id, child.Version, "TaskTransitioned",
            scope => scope.Commands.CancelAsync(child.Id, new TaskReviewRequest(child.Version, "duplicate cancellation")));
        Assert.Equal(TaskItemStatus.Cancelled, result.Child.Status);
        await using var verify = harness.CreateScope();
        Assert.Equal(0, (await verify.Commands.GetAsync(harness.Graph.Task.Id)).Value!.ProgressPercent);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ChildReopenRace_ParentAndChildCommitTogether()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var child = await CreateSubtaskAsync(harness, "reopen child");
        await using (var complete = harness.CreateScope())
        {
            Assert.True((await complete.Commands.TransitionAsync(child.Id, new TaskTransitionRequest(harness.Graph.DoneStage.Id, child.Version))).IsSuccess);
        }
        var completed = await TaskRowAsync(harness, child.Id);
        var result = await AssertChildMutationRaceAsync(
            harness, child.Id, completed.VersionNo, "TaskTransitioned",
            scope => scope.Commands.ReopenAsync(child.Id, new TaskReviewRequest(completed.VersionNo)));
        Assert.Equal(TaskItemStatus.NotStarted, result.Child.Status);
        await using var verify = harness.CreateScope();
        Assert.Equal(0, (await verify.Commands.GetAsync(harness.Graph.Task.Id)).Value!.ProgressPercent);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ChildDeleteRace_ParentAndChildCommitTogether()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var child = await CreateSubtaskAsync(harness, "delete child");
        var result = await AssertChildMutationRaceAsync(
            harness, child.Id, child.Version, "TaskDeleted",
            scope => scope.Commands.DeleteAsync(child.Id, new TaskDeleteRequest(child.Version)));
        Assert.NotNull(result.Child.DeletedAt);
        await using var verify = harness.CreateScope();
        Assert.Empty((await verify.Subresources.ListSubtasksAsync(harness.Graph.Task.Id)).Value!.Items);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ChildRestoreRace_ParentAndChildCommitTogether()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var child = await CreateSubtaskAsync(harness, "restore child");
        await using (var delete = harness.CreateScope())
        {
            Assert.True((await delete.Commands.DeleteAsync(child.Id, new TaskDeleteRequest(child.Version))).IsSuccess);
        }
        var deleted = await TaskRowAsync(harness, child.Id);
        var result = await AssertChildMutationRaceAsync(
            harness, child.Id, deleted.VersionNo, "TaskRestored",
            scope => scope.Commands.RestoreAsync(child.Id, new TaskRestoreRequest(deleted.VersionNo)),
            includeDeleted: true);
        Assert.Null(result.Child.DeletedAt);
        await using var verify = harness.CreateScope();
        Assert.Single((await verify.Subresources.ListSubtasksAsync(harness.Graph.Task.Id)).Value!.Items);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task Comment_UpdateDeleteAndLegacyAdapterRemainAtomicAndPrivate()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var created = await CreateCommentAsync(harness, "sensitive @mention text");
        var before = await SnapshotAsync(harness);
        CommentRaceOperation winner;

        await using (var update = harness.CreateScope())
        await using (var delete = harness.CreateScope())
        {
            harness.Race.Arm();
            var updateTask = ExecuteCommentUpdateAsync(update, () => update.Subresources.UpdateCommentAsync(created.Id, new UpdateTaskCommentRequest("winner body", null, created.Version)));
            var deleteTask = ExecuteCommentDeleteAsync(delete, () => delete.Subresources.DeleteCommentAsync(created.Id, created.Version));
            var results = await Task.WhenAll(updateTask, deleteTask);
            Assert.Equal(1, results.Count(result => result.IsSuccess));
            winner = results.Single(result => result.IsSuccess).Operation;
            var loser = results.Single(result => !result.IsSuccess);
            Assert.Equal("TASK_STALE_VERSION", Code(loser.Error));
            Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());
        }

        await using (var verify = harness.CreateScope())
        {
            var row = await verify.Db.TaskComments.SingleAsync(comment => comment.Id == created.Id);
            Assert.Equal(2, row.VersionNo);
            if (winner == CommentRaceOperation.Update)
            {
                Assert.Null(row.DeletedAt);
                Assert.Null(row.DeletedByUserId);
                Assert.Equal("winner body", row.BodyPlainText);
                await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskCommentUpdated", 1, 1);
            }
            else
            {
                Assert.NotNull(row.DeletedAt);
                Assert.Equal(harness.Graph.User.Id, row.DeletedByUserId);
                await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskCommentDeleted", 1, 1);
            }
            var commentActions = new[] { "TaskCommentCreated", "TaskCommentUpdated", "TaskCommentDeleted" };
            var audit = await verify.Db.AuditLogs.Where(log => log.EntityId == harness.Graph.Task.Id && commentActions.Contains(log.Action)).ToListAsync();
            Assert.All(audit, log => Assert.DoesNotContain("sensitive", $"{log.Summary} {log.MetadataJson}", StringComparison.OrdinalIgnoreCase));
        }

        // The compatibility read returns the canonical row; it never materializes a generic Comment.
        await using var compatibility = harness.CreateScope();
        var canonical = await compatibility.Subresources.GetCommentForCompatibilityAsync(created.Id);
        Assert.True(canonical.IsSuccess);
        if (winner == CommentRaceOperation.Update)
            Assert.Equal("winner body", canonical.Value!.BodyPlainText);
        else
            Assert.Null(canonical.Value!.BodyPlainText);
        Assert.Equal(0, await compatibility.Db.Comments.CountAsync(comment => comment.TargetType == CommentTargetType.TaskItem && comment.TargetId == harness.Graph.Task.Id));
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task Comment_UpdateVsUpdate_OneWinnerCanAuthoritativelyRetry()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var comment = await CreateCommentAsync(harness, "original body");
        var before = await SnapshotAsync(harness);
        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();
        harness.Race.Arm();
        var firstTask = ExecuteAsync(first, () => first.Subresources.UpdateCommentAsync(comment.Id, new UpdateTaskCommentRequest("first body", true, comment.Version)));
        var secondTask = ExecuteAsync(second, () => second.Subresources.UpdateCommentAsync(comment.Id, new UpdateTaskCommentRequest("second body", false, comment.Version)));
        var results = await Task.WhenAll(firstTask, secondTask);
        var winner = results.Single(value => value.Result.IsSuccess);
        var loser = results.Single(value => !value.Result.IsSuccess);
        Assert.Equal("TASK_STALE_VERSION", Code(loser.Result.Error));
        Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());

        await using (var verify = harness.CreateScope())
        {
            var persisted = await verify.Db.TaskComments.SingleAsync(value => value.Id == comment.Id);
            Assert.Equal(winner.Result.Value!.BodyPlainText, persisted.BodyPlainText);
            Assert.Equal(winner.Result.Value.IsImportant, persisted.IsImportant);
            Assert.Equal(comment.Version + 1, persisted.VersionNo);
            await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskCommentUpdated", 1, 1);
        }

        await using var retry = harness.CreateScope();
        var current = (await retry.Subresources.GetCommentForCompatibilityAsync(comment.Id)).Value!;
        var retried = await retry.Subresources.UpdateCommentAsync(comment.Id, new UpdateTaskCommentRequest("retry body", null, current!.Version));
        Assert.True(retried.IsSuccess);
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task Comment_DeleteVsDelete_OneTombstoneWinnerAndNoAuditBody()
    {
        await using var harness = await ServiceHarness.CreateAsync();
        var body = $"sensitive-marker @{{{harness.Graph.MentionUser.Id}}}";
        var comment = await CreateCommentAsync(harness, body);
        var before = await SnapshotAsync(harness);
        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();
        harness.Race.Arm();
        var results = await Task.WhenAll(
            ExecuteAsync(first, () => first.Subresources.DeleteCommentAsync(comment.Id, comment.Version)),
            ExecuteAsync(second, () => second.Subresources.DeleteCommentAsync(comment.Id, comment.Version)));
        var loser = AssertOneWinner(results.Select(value => (value.Scope, value.Result.IsSuccess, value.Result.Error)).ToArray());
        Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());

        await using var verify = harness.CreateScope();
        var persisted = await verify.Db.TaskComments.SingleAsync(value => value.Id == comment.Id);
        Assert.NotNull(persisted.DeletedAt);
        Assert.Equal(harness.Graph.User.Id, persisted.DeletedByUserId);
        Assert.Equal(comment.Version + 1, persisted.VersionNo);
        await AssertDeltaAsync(verify.Db, before, harness.Graph.Task.Id, "TaskCommentDeleted", 1, 1);
        var audit = await verify.Db.AuditLogs.Where(log => log.EntityId == harness.Graph.Task.Id && log.Action == "TaskCommentDeleted").ToListAsync();
        Assert.All(audit, log =>
        {
            var text = $"{log.Summary} {log.MetadataJson}";
            Assert.DoesNotContain(body, text, StringComparison.Ordinal);
            Assert.DoesNotContain("sensitive-marker", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("@{", text, StringComparison.Ordinal);
        });
    }

    private static TaskUpdateDetailsRequest Details(
        string title,
        long expectedVersion,
        TaskPriority priority = TaskPriority.Medium,
        int progress = 0,
        DateOnly? plannedStart = null,
        DateOnly? plannedEnd = null) =>
        new(title, null, priority, plannedStart, plannedEnd, progress, expectedVersion);

    private static async Task<(RequestScope Scope, AipPortal.Application.Common.Result<T> Result)> ExecuteAsync<T>(
        RequestScope scope,
        Func<Task<AipPortal.Application.Common.Result<T>>> command) =>
        (scope, await command());

    private static async Task<(RequestScope Scope, AipPortal.Application.Common.Result Result)> ExecuteAsync(
        RequestScope scope,
        Func<Task<AipPortal.Application.Common.Result>> command) =>
        (scope, await command());

    private static async Task<(CommentRaceOperation Operation, RequestScope Scope, bool IsSuccess, string? Error)> ExecuteCommentUpdateAsync(
        RequestScope scope,
        Func<Task<AipPortal.Application.Common.Result<TaskCommentResponse>>> command)
    {
        var result = await command();
        return (CommentRaceOperation.Update, scope, result.IsSuccess, result.Error);
    }

    private static async Task<(CommentRaceOperation Operation, RequestScope Scope, bool IsSuccess, string? Error)> ExecuteCommentDeleteAsync(
        RequestScope scope,
        Func<Task<AipPortal.Application.Common.Result>> command)
    {
        var result = await command();
        return (CommentRaceOperation.Delete, scope, result.IsSuccess, result.Error);
    }

    private static async Task<(RequestScope Scope, bool IsSuccess, string? Error)> ExecuteChecklistUpdateAsync(
        RequestScope scope,
        Func<Task<AipPortal.Application.Common.Result<TaskChecklistResponse>>> command)
    {
        var result = await command();
        return (scope, result.IsSuccess, result.Error);
    }

    private static async Task<(RequestScope Scope, bool IsSuccess, string? Error)> ExecuteChecklistDeleteAsync(
        RequestScope scope,
        Func<Task<AipPortal.Application.Common.Result>> command)
    {
        var result = await command();
        return (scope, result.IsSuccess, result.Error);
    }

    private static (RequestScope Scope, bool IsSuccess, string? Error) AssertOneWinner(
        IReadOnlyList<(RequestScope Scope, bool IsSuccess, string? Error)> results)
    {
        Assert.Equal(1, results.Count(value => value.IsSuccess));
        var loser = results.Single(value => !value.IsSuccess);
        Assert.Equal("TASK_STALE_VERSION", Code(loser.Error));
        return loser;
    }

    private static async Task<SideEffectSnapshot> SnapshotAsync(ServiceHarness harness)
    {
        await using var scope = harness.CreateScope();
        return await SnapshotAsync(scope.Db, harness.Graph.Task.Id);
    }

    private static async Task<SideEffectSnapshot> SnapshotAsync(AppDbContext db, Guid taskId)
    {
        var task = await db.TaskItems.SingleAsync(value => value.Id == taskId);
        var audit = await db.AuditLogs.Where(value => value.EntityId == taskId).ToListAsync();
        return new SideEffectSnapshot(
            task.VersionNo,
            audit.Count,
            await db.OutboxEvents.CountAsync(value => value.AggregateId == taskId),
            audit.GroupBy(value => value.Action).ToDictionary(group => group.Key, group => group.Count()));
    }

    private static async Task<TaskSubtaskResponse> CreateSubtaskAsync(ServiceHarness harness, string title)
    {
        await using var scope = harness.CreateScope();
        var result = await scope.Subresources.CreateSubtaskAsync(harness.Graph.Task.Id, new CreateTaskSubtaskRequest(title, null, TaskPriority.Medium));
        Assert.True(result.IsSuccess);
        return result.Value!;
    }

    private static async Task<TaskItem> TaskRowAsync(ServiceHarness harness, Guid taskId)
    {
        await using var scope = harness.CreateScope();
        return await scope.Db.TaskItems.SingleAsync(value => value.Id == taskId);
    }

    private static async Task<(TaskItem Child, TaskItem Parent)> AssertChildMutationRaceAsync(
        ServiceHarness harness,
        Guid childId,
        long expectedVersion,
        string childAction,
        Func<RequestScope, Task<AipPortal.Application.Common.Result<TaskCommandResponse>>> command,
        bool includeDeleted = false)
    {
        var beforeChild = await TaskRowAsync(harness, childId);
        var beforeParent = await TaskRowAsync(harness, harness.Graph.Task.Id);
        await using var baseline = harness.CreateScope();
        var childAuditCount = await baseline.Db.AuditLogs.CountAsync(value => value.EntityId == childId && value.Action == childAction);
        var parentAuditCount = await baseline.Db.AuditLogs.CountAsync(value => value.EntityId == harness.Graph.Task.Id && value.Action == "TaskSubtasksChanged");
        var childOutboxCount = await baseline.Db.OutboxEvents.CountAsync(value => value.AggregateId == childId && value.EventType == "Projects.TaskChanged.v1");
        var parentOutboxCount = await baseline.Db.OutboxEvents.CountAsync(value => value.AggregateId == harness.Graph.Task.Id && value.EventType == "Projects.TaskChanged.v1");
        await using var first = harness.CreateScope();
        await using var second = harness.CreateScope();
        if (includeDeleted)
        {
            Assert.Equal(expectedVersion, await first.Db.TaskItems.Where(value => value.Id == childId).Select(value => value.VersionNo).SingleAsync());
            Assert.Equal(expectedVersion, await second.Db.TaskItems.Where(value => value.Id == childId).Select(value => value.VersionNo).SingleAsync());
        }
        else
        {
            Assert.Equal(expectedVersion, (await first.Commands.GetAsync(childId)).Value!.Version);
            Assert.Equal(expectedVersion, (await second.Commands.GetAsync(childId)).Value!.Version);
        }
        harness.Race.Arm();
        var results = await Task.WhenAll(ExecuteAsync(first, () => command(first)), ExecuteAsync(second, () => command(second)));
        var loser = results.Single(value => !value.Result.IsSuccess);
        Assert.Equal(1, results.Count(value => value.Result.IsSuccess));
        Assert.Equal("TASK_STALE_VERSION", Code(loser.Result.Error));
        Assert.Empty(loser.Scope.Db.ChangeTracker.Entries());

        await using var verify = harness.CreateScope();
        var child = await verify.Db.TaskItems.SingleAsync(value => value.Id == childId);
        var parent = await verify.Db.TaskItems.SingleAsync(value => value.Id == harness.Graph.Task.Id);
        Assert.Equal(beforeChild.VersionNo + 1, child.VersionNo);
        Assert.Equal(beforeParent.VersionNo + 1, parent.VersionNo);
        Assert.Equal(childAuditCount + 1, await verify.Db.AuditLogs.CountAsync(value => value.EntityId == childId && value.Action == childAction));
        Assert.Equal(parentAuditCount + 1, await verify.Db.AuditLogs.CountAsync(value => value.EntityId == parent.Id && value.Action == "TaskSubtasksChanged"));
        Assert.Equal(childOutboxCount + 1, await verify.Db.OutboxEvents.CountAsync(value => value.AggregateId == childId && value.EventType == "Projects.TaskChanged.v1"));
        Assert.Equal(parentOutboxCount + 1, await verify.Db.OutboxEvents.CountAsync(value => value.AggregateId == parent.Id && value.EventType == "Projects.TaskChanged.v1"));
        Assert.Single(await verify.Db.OutboxEvents.Where(value => value.AggregateId == childId && value.AggregateVersion == child.VersionNo && value.EventType == "Projects.TaskChanged.v1").ToListAsync());
        Assert.Single(await verify.Db.OutboxEvents.Where(value => value.AggregateId == parent.Id && value.AggregateVersion == parent.VersionNo && value.EventType == "Projects.TaskChanged.v1").ToListAsync());
        Assert.Equal("unrelated", await verify.Db.TaskItems.Where(item => item.Id == harness.Graph.UnrelatedTask.Id).Select(item => item.Title).SingleAsync());
        return (child, parent);
    }

    private static async Task AssertDeltaAsync(
        AppDbContext db,
        SideEffectSnapshot before,
        Guid taskId,
        string action,
        int auditDelta,
        int outboxDelta)
    {
        Assert.Equal(auditDelta, outboxDelta);
        await AssertTaskMutationSequenceAsync(db, before, taskId, Enumerable.Repeat(action, auditDelta).ToArray());
    }

    private static async Task AssertTaskMutationSequenceAsync(
        AppDbContext db,
        SideEffectSnapshot before,
        Guid taskId,
        IReadOnlyList<string> expectedAuditActions)
    {
        var task = await db.TaskItems.SingleAsync(value => value.Id == taskId);
        Assert.Equal(before.TaskVersion + expectedAuditActions.Count, task.VersionNo);

        var audit = await db.AuditLogs.Where(value => value.EntityId == taskId).ToListAsync();
        Assert.Equal(before.AuditCount + expectedAuditActions.Count, audit.Count);
        foreach (var expected in expectedAuditActions.GroupBy(value => value))
            Assert.Equal(before.AuditActionCounts.GetValueOrDefault(expected.Key) + expected.Count(), audit.Count(value => value.Action == expected.Key));

        var outbox = await db.OutboxEvents
            .Where(value => value.AggregateId == taskId && value.EventType == "Projects.TaskChanged.v1")
            .ToListAsync();
        Assert.Equal(before.OutboxCount + expectedAuditActions.Count, outbox.Count);
        var newEvents = outbox.Where(value => value.AggregateVersion > before.TaskVersion).OrderBy(value => value.AggregateVersion).ToList();
        Assert.Equal(expectedAuditActions.Count, newEvents.Count);
        Assert.Equal(Enumerable.Range(1, expectedAuditActions.Count).Select(offset => before.TaskVersion + offset), newEvents.Select(value => value.AggregateVersion!.Value));
        foreach (var value in newEvents)
        {
            Assert.Equal("Task", value.AggregateType);
            Assert.Equal(taskId, value.AggregateId);
            Assert.Equal("Projects.TaskChanged.v1", value.EventType);
            using var payload = JsonDocument.Parse(value.PayloadJson);
            Assert.True(payload.RootElement.TryGetProperty("taskVersion", out var payloadVersion));
            Assert.Equal(value.AggregateVersion!.Value, payloadVersion.GetInt64());
        }
    }

    private static string? Code(string? error) => error?.Split('|', 2)[0];

    private enum CommentRaceOperation { Update, Delete }

    private sealed record SideEffectSnapshot(long TaskVersion, int AuditCount, int OutboxCount, IReadOnlyDictionary<string, int> AuditActionCounts);

    private static async Task<TaskChecklistResponse> CreateChecklistAsync(ServiceHarness harness, string text)
    {
        await using var scope = harness.CreateScope();
        var result = await scope.Subresources.CreateChecklistAsync(harness.Graph.Task.Id, new CreateTaskChecklistRequest(text));
        Assert.True(result.IsSuccess);
        return result.Value!;
    }

    private static async Task<TaskCommentResponse> CreateCommentAsync(ServiceHarness harness, string text)
    {
        await using var scope = harness.CreateScope();
        var result = await scope.Subresources.CreateCommentAsync(harness.Graph.Task.Id, new CreateTaskCommentRequest(text));
        Assert.True(result.IsSuccess);
        return result.Value!;
    }

    private static async Task<(IReadOnlyList<TaskChecklistResponse> Items, long TaskVersion)> ChecklistAsync(ServiceHarness harness)
    {
        await using var scope = harness.CreateScope();
        var checklist = await scope.Subresources.ListChecklistAsync(harness.Graph.Task.Id);
        var task = (await scope.Commands.GetAsync(harness.Graph.Task.Id)).Value!;
        return (checklist.Value!, task.Version);
    }

    private sealed class ServiceHarness : IAsyncDisposable
    {
        private readonly ServiceProvider provider;
        private readonly string connectionString;

        private ServiceHarness(ServiceProvider provider, string connectionString, Graph graph, SaveRaceCoordinator race)
        {
            this.provider = provider;
            this.connectionString = connectionString;
            Graph = graph;
            Race = race;
        }

        public Graph Graph { get; }
        public SaveRaceCoordinator Race { get; }

        public static async Task<ServiceHarness> CreateAsync()
        {
            var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
            var graph = await SeedAsync(connectionString);
            var race = new SaveRaceCoordinator();
            var services = new ServiceCollection();
            services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connectionString));
            services.AddScoped<CurrentTenantService>();
            services.AddScoped<ICurrentTenant>(serviceProvider => serviceProvider.GetRequiredService<CurrentTenantService>());
            services.AddScoped<ICurrentUser>(_ => new TestCurrentUser(graph.User.Id));
            services.AddScoped<IClock, FixedClock>();
            services.AddScoped<IProjectRepository, ProjectRepository>();
            services.AddScoped<IUserRepository, UserRepository>();
            services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
            services.AddScoped<IGroupRepository, GroupRepository>();
            services.AddScoped<IFileRepository, FileRepository>();
            services.AddScoped<IFileAuthorizationService, DenyingFileAuthorizationService>();
            services.AddScoped<IOutboxEventRepository, OutboxEventRepository>();
            services.AddScoped<ITransactionalOutbox, TransactionalOutbox>();
            services.AddScoped<IBusinessInvalidationPublisher, BusinessInvalidationPublisher>();
            services.AddScoped<INotificationService, NoopNotificationService>();
            services.AddScoped<IAuthorizationStateChangePublisher, NoopAuthorizationStateChangePublisher>();
            services.AddScoped<IAuditLogger, DbAuditLogger>();
            services.AddScoped<EfUnitOfWork>();
            services.AddScoped<IUnitOfWork>(serviceProvider => serviceProvider.GetRequiredService<EfUnitOfWork>());
            services.AddScoped<ITaskCommandUnitOfWork>(serviceProvider => new CoordinatedTaskCommandUnitOfWork(
                serviceProvider.GetRequiredService<EfUnitOfWork>(), race));
            services.AddScoped<IWorkspaceAuthorizationService, WorkspaceAuthorizationService>();
            services.AddScoped<IGroupAuthorizationService, GroupAuthorizationService>();
            services.AddScoped<ProjectAuthorizationService>();
            services.AddScoped<IProjectAuthorizationService>(serviceProvider => serviceProvider.GetRequiredService<ProjectAuthorizationService>());
            services.AddScoped<ITaskAuthorizationService>(serviceProvider => serviceProvider.GetRequiredService<ProjectAuthorizationService>());
            services.AddScoped<ICommentAuthorizationService>(serviceProvider => serviceProvider.GetRequiredService<ProjectAuthorizationService>());
            services.AddSingleton(new CommunicationSafetyOptions());
            services.AddSingleton<ICommunicationSafetyGuard, InMemoryCommunicationSafetyGuard>();
            services.AddScoped<ITaskWorkspaceTimeZoneResolver, UtcTimeZoneResolver>();
            services.AddScoped<ITaskCommandService, TaskCommandService>();
            services.AddScoped<ITaskSubresourceService, TaskSubresourceService>();
            services.AddScoped<IProjectService, ProjectService>();
            return new ServiceHarness(services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true }), connectionString, graph, race);
        }

        public RequestScope CreateScope()
        {
            var scope = provider.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<CurrentTenantService>().SetTenant(Graph.Tenant.Id, Graph.Tenant.Slug);
            return new RequestScope(scope, scope.ServiceProvider.GetRequiredService<AppDbContext>(), scope.ServiceProvider.GetRequiredService<ITaskCommandService>(), scope.ServiceProvider.GetRequiredService<ITaskSubresourceService>(), scope.ServiceProvider.GetRequiredService<IProjectService>());
        }

        public async ValueTask DisposeAsync()
        {
            Race.Dispose();
            await provider.DisposeAsync();
        }

        private static async Task<Graph> SeedAsync(string connectionString)
        {
            var suffix = Guid.NewGuid().ToString("N");
            await using var platform = CreatePlatformContext(connectionString);
            var tenant = new Tenant { Name = $"Task concurrency {suffix}", DisplayName = "Task concurrency", Slug = $"task-concurrency-{suffix}" };
            var user = new User { DisplayName = "Task concurrency user", Email = $"task-concurrency-{suffix}@example.test", NormalizedEmail = $"TASK-CONCURRENCY-{suffix}@EXAMPLE.TEST", PasswordHash = "hash", Status = UserStatus.Active };
            var mentionUser = new User { DisplayName = "Mentionable user", Email = $"task-concurrency-mention-{suffix}@example.test", NormalizedEmail = $"TASK-CONCURRENCY-MENTION-{suffix}@EXAMPLE.TEST", PasswordHash = "hash", Status = UserStatus.Active };
            platform.AddRange(tenant, user, mentionUser);
            await platform.SaveChangesAsync();

            var currentTenant = new CurrentTenantService();
            currentTenant.SetTenant(tenant.Id, tenant.Slug);
            await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options, currentTenant);
            var workspace = new Workspace { TenantId = tenant.Id, Name = "Task concurrency workspace", Slug = $"task-concurrency-ws-{suffix}", CreatedByUserId = user.Id };
            var project = new Project { TenantId = tenant.Id, WorkspaceId = workspace.Id, OwnerUserId = user.Id, CreatedByUserId = user.Id, Name = "Task concurrency project", Slug = $"task-concurrency-project-{suffix}" };
            var workflow = new TaskWorkflowDefinition { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, Name = "Task concurrency workflow", ReviewEnforcementEnabled = false };
            var todo = new TaskWorkflowStage { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, DefinitionId = workflow.Id, Name = "Todo", InternalCategory = TaskStageCategory.Todo, SortKey = 1024, IsInitialStage = true };
            var inProgress = new TaskWorkflowStage { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, DefinitionId = workflow.Id, Name = "In progress", InternalCategory = TaskStageCategory.InProgress, SortKey = 2048 };
            var done = new TaskWorkflowStage { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, DefinitionId = workflow.Id, Name = "Done", InternalCategory = TaskStageCategory.Done, SortKey = 3072, IsTerminalStage = true };
            var cancelled = new TaskWorkflowStage { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, DefinitionId = workflow.Id, Name = "Cancelled", InternalCategory = TaskStageCategory.Cancelled, SortKey = 4096, IsTerminalStage = true };
            var task = new TaskItem { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, Title = "original", CreatedByUserId = user.Id, WorkflowStageId = todo.Id, Status = TaskItemStatus.NotStarted, VersionNo = 1 };
            var unrelated = new TaskItem { TenantId = tenant.Id, WorkspaceId = workspace.Id, ProjectId = project.Id, Title = "unrelated", CreatedByUserId = user.Id, VersionNo = 1 };
            db.AddRange(workspace, project, workflow, todo, inProgress, done, cancelled, task, unrelated,
                new TenantUser { TenantId = tenant.Id, UserId = user.Id, Role = TenantUserRole.Member, Status = TenantUserStatus.Active, JoinedAt = DateTimeOffset.UtcNow },
                new TenantUser { TenantId = tenant.Id, UserId = mentionUser.Id, Role = TenantUserRole.Member, Status = TenantUserStatus.Active, JoinedAt = DateTimeOffset.UtcNow },
                new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = user.Id, Role = WorkspaceRole.Owner, Status = MembershipStatus.Active, JoinedAt = DateTimeOffset.UtcNow },
                new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = mentionUser.Id, Role = WorkspaceRole.Member, Status = MembershipStatus.Active, JoinedAt = DateTimeOffset.UtcNow },
                new ProjectMember { TenantId = tenant.Id, ProjectId = project.Id, UserId = user.Id, Role = ProjectRole.Owner, JoinedAt = DateTimeOffset.UtcNow },
                new ProjectMember { TenantId = tenant.Id, ProjectId = project.Id, UserId = mentionUser.Id, Role = ProjectRole.Contributor, JoinedAt = DateTimeOffset.UtcNow },
                TaskWatchStateInitializer.ForCreator(task, user.Id, new DateTimeOffset(2026, 7, 26, 0, 0, 0, TimeSpan.Zero)));
            await db.SaveChangesAsync();
            return new Graph(tenant, user, mentionUser, task, unrelated, todo, inProgress, done, cancelled);
        }

        private static AppDbContext CreatePlatformContext(string connectionString)
        {
            var tenant = new CurrentTenantService();
            tenant.SetPlatformScope();
            return new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options, tenant);
        }
    }

    private sealed record Graph(
        Tenant Tenant,
        User User,
        User MentionUser,
        TaskItem Task,
        TaskItem UnrelatedTask,
        TaskWorkflowStage TodoStage,
        TaskWorkflowStage InProgressStage,
        TaskWorkflowStage DoneStage,
        TaskWorkflowStage CancelledStage);

    private sealed record RequestScope(AsyncServiceScope Scope, AppDbContext Db, ITaskCommandService Commands, ITaskSubresourceService Subresources, IProjectService Compatibility) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => Scope.DisposeAsync();
    }

    private sealed class TestCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId => userId;
        public Guid? SessionId => null;
        public string? Email => "task-concurrency@example.test";
        public SystemRole? SystemRole => null;
        public bool IsAuthenticated => true;
    }

    private sealed class UtcTimeZoneResolver : ITaskWorkspaceTimeZoneResolver
    {
        public Task<TimeZoneInfo> ResolveAsync(Guid tenantId, Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult(TimeZoneInfo.Utc);
    }

    /// <summary>Never authorizes file access; file commands are outside this focused harness.</summary>
    private sealed class DenyingFileAuthorizationService : IFileAuthorizationService
    {
        public Task<bool> CanUploadAttachment(Guid userId, AttachmentOwnerType ownerType, Guid ownerId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanViewWorkspaceFiles(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanViewAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanDownloadAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanDeleteAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default) => Task.FromResult(false);
    }

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => new(2026, 7, 26, 0, 0, 0, TimeSpan.Zero);
    }

    private sealed class NoopNotificationService : INotificationService
    {
        public Task NotifyAsync(Guid recipientUserId, string title, string? body, string sourceType, Guid sourceId, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class NoopAuthorizationStateChangePublisher : IAuthorizationStateChangePublisher
    {
        public Task PublishAsync(Guid tenantId, Guid affectedUserId, string scopeType, Guid? scopeId, string change, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class SaveRaceCoordinator : IDisposable
    {
        private readonly object gate = new();
        private TaskCompletionSource? release;
        private int remaining;

        public void Arm()
        {
            lock (gate)
            {
                if (remaining != 0)
                    throw new InvalidOperationException("The previous save race has not completed.");

                remaining = 2;
                release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

        public async Task WaitBeforeSaveAsync(CancellationToken cancellationToken)
        {
            Task? wait = null;
            lock (gate)
            {
                if (remaining == 0)
                    return;

                remaining--;
                if (remaining == 0)
                {
                    release!.TrySetResult();
                    release = null;
                    return;
                }

                wait = release!.Task;
            }

            await wait.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);
        }

        public void Dispose()
        {
            lock (gate)
            {
                release?.TrySetCanceled();
                release = null;
                remaining = 0;
            }
        }
    }

    private sealed class CoordinatedTaskCommandUnitOfWork(EfUnitOfWork inner, SaveRaceCoordinator coordinator) : ITaskCommandUnitOfWork
    {
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => inner.SaveChangesAsync(cancellationToken);

        public async Task<TaskCommandSaveResult> SaveTaskCommandAsync(CancellationToken cancellationToken = default)
        {
            await coordinator.WaitBeforeSaveAsync(cancellationToken);
            return await inner.SaveTaskCommandAsync(cancellationToken);
        }
    }
}
