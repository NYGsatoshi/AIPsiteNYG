using AipPortal.Application.Workspaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class WorkspacesController(IWorkspaceService workspaces) : ControllerBase
{
    [HttpGet("api/workspaces")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        return ToActionResult(await workspaces.ListAsync(cancellationToken));
    }

    [HttpGet("api/workspaces/capabilities")]
    public async Task<IActionResult> Capabilities(CancellationToken cancellationToken)
    {
        return ToActionResult(await workspaces.GetCapabilitiesAsync(cancellationToken));
    }

    [HttpPost("api/workspaces")]
    public async Task<IActionResult> Create(
        CreateWorkspaceRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        var result = await workspaces.CreateAsync(request, idempotencyKey, cancellationToken);
        if (result.IsSuccess)
        {
            return CreatedAtAction(nameof(Get), new { workspaceId = result.Value!.Id }, result.Value);
        }

        var payload = new
        {
            requestId = HttpContext.TraceIdentifier,
            error = new
            {
                code = result.ErrorDetail?.Code ?? "ValidationFailed",
                message = result.ErrorDetail?.Message ?? result.Error ?? "Workspace creation failed.",
                target = "workspace",
                details = Array.Empty<object>(),
                redactionApplied = false
            }
        };
        return result.ErrorDetail?.Code switch
        {
            "AuthenticationRequired" => Unauthorized(payload),
            "CapabilityDenied" => StatusCode(StatusCodes.Status403Forbidden, payload),
            "IdempotencyConflict" or "IdempotencyReplayUnavailable" => Conflict(payload),
            "IdempotencyUnavailable" or "InitializationUnavailable" => StatusCode(StatusCodes.Status503ServiceUnavailable, payload),
            _ => BadRequest(payload)
        };
    }

    [HttpGet("api/workspaces/{workspaceId:guid}")]
    public async Task<IActionResult> Get(Guid workspaceId, CancellationToken cancellationToken)
    {
        return ToActionResult(await workspaces.GetAsync(workspaceId, cancellationToken));
    }

    [HttpPatch("api/workspaces/{workspaceId:guid}")]
    public async Task<IActionResult> Update(Guid workspaceId, UpdateWorkspaceRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await workspaces.UpdateAsync(workspaceId, request, cancellationToken));
    }

    [HttpDelete("api/workspaces/{workspaceId:guid}")]
    public async Task<IActionResult> Delete(Guid workspaceId, CancellationToken cancellationToken)
    {
        var result = await workspaces.ArchiveAsync(workspaceId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    [HttpPost("api/workspaces/{workspaceId:guid}/archive")]
    public async Task<IActionResult> Archive(Guid workspaceId, CancellationToken cancellationToken)
    {
        var result = await workspaces.ArchiveAsync(workspaceId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    [HttpPost("api/workspaces/{workspaceId:guid}/restore")]
    public async Task<IActionResult> Restore(Guid workspaceId, CancellationToken cancellationToken)
    {
        var result = await workspaces.RestoreAsync(workspaceId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    [HttpGet("api/workspaces/{workspaceId:guid}/members")]
    public async Task<IActionResult> ListMembers(Guid workspaceId, CancellationToken cancellationToken)
    {
        return ToActionResult(await workspaces.ListMembersAsync(workspaceId, cancellationToken));
    }

    [HttpPost("api/workspaces/{workspaceId:guid}/members")]
    public async Task<IActionResult> AddMember(Guid workspaceId, AddWorkspaceMemberRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await workspaces.AddMemberAsync(workspaceId, request, cancellationToken));
    }

    [HttpPatch("api/workspaces/{workspaceId:guid}/members/{userId:guid}")]
    public async Task<IActionResult> UpdateMember(Guid workspaceId, Guid userId, UpdateWorkspaceMemberRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await workspaces.UpdateMemberAsync(workspaceId, userId, request, cancellationToken));
    }

    [HttpDelete("api/workspaces/{workspaceId:guid}/members/{userId:guid}")]
    public async Task<IActionResult> RemoveMember(Guid workspaceId, Guid userId, CancellationToken cancellationToken)
    {
        var result = await workspaces.RemoveMemberAsync(workspaceId, userId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result)
    {
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }
}
