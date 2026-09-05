using AipPortal.Application.Announcements;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class AnnouncementsController(
    IAnnouncementService announcements,
    IAnnouncementAnalyticsService analytics,
    IAnnouncementAudienceService audiences,
    IAnnouncementDraftService drafts) : ControllerBase
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
        // Re-resolve only the selected scope at publication time. This prevents a
        // stale review from targeting a scope after authorization/lifecycle changes
        // without re-enumerating every visible Audience and recipient count.
        var authorization = await audiences.IsAuthorizedAsync(
            request.WorkspaceId,
            request.GroupId,
            request.ChannelId,
            cancellationToken);
        if (!authorization.IsSuccess || authorization.Value != true)
        {
            return BadRequest(new { error = "Announcement audience is not authorized." });
        }

        return ToActionResult(await announcements.CreateAsync(request, cancellationToken));
    }

    [HttpGet("api/announcement-drafts")]
    public async Task<IActionResult> ListDrafts(CancellationToken cancellationToken)
    {
        return ToWorkflowActionResult(await drafts.ListMineAsync(cancellationToken));
    }

    [HttpPost("api/announcement-drafts")]
    public async Task<IActionResult> CreateDraft(
        CreateAnnouncementDraftRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        var result = await drafts.CreateAsync(request, idempotencyKey ?? string.Empty, cancellationToken);
        return result.IsSuccess
            ? CreatedAtAction(nameof(GetDraft), new { draftId = result.Value!.Id }, result.Value)
            : ToWorkflowActionResult(result);
    }

    [HttpGet("api/announcement-drafts/{draftId:guid}")]
    public async Task<IActionResult> GetDraft(Guid draftId, CancellationToken cancellationToken)
    {
        return ToWorkflowActionResult(await drafts.GetAsync(draftId, cancellationToken));
    }

    [HttpPut("api/announcement-drafts/{draftId:guid}")]
    public async Task<IActionResult> SaveDraft(
        Guid draftId,
        SaveAnnouncementDraftRequest request,
        CancellationToken cancellationToken)
    {
        return ToWorkflowActionResult(await drafts.SaveAsync(draftId, request, cancellationToken));
    }

    [HttpPost("api/announcement-drafts/{draftId:guid}/publish")]
    public async Task<IActionResult> PublishDraft(
        Guid draftId,
        PublishAnnouncementDraftRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        return ToWorkflowActionResult(await drafts.PublishNowAsync(
            draftId,
            request,
            idempotencyKey ?? string.Empty,
            cancellationToken));
    }

    [HttpPost("api/announcement-drafts/{draftId:guid}/schedule")]
    public async Task<IActionResult> ScheduleDraft(
        Guid draftId,
        ScheduleAnnouncementDraftRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        return ToWorkflowActionResult(await drafts.ScheduleAsync(
            draftId,
            request,
            idempotencyKey ?? string.Empty,
            cancellationToken));
    }

    [HttpGet("api/announcements/{announcementId:guid}")]
    public async Task<IActionResult> Get(Guid announcementId, CancellationToken cancellationToken)
    {
        return ToActionResult(await announcements.GetAsync(announcementId, cancellationToken));
    }

    [HttpGet("api/announcements/{announcementId:guid}/analytics")]
    public async Task<IActionResult> Analytics(Guid announcementId, CancellationToken cancellationToken)
    {
        return ToActionResult(await analytics.GetAsync(announcementId, cancellationToken));
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

    [HttpPost("api/announcements/{announcementId:guid}/acknowledge")]
    public async Task<IActionResult> Acknowledge(Guid announcementId, CancellationToken cancellationToken)
    {
        var result = await analytics.AcknowledgeAsync(announcementId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    [HttpPost("api/announcements/{announcementId:guid}/cta-click")]
    public async Task<IActionResult> TrackCtaClick(Guid announcementId, CancellationToken cancellationToken)
    {
        var result = await analytics.TrackCtaClickAsync(announcementId, cancellationToken);
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

    private IActionResult ToWorkflowActionResult<T>(AipPortal.Application.Common.Result<T> result)
    {
        if (result.IsSuccess)
        {
            return Ok(result.Value);
        }

        // The legacy announcement controller uses a broad 400 error mapping.
        // Keep redaction consistent for denied/not-found drafts while exposing
        // explicit client-recoverable conflict semantics for optimistic edits
        // and idempotent replay mismatches.
        var code = result.ErrorDetail?.Code;
        return code is "ANNOUNCEMENT_DRAFT_STALE" or "ANNOUNCEMENT_DRAFT_IDEMPOTENCY_CONFLICT"
            ? Conflict(new { error = result.Error })
            : BadRequest(new { error = result.Error });
    }
}
