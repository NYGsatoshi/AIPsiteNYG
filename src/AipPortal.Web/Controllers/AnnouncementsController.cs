using AipPortal.Application.Announcements;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class AnnouncementsController(
    IAnnouncementService announcements,
    IAnnouncementAudienceService audiences) : ControllerBase
{
    [HttpGet("api/announcements")]
    public async Task<IActionResult> List([FromQuery] AnnouncementListQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(await announcements.ListAsync(query, cancellationToken));
    }

    [HttpGet("api/announcements/audiences")]
    public async Task<IActionResult> Audiences(CancellationToken cancellationToken)
    {
        return ToActionResult(await audiences.ListAsync(cancellationToken));
    }

    [HttpPost("api/announcements")]
    public async Task<IActionResult> Create(CreateAnnouncementRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await announcements.CreateAsync(request, cancellationToken));
    }

    [HttpGet("api/announcements/{announcementId:guid}")]
    public async Task<IActionResult> Get(Guid announcementId, CancellationToken cancellationToken)
    {
        return ToActionResult(await announcements.GetAsync(announcementId, cancellationToken));
    }

    [HttpPatch("api/announcements/{announcementId:guid}")]
    public async Task<IActionResult> Update(Guid announcementId, UpdateAnnouncementRequest request, CancellationToken cancellationToken)
    {
        return ToActionResult(await announcements.UpdateAsync(announcementId, request, cancellationToken));
    }

    [HttpDelete("api/announcements/{announcementId:guid}")]
    public async Task<IActionResult> Delete(Guid announcementId, CancellationToken cancellationToken)
    {
        var result = await announcements.DeleteAsync(announcementId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    [HttpPost("api/announcements/{announcementId:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid announcementId, CancellationToken cancellationToken)
    {
        var result = await announcements.MarkReadAsync(announcementId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    [HttpGet("api/announcements/{announcementId:guid}/read-status")]
    public async Task<IActionResult> ReadStatus(Guid announcementId, CancellationToken cancellationToken)
    {
        return ToActionResult(await announcements.GetReadStatusAsync(announcementId, cancellationToken));
    }

    [HttpPost("api/announcements/{announcementId:guid}/resend-unread")]
    public async Task<IActionResult> ResendUnread(Guid announcementId, CancellationToken cancellationToken)
    {
        var result = await announcements.ResendUnreadAsync(announcementId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result)
    {
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }
}
