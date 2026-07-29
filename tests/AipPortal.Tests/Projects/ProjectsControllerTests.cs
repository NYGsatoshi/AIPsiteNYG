using System.Reflection;
using AipPortal.Application.Common;
using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Web.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Tests.Projects;

public sealed class ProjectsControllerTests
{
    [Fact]
    public void GenericTaskConflictMapsToHttp409()
    {
        var action = InvokeGenericTaskResult(Result<string>.Failure("TASK_CONFLICT|Conflict"));

        Assert.Equal(StatusCodes.Status409Conflict, Assert.IsType<ObjectResult>(action).StatusCode);
    }

    [Fact]
    public void NonGenericTaskConflictMapsToHttp409()
    {
        var action = InvokeTaskResult(Result.Failure("TASK_CONFLICT|Conflict"));

        Assert.Equal(StatusCodes.Status409Conflict, Assert.IsType<ObjectResult>(action).StatusCode);
    }

    [Theory]
    [InlineData("KANBAN_NOT_FOUND", StatusCodes.Status404NotFound)]
    [InlineData("KANBAN_FORBIDDEN", StatusCodes.Status403Forbidden)]
    [InlineData("KANBAN_STALE_BOARD", StatusCodes.Status409Conflict)]
    [InlineData("KANBAN_INVALID_POSITION", StatusCodes.Status422UnprocessableEntity)]
    public void KanbanErrorsUseTheCanonicalPrivacyAndConflictStatus(string code, int expectedStatus)
    {
        var action = InvokeGenericTaskResult(Result<string>.Failure($"{code}|Kanban request failed."));

        Assert.Equal(expectedStatus, Assert.IsType<ObjectResult>(action).StatusCode);
    }

    [Theory]
    [InlineData(false, false, WorkItemWatchAutomaticSource.None, false)]
    [InlineData(false, false, WorkItemWatchAutomaticSource.Collaborator, true)]
    [InlineData(false, true, WorkItemWatchAutomaticSource.Collaborator, false)]
    [InlineData(true, true, WorkItemWatchAutomaticSource.None, true)]
    public void WatchStateNormalizationUsesManualIntentAndOptOut(bool manual, bool optOut, WorkItemWatchAutomaticSource sources, bool expected)
    {
        Assert.Equal(expected, TaskWatchStateRules.IsWatching(manual, optOut, sources));
    }

    private static IActionResult InvokeTaskResult(Result result)
    {
        var controller = Controller();
        var method = typeof(ProjectsController).GetMethods(BindingFlags.Instance | BindingFlags.NonPublic)
            .Single(candidate => candidate.Name == "ToTaskActionResult" && !candidate.IsGenericMethod && candidate.GetParameters()[0].ParameterType == typeof(Result));
        return Assert.IsAssignableFrom<IActionResult>(method.Invoke(controller, [result]));
    }

    private static IActionResult InvokeGenericTaskResult(Result<string> result)
    {
        var controller = Controller();
        var method = typeof(ProjectsController).GetMethods(BindingFlags.Instance | BindingFlags.NonPublic)
            .Single(candidate => candidate.Name == "ToTaskActionResult" && candidate.IsGenericMethod)
            .MakeGenericMethod(typeof(string));
        return Assert.IsAssignableFrom<IActionResult>(method.Invoke(controller, [result]));
    }

    private static ProjectsController Controller() => new(null!, null!, null!, null!)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
    };
}
