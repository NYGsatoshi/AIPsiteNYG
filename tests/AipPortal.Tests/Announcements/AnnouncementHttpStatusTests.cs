using System.Text.Json;
using AipPortal.Application.Announcements;
using AipPortal.Application.Common;
using AipPortal.Web.Controllers;
using Microsoft.AspNetCore.Mvc;

namespace AipPortal.Tests.Announcements;

public sealed class AnnouncementHttpStatusTests
{
    [Theory]
    [InlineData("Announcement not found.", 404)]
    [InlineData("Authentication is required.", 401)]
    [InlineData("This announcement does not require acknowledgement.", 400)]
    public async Task Acknowledge_preserves_error_body_and_reports_failure_category(string error, int status)
    {
        var controller = new AnnouncementsController(null!, new AnalyticsStub(error), null!, null!);

        var result = Assert.IsType<ObjectResult>(await controller.Acknowledge(Guid.NewGuid(), default));

        Assert.Equal(status, result.StatusCode);
        Assert.Equal(error, JsonSerializer.SerializeToElement(result.Value).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Analytics_denied_returns_forbidden()
    {
        const string error = "You are not allowed to view announcement analytics.";
        var controller = new AnnouncementsController(null!, new AnalyticsStub(error), null!, null!);

        var result = Assert.IsType<ObjectResult>(await controller.Analytics(Guid.NewGuid(), default));

        Assert.Equal(403, result.StatusCode);
        Assert.Equal(error, JsonSerializer.SerializeToElement(result.Value).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Acknowledge_success_preserves_existing_response()
    {
        var controller = new AnnouncementsController(null!, new AnalyticsStub(null), null!, null!);

        var result = Assert.IsType<OkObjectResult>(await controller.Acknowledge(Guid.NewGuid(), default));

        Assert.Equal("OK", JsonSerializer.SerializeToElement(result.Value).GetProperty("status").GetString());
    }

    private sealed class AnalyticsStub(string? error) : IAnnouncementAnalyticsService
    {
        public Task<Result<AnnouncementAnalyticsResponse>> GetAsync(Guid announcementId, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<AnnouncementAnalyticsResponse>.Failure(error!));

        public Task<Result> AcknowledgeAsync(Guid announcementId, CancellationToken cancellationToken = default)
            => Task.FromResult(error is null ? Result.Success() : Result.Failure(error));

        public Task<Result> TrackCtaClickAsync(Guid announcementId, CancellationToken cancellationToken = default)
            => Task.FromResult(error is null ? Result.Success() : Result.Failure(error));
    }
}
