using AipPortal.Web.Controllers;

namespace AipPortal.Tests.Announcements;

public sealed class LegacyApplicationHttpStatusTests
{
    [Theory]
    [InlineData("Conversation not found.", 404)]
    [InlineData("Attachment not found.", 404)]
    [InlineData("File not found.", 404)]
    [InlineData("Folder not found.", 404)]
    [InlineData("Comment target not found.", 404)]
    [InlineData("You are not allowed to post to this channel.", 403)]
    [InlineData("You are not allowed to upload an attachment for this resource.", 403)]
    [InlineData("Event title is required.", 400)]
    [InlineData("Event start time must be before the end time.", 400)]
    [InlineData("Unrecognized resource not found.", 400)]
    [InlineData(null, 400)]
    public void Only_established_errors_change_http_category(string? error, int expected)
    {
        Assert.Equal(expected, LegacyApplicationHttpStatus.For(error));
    }
}
