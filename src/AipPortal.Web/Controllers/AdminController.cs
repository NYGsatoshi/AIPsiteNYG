using AipPortal.Application.Admin;
using AipPortal.Application.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize(Roles = "PlatformAdmin,SystemAdmin")]
[Route("api/admin")]
public sealed class AdminController(IAdminService adminService) : ControllerBase
{
    [HttpGet("users")]
    public async Task<IActionResult> ListUsers([FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken cancellationToken = default)
    {
        return ToActionResult(await adminService.ListUsersAsync(page, pageSize, cancellationToken));
    }

    [HttpGet("users/{userId:guid}")]
    public async Task<IActionResult> GetUser(Guid userId, CancellationToken cancellationToken)
    {
        return ToActionResult(await adminService.GetUserAsync(userId, cancellationToken));
    }

    [HttpPatch("users/{userId:guid}")]
    public async Task<IActionResult> UpdateUser(Guid userId, UpdateAdminUserRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await adminService.UpdateUserAsync(userId, request, cancellationToken));
    }

    [HttpPost("users/{userId:guid}/suspend")]
    public async Task<IActionResult> SuspendUser(Guid userId, CancellationToken cancellationToken)
    {
        return ToStatusResult(await adminService.SuspendUserAsync(userId, cancellationToken));
    }

    [HttpPost("users/{userId:guid}/activate")]
    public async Task<IActionResult> ActivateUser(Guid userId, CancellationToken cancellationToken)
    {
        return ToStatusResult(await adminService.ActivateUserAsync(userId, cancellationToken));
    }

    [HttpPost("users/{userId:guid}/reset-password-invite")]
    public async Task<IActionResult> ResetPasswordInvite(Guid userId, CancellationToken cancellationToken)
    {
        return ToStatusResult(await adminService.ResetPasswordInviteAsync(userId, cancellationToken));
    }

    [HttpDelete("users/{userId:guid}")]
    public async Task<IActionResult> ArchiveUser(Guid userId, CancellationToken cancellationToken)
    {
        return ToStatusResult(await adminService.ArchiveUserAsync(userId, cancellationToken));
    }

    [HttpPatch("users/{userId:guid}/system-role")]
    public async Task<IActionResult> ChangeSystemRole(Guid userId, ChangeSystemRoleRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await adminService.ChangeSystemRoleAsync(userId, request, cancellationToken));
    }

    [HttpGet("invites")]
    public async Task<IActionResult> ListInvites([FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken cancellationToken = default)
    {
        return ToActionResult(await adminService.ListInvitesAsync(page, pageSize, cancellationToken));
    }

    [HttpPost("invites")]
    public async Task<IActionResult> CreateInvite(CreateInviteRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await adminService.CreateInviteAsync(request, cancellationToken));
    }

    [HttpPost("invites/{inviteId:guid}/revoke")]
    public async Task<IActionResult> RevokeInvite(Guid inviteId, CancellationToken cancellationToken)
    {
        return ToStatusResult(await adminService.RevokeInviteAsync(inviteId, cancellationToken));
    }

    [HttpPost("invites/bulk")]
    public async Task<IActionResult> BulkCreateInvites(BulkCreateInviteRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await adminService.BulkCreateInvitesAsync(request, cancellationToken));
    }

    [HttpGet("settings")]
    public async Task<IActionResult> ListSettings(CancellationToken cancellationToken)
    {
        return ToActionResult(await adminService.ListSettingsAsync(cancellationToken));
    }

    [HttpGet("settings/{key}")]
    public async Task<IActionResult> GetSetting(string key, CancellationToken cancellationToken)
    {
        return ToActionResult(await adminService.GetSettingAsync(key, cancellationToken));
    }

    [HttpPatch("settings/{key}")]
    public async Task<IActionResult> UpdateSetting(string key, UpdateSystemSettingRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await adminService.UpdateSettingAsync(key, request, cancellationToken));
    }

    [HttpPost("lifecycle/workspaces/{workspaceId:guid}/archive")]
    public async Task<IActionResult> ArchiveWorkspace(Guid workspaceId, CancellationToken cancellationToken)
    {
        return ToStatusResult(await adminService.ArchiveWorkspaceAsync(workspaceId, cancellationToken));
    }

    [HttpPost("lifecycle/groups/{groupId:guid}/archive")]
    public async Task<IActionResult> ArchiveGroup(Guid groupId, CancellationToken cancellationToken)
    {
        return ToStatusResult(await adminService.ArchiveGroupAsync(groupId, cancellationToken));
    }

    [HttpPost("lifecycle/projects/{projectId:guid}/archive")]
    public async Task<IActionResult> ArchiveProject(Guid projectId, CancellationToken cancellationToken)
    {
        return ToStatusResult(await adminService.ArchiveProjectAsync(projectId, cancellationToken));
    }

    [HttpPost("lifecycle/channels/{channelId:guid}/archive")]
    public async Task<IActionResult> ArchiveChannel(Guid channelId, CancellationToken cancellationToken)
    {
        return ToStatusResult(await adminService.ArchiveChannelAsync(channelId, cancellationToken));
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard(CancellationToken cancellationToken)
    {
        return ToActionResult(await adminService.GetDashboardAsync(cancellationToken));
    }

    private IActionResult ToActionResult<T>(Result<T> result)
    {
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    private IActionResult ToStatusResult(Result result)
    {
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }
}
