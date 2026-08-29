using AipPortal.Application.Messaging;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class MessageFollowUpsController(IMessageFollowUpService followUps) : ControllerBase
{
    [HttpGet("api/me/message-follow-ups")]
    public async Task<IActionResult> List(
        [FromQuery] MessageFollowUpListQuery query,
        CancellationToken cancellationToken) =>
        ToActionResult(await followUps.ListAsync(query, cancellationToken));

    [HttpPut("api/me/message-follow-ups/{messageId:guid}")]
    public async Task<IActionResult> Save(Guid messageId, CancellationToken cancellationToken) =>
        ToActionResult(await followUps.SaveAsync(messageId, cancellationToken));

    [HttpDelete("api/me/message-follow-ups/{messageId:guid}")]
    public async Task<IActionResult> Remove(Guid messageId, CancellationToken cancellationToken) =>
        ToActionResult(await followUps.RemoveAsync(messageId, cancellationToken));

    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result) =>
        result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
}
