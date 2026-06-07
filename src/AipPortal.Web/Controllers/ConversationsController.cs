using AipPortal.Application.Messaging;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class ConversationsController(IConversationService conversations) : ControllerBase
{
    [HttpGet("api/conversations")]
    public async Task<IActionResult> List([FromQuery] ConversationListQuery query, CancellationToken cancellationToken) => ToActionResult(await conversations.ListAsync(query, cancellationToken));

    [HttpPost("api/conversations")]
    public async Task<IActionResult> Create(CreateConversationRequest request, CancellationToken cancellationToken) => ToActionResult(await conversations.CreateAsync(request, cancellationToken));

    [HttpGet("api/conversations/{conversationId:guid}")]
    public async Task<IActionResult> Get(Guid conversationId, CancellationToken cancellationToken) => ToActionResult(await conversations.GetAsync(conversationId, cancellationToken));

    [HttpPatch("api/conversations/{conversationId:guid}")]
    public async Task<IActionResult> Update(Guid conversationId, UpdateConversationRequest request, CancellationToken cancellationToken) => ToActionResult(await conversations.UpdateAsync(conversationId, request, cancellationToken));

    [HttpPost("api/conversations/{conversationId:guid}/leave")]
    public async Task<IActionResult> Leave(Guid conversationId, CancellationToken cancellationToken) => OkOrBad(await conversations.LeaveAsync(conversationId, cancellationToken));

    [HttpGet("api/conversations/{conversationId:guid}/members")]
    public async Task<IActionResult> Members(Guid conversationId, CancellationToken cancellationToken) => ToActionResult(await conversations.ListMembersAsync(conversationId, cancellationToken));

    [HttpPost("api/conversations/{conversationId:guid}/members")]
    public async Task<IActionResult> AddMember(Guid conversationId, AddConversationMemberRequest request, CancellationToken cancellationToken) => ToActionResult(await conversations.AddMemberAsync(conversationId, request, cancellationToken));

    [HttpDelete("api/conversations/{conversationId:guid}/members/{userId:guid}")]
    public async Task<IActionResult> RemoveMember(Guid conversationId, Guid userId, CancellationToken cancellationToken) => OkOrBad(await conversations.RemoveMemberAsync(conversationId, userId, cancellationToken));

    [HttpGet("api/conversations/{conversationId:guid}/messages")]
    public async Task<IActionResult> Messages(Guid conversationId, [FromQuery] MessageListQuery query, CancellationToken cancellationToken) => ToActionResult(await conversations.ListMessagesAsync(conversationId, query, cancellationToken));

    [HttpPost("api/conversations/{conversationId:guid}/messages")]
    public async Task<IActionResult> Send(Guid conversationId, SendMessageRequest request, CancellationToken cancellationToken) => ToActionResult(await conversations.SendMessageAsync(conversationId, request, cancellationToken));

    [HttpPatch("api/messages/{messageId:guid}")]
    public async Task<IActionResult> UpdateMessage(Guid messageId, UpdateMessageRequest request, CancellationToken cancellationToken) => ToActionResult(await conversations.UpdateMessageAsync(messageId, request, cancellationToken));

    [HttpDelete("api/messages/{messageId:guid}")]
    public async Task<IActionResult> DeleteMessage(Guid messageId, CancellationToken cancellationToken) => OkOrBad(await conversations.DeleteMessageAsync(messageId, cancellationToken));

    [HttpPost("api/conversations/{conversationId:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid conversationId, MarkConversationReadRequest request, CancellationToken cancellationToken) => OkOrBad(await conversations.MarkReadAsync(conversationId, request, cancellationToken));

    private IActionResult OkOrBad(AipPortal.Application.Common.Result result) => result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result) => result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
}
