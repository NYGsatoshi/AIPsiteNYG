using System.Reflection;
using System.Text.Json;
using AipPortal.Application.Common;
using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Web.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Tests.Projects;

public sealed class TaskExecutionControllerTests
{
    [Fact]
    [Trait("Scope", "Issue357")]
    public async Task RequestRunReturnsCreatedForTheRecordedFailClosedRuntimeOutcome()
    {
        var run = new TaskExecutionRunResponse(
            Guid.NewGuid(),
            TaskExecutionRunStatus.RuntimeUnavailable,
            "TASK_EXECUTION_RUNTIME_UNAVAILABLE",
            new DateTimeOffset(2026, 8, 25, 8, 30, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 8, 25, 8, 30, 0, TimeSpan.Zero),
            TaskExecutionRun.SnapshotSchemaVersion1,
            TaskExecutionScopeOrigin.ProjectDefault,
            1,
            null,
            false,
            false);
        var service = new StubTaskExecutionScopeService
        {
            RunResult = Result<TaskExecutionRunResponse>.Success(run)
        };
        var controller = Controller(service);

        var action = await controller.RequestRun(
            Guid.NewGuid(),
            new RequestTaskExecutionRunRequest(),
            "controller-run-0001",
            CancellationToken.None);

        var response = Assert.IsType<ObjectResult>(action);
        Assert.Equal(StatusCodes.Status201Created, response.StatusCode);
        var body = Assert.IsType<TaskExecutionRunResponse>(response.Value);
        Assert.Equal(run.Id, body.Id);
        Assert.Equal(TaskExecutionRunStatus.RuntimeUnavailable, body.Status);
        Assert.Equal("TASK_EXECUTION_RUNTIME_UNAVAILABLE", body.FailureCode);
    }

    [Fact]
    [Trait("Scope", "Issue357")]
    public async Task RequestRunMapsUnavailableResourcesToTheSafeRedactedNotFoundEnvelope()
    {
        var service = new StubTaskExecutionScopeService
        {
            RunResult = Failure<TaskExecutionRunResponse>("TASK_EXECUTION_NOT_FOUND")
        };
        var controller = Controller(service);

        var action = await controller.RequestRun(
            Guid.NewGuid(),
            new RequestTaskExecutionRunRequest(),
            "controller-run-0002",
            CancellationToken.None);

        var response = Assert.IsType<ObjectResult>(action);
        Assert.Equal(StatusCodes.Status404NotFound, response.StatusCode);
        var payload = JsonSerializer.Serialize(response.Value);
        Assert.Contains("TASK_EXECUTION_NOT_FOUND", payload, StringComparison.Ordinal);
        Assert.Contains("\"redactionApplied\":true", payload, StringComparison.Ordinal);
        Assert.DoesNotContain("taskItemId", payload, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    [Trait("Scope", "Issue357")]
    public async Task TaskOverrideConflictMapsToConflictAndTheEndpointRequiresAuthentication()
    {
        var service = new StubTaskExecutionScopeService
        {
            UpdateOverrideResult = Failure<TaskExecutionScopeResponse>("TASK_EXECUTION_STALE_VERSION")
        };
        var controller = Controller(service);
        var action = await controller.UpdateTaskOverride(
            Guid.NewGuid(),
            new UpdateTaskExecutionScopeOverrideRequest(true, false, ExpectedVersion: 1),
            CancellationToken.None);

        var response = Assert.IsType<ObjectResult>(action);
        Assert.Equal(StatusCodes.Status409Conflict, response.StatusCode);
        var authorize = typeof(TaskExecutionController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(authorize);
        var route = typeof(TaskExecutionController)
            .GetMethod(nameof(TaskExecutionController.RequestRun))!
            .GetCustomAttribute<HttpPostAttribute>();
        Assert.NotNull(route);
        Assert.Equal("api/tasks/{taskItemId:guid}/execution-runs", route!.Template);
    }

    private static TaskExecutionController Controller(ITaskExecutionScopeService service) => new(service)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                TraceIdentifier = "issue357-controller-test"
            }
        }
    };

    private static Result<T> Failure<T>(string code) =>
        Result<T>.Failure(new ApplicationErrorDetail(code, "The request could not be completed."));

    private sealed class StubTaskExecutionScopeService : ITaskExecutionScopeService
    {
        public Result<ProjectExecutionScopeResponse> ProjectResult { get; set; } = Failure<ProjectExecutionScopeResponse>("TASK_EXECUTION_NOT_FOUND");
        public Result<TaskExecutionScopeResponse> TaskResult { get; set; } = Failure<TaskExecutionScopeResponse>("TASK_EXECUTION_NOT_FOUND");
        public Result<TaskExecutionRunResponse> RunResult { get; set; } = Failure<TaskExecutionRunResponse>("TASK_EXECUTION_NOT_FOUND");
        public Result<TaskExecutionScopeResponse> UpdateOverrideResult { get; set; } = Failure<TaskExecutionScopeResponse>("TASK_EXECUTION_NOT_FOUND");

        public Task<Result<ProjectExecutionScopeResponse>> GetProjectScopeAsync(Guid projectId, CancellationToken cancellationToken = default) =>
            Task.FromResult(ProjectResult);

        public Task<Result<ProjectExecutionScopeResponse>> UpdateProjectScopeAsync(Guid projectId, UpdateProjectExecutionScopeRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult(ProjectResult);

        public Task<Result<TaskExecutionScopeResponse>> GetTaskScopeAsync(Guid taskItemId, CancellationToken cancellationToken = default) =>
            Task.FromResult(TaskResult);

        public Task<Result<TaskExecutionScopeResponse>> UpdateTaskOverrideAsync(Guid taskItemId, UpdateTaskExecutionScopeOverrideRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult(UpdateOverrideResult);

        public Task<Result<TaskExecutionScopeResponse>> ClearTaskOverrideAsync(Guid taskItemId, ClearTaskExecutionScopeOverrideRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult(TaskResult);

        public Task<Result<TaskExecutionRunResponse>> RequestRunAsync(Guid taskItemId, string? idempotencyKey, CancellationToken cancellationToken = default) =>
            Task.FromResult(RunResult);
    }
}
