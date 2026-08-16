using AipPortal.Application.Workspaces;
using AipPortal.Web.Models;
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

    [HttpGet("api/workspaces/archived")]
    public async Task<IActionResult> ListArchived(CancellationToken cancellationToken)
    {
        var result = await workspaces.ListArchivedAsync(cancellationToken);
        return result.IsSuccess
            ? Ok(result.Value)
            : ToWpcError(result.ErrorDetail, result.Error, "Archived Workspaces could not be listed.");
    }

    [HttpGet("api/workspaces/capabilities")]
    public async Task<IActionResult> Capabilities(CancellationToken cancellationToken)
    {
        var result = await workspaces.GetCapabilitiesAsync(cancellationToken);
        return result.IsSuccess
            ? Ok(ApiEnvelope.Success(HttpContext, result.Value!))
            : ToWpcError(result.ErrorDetail, result.Error, "Workspace capabilities could not be evaluated.");
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
            return CreatedAtAction(
                nameof(Get),
                new { workspaceId = result.Value!.Id },
                ApiEnvelope.Success(HttpContext, result.Value));
        }

        return ToWpcError(result.ErrorDetail, result.Error, "Workspace creation failed.");
    }

    private IActionResult ToWpcError(
        AipPortal.Application.Common.ApplicationErrorDetail? detail,
        string? fallbackError,
        string fallbackMessage)
    {
        var sourceCode = detail?.Code ?? "ValidationFailed";
        var redactionApplied = sourceCode == "NotFound";
        var code = redactionApplied ? "NotFound" : sourceCode;
        var message = redactionApplied
            ? "The requested resource was not found."
            : detail?.Message ?? fallbackError ?? fallbackMessage;
        var target = detail?.Target ?? (sourceCode switch
        {
            "CapabilityDenied" => "workspace",
            "IdempotencyConflict" => "header.Idempotency-Key",
            _ => null
        });
        var status = sourceCode switch
        {
            "AuthenticationRequired" => StatusCodes.Status401Unauthorized,
            "CapabilityDenied" or "TenantMembershipRequired" => StatusCodes.Status403Forbidden,
            "NotFound" => StatusCodes.Status404NotFound,
            "IdempotencyConflict" or "ConcurrentModification" or "InvalidStateTransition" => StatusCodes.Status409Conflict,
            "DependencyUnavailable" => StatusCodes.Status503ServiceUnavailable,
            _ => StatusCodes.Status400BadRequest
        };
        var payload = ApiEnvelope.Error(HttpContext, status, code, message, target, redactionApplied);
        return sourceCode switch
        {
            "AuthenticationRequired" => Unauthorized(payload),
            "CapabilityDenied" or "TenantMembershipRequired" => StatusCode(status, payload),
            "NotFound" => NotFound(payload),
            "IdempotencyConflict" or "ConcurrentModification" or "InvalidStateTransition" => Conflict(payload),
            "DependencyUnavailable" => StatusCode(status, payload),
            _ => BadRequest(payload)
        };
    }

    [HttpGet("api/workspaces/{workspaceId:guid}")]
    public async Task<IActionResult> Get(Guid workspaceId, CancellationToken cancellationToken)
    {
        var result = await workspaces.GetAsync(workspaceId, cancellationToken);
        return result.IsSuccess
            ? Ok(result.Value)
            : ToWpcError(result.ErrorDetail, result.Error, "Workspace could not be read.");
    }

    [HttpPatch("api/workspaces/{workspaceId:guid}")]
    public async Task<IActionResult> Update(Guid workspaceId, UpdateWorkspaceRequest request, CancellationToken cancellationToken)
    {
        var result = await workspaces.UpdateAsync(workspaceId, request, cancellationToken);
        return result.IsSuccess
            ? Ok(result.Value)
            : ToWpcError(result.ErrorDetail, result.Error, "Workspace update failed.");
    }

    [HttpDelete("api/workspaces/{workspaceId:guid}")]
    public async Task<IActionResult> Delete(Guid workspaceId, CancellationToken cancellationToken)
    {
        return await ArchiveResult(workspaceId, cancellationToken);
    }

    [HttpPost("api/workspaces/{workspaceId:guid}/archive")]
    public async Task<IActionResult> Archive(Guid workspaceId, CancellationToken cancellationToken)
    {
        return await ArchiveResult(workspaceId, cancellationToken);
    }

    [HttpPost("api/workspaces/{workspaceId:guid}/restore")]
    public async Task<IActionResult> Restore(Guid workspaceId, CancellationToken cancellationToken)
    {
        var result = await workspaces.RestoreAsync(workspaceId, cancellationToken);
        return result.IsSuccess
            ? Ok(new { status = "OK" })
            : ToWpcError(result.ErrorDetail, result.Error, "Workspace restore failed.");
    }

    [HttpGet("api/workspaces/{workspaceId:guid}/members")]
    public async Task<IActionResult> ListMembers(Guid workspaceId, CancellationToken cancellationToken)
    {
        var result = await workspaces.ListMembersAsync(workspaceId, cancellationToken);
        return result.IsSuccess
            ? Ok(result.Value)
            : ToWpcError(result.ErrorDetail, result.Error, "Workspace members could not be read.");
    }

    [HttpPost("api/workspaces/{workspaceId:guid}/members")]
    public async Task<IActionResult> AddMember(Guid workspaceId, AddWorkspaceMemberRequest request, CancellationToken cancellationToken)
    {
        var result = await workspaces.AddMemberAsync(workspaceId, request, cancellationToken);
        return result.IsSuccess
            ? Ok(result.Value)
            : ToWpcError(result.ErrorDetail, result.Error, "Workspace member could not be added.");
    }

    [HttpPatch("api/workspaces/{workspaceId:guid}/members/{userId:guid}")]
    public async Task<IActionResult> UpdateMember(Guid workspaceId, Guid userId, UpdateWorkspaceMemberRequest request, CancellationToken cancellationToken)
    {
        var result = await workspaces.UpdateMemberAsync(workspaceId, userId, request, cancellationToken);
        return result.IsSuccess
            ? Ok(result.Value)
            : ToWpcError(result.ErrorDetail, result.Error, "Workspace member could not be updated.");
    }

    [HttpDelete("api/workspaces/{workspaceId:guid}/members/{userId:guid}")]
    public async Task<IActionResult> RemoveMember(Guid workspaceId, Guid userId, CancellationToken cancellationToken)
    {
        var result = await workspaces.RemoveMemberAsync(workspaceId, userId, cancellationToken);
        return result.IsSuccess
            ? Ok(new { status = "OK" })
            : ToWpcError(result.ErrorDetail, result.Error, "Workspace member could not be removed.");
    }

    private async Task<IActionResult> ArchiveResult(Guid workspaceId, CancellationToken cancellationToken)
    {
        var result = await workspaces.ArchiveAsync(workspaceId, cancellationToken);
        return result.IsSuccess
            ? Ok(new { status = "OK" })
            : ToWpcError(result.ErrorDetail, result.Error, "Workspace archive failed.");
    }

    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result)
    {
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }
}
