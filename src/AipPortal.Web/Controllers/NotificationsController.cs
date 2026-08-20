using AipPortal.Application.Notifications;
using AipPortal.Application.Security.Redaction;
using AipPortal.Web.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class NotificationsController(INotificationApplicationService notifications) : ControllerBase
{
    [HttpGet("api/notifications")]
    public async Task<IActionResult> List([FromQuery] NotificationListQuery query, CancellationToken cancellationToken)
    {
        return ToActionResult(
            await notifications.ListAsync(query, cancellationToken),
            "Notifications");
    }

    [HttpGet("api/notifications/unread-count")]
    public async Task<IActionResult> UnreadCount(CancellationToken cancellationToken)
    {
        return ToActionResult(
            await notifications.GetUnreadCountAsync(cancellationToken),
            "NotificationUnreadCount");
    }

    [HttpPatch("api/notifications/{notificationId:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid notificationId, CancellationToken cancellationToken)
    {
        var result = await notifications.MarkAsReadAsync(notificationId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    [HttpPost("api/notifications/{notificationId:guid}/open")]
    public async Task<IActionResult> Open(Guid notificationId, CancellationToken cancellationToken)
    {
        var result = await notifications.OpenAsync(notificationId, cancellationToken);
        if (result.IsSuccess)
        {
            return Ok(CanonicalRedactionProjection.Apply(
                HttpContext,
                result.Value!,
                RedactionProfile.NotificationPayload,
                "NotificationOpen"));
        }

        // A missing notification and a notification owned by another
        // recipient are indistinguishable at the boundary.  Do not disclose
        // a target lifecycle or authorization reason.
        return NotFound(new NotificationOpenResponse("Unavailable", null, 0));
    }

    [HttpPatch("api/notifications/read-all")]
    public async Task<IActionResult> MarkAllRead(CancellationToken cancellationToken)
    {
        var result = await notifications.MarkAllAsReadAsync(cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    [HttpDelete("api/notifications/{notificationId:guid}")]
    public async Task<IActionResult> Delete(Guid notificationId, CancellationToken cancellationToken)
    {
        var result = await notifications.DeleteAsync(notificationId, cancellationToken);
        return result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    }

    private IActionResult ToActionResult<T>(
        AipPortal.Application.Common.Result<T> result,
        string moduleKey)
    {
        return result.IsSuccess
            ? Ok(CanonicalRedactionProjection.Apply(
                HttpContext,
                result.Value!,
                RedactionProfile.NotificationPayload,
                moduleKey))
            : BadRequest(new { error = result.Error });
    }
}
