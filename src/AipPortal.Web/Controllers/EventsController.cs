using AipPortal.Application.Events;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Web.Controllers;

[ApiController]
[Authorize]
public sealed class EventsController(IEventService eventService) : ControllerBase
{
    [HttpGet("api/events")]
    public async Task<IActionResult> List([FromQuery] EventListQuery query, CancellationToken cancellationToken) => ToActionResult(await eventService.ListAsync(query, cancellationToken));

    [HttpPost("api/events")]
    public async Task<IActionResult> Create(CreateEventRequest request, CancellationToken cancellationToken) => ToActionResult(await eventService.CreateAsync(request, cancellationToken));

    [HttpGet("api/events/{eventId:guid}")]
    public async Task<IActionResult> Get(Guid eventId, CancellationToken cancellationToken) => ToActionResult(await eventService.GetAsync(eventId, cancellationToken));

    [HttpPatch("api/events/{eventId:guid}")]
    public async Task<IActionResult> Update(Guid eventId, UpdateEventRequest request, CancellationToken cancellationToken) => ToActionResult(await eventService.UpdateAsync(eventId, request, cancellationToken));

    [HttpDelete("api/events/{eventId:guid}")]
    public async Task<IActionResult> Delete(Guid eventId, CancellationToken cancellationToken) => OkOrBad(await eventService.DeleteAsync(eventId, cancellationToken));

    [HttpGet("api/events/{eventId:guid}/attendance")]
    public async Task<IActionResult> Attendance(Guid eventId, CancellationToken cancellationToken) => ToActionResult(await eventService.GetAttendanceAsync(eventId, cancellationToken));

    [HttpPost("api/events/{eventId:guid}/attendance/me")]
    public async Task<IActionResult> CreateMyAttendance(Guid eventId, UpdateMyAttendanceRequest request, CancellationToken cancellationToken) => ToActionResult(await eventService.UpsertMyAttendanceAsync(eventId, request, cancellationToken));

    [HttpPut("api/events/{eventId:guid}/attendance/me")]
    public async Task<IActionResult> UpdateMyAttendance(Guid eventId, UpdateMyAttendanceRequest request, CancellationToken cancellationToken) => ToActionResult(await eventService.UpsertMyAttendanceAsync(eventId, request, cancellationToken));

    [HttpPut("api/events/{eventId:guid}/attendance/{userId:guid}")]
    public async Task<IActionResult> UpdateAttendance(Guid eventId, Guid userId, UpdateAttendanceRequest request, CancellationToken cancellationToken) => ToActionResult(await eventService.UpdateAttendanceAsync(eventId, userId, request, cancellationToken));

    [HttpGet("api/calendar")]
    public async Task<IActionResult> Calendar([FromQuery] CalendarQuery query, CancellationToken cancellationToken) => ToActionResult(await eventService.GetCalendarAsync(query, cancellationToken));

    private IActionResult OkOrBad(AipPortal.Application.Common.Result result) => result.IsSuccess ? Ok(new { status = "OK" }) : BadRequest(new { error = result.Error });
    private IActionResult ToActionResult<T>(AipPortal.Application.Common.Result<T> result) => result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
}
