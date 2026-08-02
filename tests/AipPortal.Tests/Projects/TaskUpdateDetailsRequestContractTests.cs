using System.Text.Json;
using AipPortal.Application.Projects;

namespace AipPortal.Tests.Projects;

public sealed class TaskUpdateDetailsRequestContractTests
{
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public void OmittedDeadlineIsNotSpecified()
    {
        var request = Deserialize("""{"expectedVersion":7}""");

        Assert.False(request.DeadlineAt.IsSpecified);
        Assert.Null(request.DeadlineAt.Value);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public void ExplicitNullDeadlineIsSpecified()
    {
        var request = Deserialize("""{"expectedVersion":7,"deadlineAt":null}""");

        Assert.True(request.DeadlineAt.IsSpecified);
        Assert.Null(request.DeadlineAt.Value);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public void IsoDeadlineValueIsSpecifiedWithItsOffset()
    {
        var request = Deserialize(
            """{"expectedVersion":7,"deadlineAt":"2026-08-03T00:15:00+09:00"}""");

        Assert.True(request.DeadlineAt.IsSpecified);
        Assert.Equal(
            new DateTimeOffset(2026, 8, 3, 0, 15, 0, TimeSpan.FromHours(9)),
            request.DeadlineAt.Value);
    }

    [Theory]
    [Trait("Scope", "TaskV1PR07B")]
    [InlineData("isMajorDeadlineChange")]
    [InlineData("deadlineChangeClassification")]
    public void ClientCannotSupplyDeadlineSignificance(string propertyName)
    {
        var json = $$"""{"expectedVersion":7,"{{propertyName}}":true}""";

        Assert.Throws<JsonException>(() => Deserialize(json));
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public void PlannedScheduleContractDoesNotOwnHardDeadline()
    {
        Assert.Null(typeof(TaskScheduleUpdateRequest).GetProperty("DeadlineAt"));

        const string json =
            """{"plannedStartDate":null,"plannedEndDate":null,"milestoneDate":null,"expectedVersion":7,"deadlineAt":"2026-08-03T00:15:00Z"}""";
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<TaskScheduleUpdateRequest>(json, WebJson));
    }

    private static TaskUpdateDetailsRequest Deserialize(string json) =>
        JsonSerializer.Deserialize<TaskUpdateDetailsRequest>(json, WebJson)
        ?? throw new InvalidOperationException("Task update JSON unexpectedly deserialized to null.");
}
