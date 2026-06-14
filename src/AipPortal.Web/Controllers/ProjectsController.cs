using AipPortal.Application.Projects;
using AipPortal.Domain.Enums;
using AipPortal.Web.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class ProjectsController(IProjectService projects) : ControllerBase
{
    [HttpGet("api/projects")]
    public async Task<IActionResult> List([FromQuery] ProjectListQuery query, CancellationToken cancellationToken) => ToActionResult(await projects.ListAsync(query, cancellationToken));

    [HttpPost("api/projects")]
    public async Task<IActionResult> Create(CreateProjectRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.CreateAsync(request, cancellationToken));

    [HttpGet("api/projects/{projectId:guid}")]
    public async Task<IActionResult> Get(Guid projectId, CancellationToken cancellationToken) => ToActionResult(await projects.GetAsync(projectId, cancellationToken));

    [HttpPatch("api/projects/{projectId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, UpdateProjectRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.UpdateAsync(projectId, request, cancellationToken));

    [HttpDelete("api/projects/{projectId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, CancellationToken cancellationToken) => OkOrBad(await projects.ArchiveAsync(projectId, cancellationToken));

    [HttpPost("api/projects/{projectId:guid}/archive")]
    public async Task<IActionResult> Archive(Guid projectId, CancellationToken cancellationToken) => OkOrBad(await projects.ArchiveAsync(projectId, cancellationToken));

    [HttpPost("api/projects/{projectId:guid}/restore")]
    public async Task<IActionResult> Restore(Guid projectId, CancellationToken cancellationToken) => OkOrBad(await projects.RestoreAsync(projectId, cancellationToken));

    [HttpGet("api/projects/{projectId:guid}/members")]
    public async Task<IActionResult> ListMembers(Guid projectId, CancellationToken cancellationToken) => ToActionResult(await projects.ListMembersAsync(projectId, cancellationToken));

    [HttpPost("api/projects/{projectId:guid}/members")]
    public async Task<IActionResult> AddMember(Guid projectId, AddProjectMemberRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.AddMemberAsync(projectId, request, cancellationToken));

    [HttpPatch("api/projects/{projectId:guid}/members/{userId:guid}")]
    public async Task<IActionResult> UpdateMember(Guid projectId, Guid userId, UpdateProjectMemberRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.UpdateMemberAsync(projectId, userId, request, cancellationToken));

    [HttpDelete("api/projects/{projectId:guid}/members/{userId:guid}")]
    public async Task<IActionResult> RemoveMember(Guid projectId, Guid userId, CancellationToken cancellationToken) => OkOrBad(await projects.RemoveMemberAsync(projectId, userId, cancellationToken));

    [HttpGet("api/projects/{projectId:guid}/milestones")]
    public async Task<IActionResult> ListMilestones(Guid projectId, [FromQuery] ProjectChildListQuery query, CancellationToken cancellationToken) => ToActionResult(await projects.ListMilestonesAsync(projectId, query, cancellationToken));

    [HttpPost("api/projects/{projectId:guid}/milestones")]
    public async Task<IActionResult> CreateMilestone(Guid projectId, CreateMilestoneRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.CreateMilestoneAsync(projectId, request, cancellationToken));

    [HttpGet("api/milestones/{milestoneId:guid}")]
    public async Task<IActionResult> GetMilestone(Guid milestoneId, CancellationToken cancellationToken) => ToActionResult(await projects.GetMilestoneAsync(milestoneId, cancellationToken));

    [HttpPatch("api/milestones/{milestoneId:guid}")]
    public async Task<IActionResult> UpdateMilestone(Guid milestoneId, UpdateMilestoneRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.UpdateMilestoneAsync(milestoneId, request, cancellationToken));

    [HttpDelete("api/milestones/{milestoneId:guid}")]
    public async Task<IActionResult> DeleteMilestone(Guid milestoneId, CancellationToken cancellationToken) => OkOrBad(await projects.DeleteMilestoneAsync(milestoneId, cancellationToken));

    [HttpGet("api/projects/{projectId:guid}/tasks")]
    public async Task<IActionResult> ListTasks(Guid projectId, [FromQuery] ProjectChildListQuery query, CancellationToken cancellationToken) => ToActionResult(await projects.ListTasksAsync(projectId, query, cancellationToken));

    [HttpPost("api/projects/{projectId:guid}/tasks")]
    public async Task<IActionResult> CreateTask(Guid projectId, CreateTaskItemRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.CreateTaskAsync(projectId, request, cancellationToken));

    [HttpGet("api/tasks/{taskItemId:guid}")]
    public async Task<IActionResult> GetTask(Guid taskItemId, CancellationToken cancellationToken) => ToActionResult(await projects.GetTaskAsync(taskItemId, cancellationToken));

    [HttpPatch("api/tasks/{taskItemId:guid}")]
    public async Task<IActionResult> UpdateTask(Guid taskItemId, UpdateTaskItemRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.UpdateTaskAsync(taskItemId, request, cancellationToken));

    [HttpDelete("api/tasks/{taskItemId:guid}")]
    public async Task<IActionResult> DeleteTask(Guid taskItemId, CancellationToken cancellationToken) => OkOrBad(await projects.DeleteTaskAsync(taskItemId, cancellationToken));

    [HttpGet("api/tasks/{taskItemId:guid}/assignments")]
    public async Task<IActionResult> ListAssignments(Guid taskItemId, CancellationToken cancellationToken) => ToActionResult(await projects.ListAssignmentsAsync(taskItemId, cancellationToken));

    [HttpPost("api/tasks/{taskItemId:guid}/assignments")]
    public async Task<IActionResult> AddAssignment(Guid taskItemId, AddTaskAssignmentRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.AddAssignmentAsync(taskItemId, request, cancellationToken));

    [HttpPatch("api/tasks/{taskItemId:guid}/assignments/{assignmentId:guid}")]
    public async Task<IActionResult> UpdateAssignment(Guid assignmentId, UpdateTaskAssignmentRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.UpdateAssignmentAsync(assignmentId, request, cancellationToken));

    [HttpDelete("api/tasks/{taskItemId:guid}/assignments/{assignmentId:guid}")]
    public async Task<IActionResult> DeleteAssignment(Guid assignmentId, CancellationToken cancellationToken) => OkOrBad(await projects.DeleteAssignmentAsync(assignmentId, cancellationToken));

    [HttpGet("api/tasks/{taskItemId:guid}/dependencies")]
    public async Task<IActionResult> ListDependencies(Guid taskItemId, CancellationToken cancellationToken) => ToActionResult(await projects.ListDependenciesAsync(taskItemId, cancellationToken));

    [HttpPost("api/tasks/{taskItemId:guid}/dependencies")]
    public async Task<IActionResult> AddDependency(Guid taskItemId, AddTaskDependencyRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.AddDependencyAsync(taskItemId, request, cancellationToken));

    [HttpDelete("api/tasks/{taskItemId:guid}/dependencies/{dependencyId:guid}")]
    public async Task<IActionResult> DeleteDependency(Guid dependencyId, CancellationToken cancellationToken) => OkOrBad(await projects.DeleteDependencyAsync(dependencyId, cancellationToken));

    [HttpGet("api/comments")]
    public async Task<IActionResult> ListComments([FromQuery] CommentTargetType targetType, [FromQuery] Guid targetId, [FromQuery] ProjectChildListQuery query, CancellationToken cancellationToken) => ToActionResult(await projects.ListCommentsAsync(targetType, targetId, query, cancellationToken));

    [HttpPost("api/comments")]
    public async Task<IActionResult> AddComment(CreateCommentRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.AddCommentAsync(request, cancellationToken));

    [HttpPatch("api/comments/{commentId:guid}")]
    public async Task<IActionResult> UpdateComment(Guid commentId, UpdateCommentRequest request, CancellationToken cancellationToken) => ToActionResult(await projects.UpdateCommentAsync(commentId, request, cancellationToken));

    [HttpDelete("api/comments/{commentId:guid}")]
    public async Task<IActionResult> DeleteComment(Guid commentId, CancellationToken cancellationToken) => OkOrBad(await projects.DeleteCommentAsync(commentId, cancellationToken));

    private IActionResult OkOrBad(AipPortal.Application.Common.Result result) => result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(ToErrorResponse(result.Error));
    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result) => result.IsSuccess ? Ok(result.Value) : BadRequest(ToErrorResponse(result.Error));
    private ErrorResponse ToErrorResponse(string? message) => new("BadRequest", message ?? "The request could not be completed.", HttpContext.TraceIdentifier);
}
