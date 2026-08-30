using System.Text.Json.Serialization;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ResearchPlanStepRequest(
    string? Title,
    string? Objective,
    string? ScopeSummary,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] ResearchPlanStepStatus Status);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReplaceResearchPlanRequest(
    long ExpectedVersion,
    IReadOnlyList<ResearchPlanStepRequest>? Steps);

public sealed record ResearchPlanStepResponse(
    Guid Id,
    int Position,
    string Title,
    string Objective,
    string ScopeSummary,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] ResearchPlanStepStatus Status);

public sealed record ResearchPlanRevisionResponse(
    Guid Id,
    int Number,
    DateTimeOffset CreatedAtUtc,
    Guid CreatedByUserId,
    IReadOnlyList<ResearchPlanStepResponse> Steps);

/// <summary>
/// The current saved plan. Its current revision is the exact plan intended for
/// execution-start review; a later execution contract captures that revision.
/// </summary>
public sealed record ResearchPlanResponse(
    Guid? PlanId,
    long Version,
    ResearchPlanRevisionResponse? CurrentRevision,
    bool CanManage);
