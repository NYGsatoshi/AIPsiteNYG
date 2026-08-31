using System.Text.Json.Serialization;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record UpdateProjectExecutionScopeRequest(
    bool WebEnabled,
    bool ProjectFilesEnabled,
    long ExpectedVersion);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record UpdateTaskExecutionScopeOverrideRequest(
    bool WebEnabled,
    bool ProjectFilesEnabled,
    long ExpectedVersion);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ClearTaskExecutionScopeOverrideRequest(long ExpectedVersion);

/// <summary>
/// Intentionally empty foundation request. An Idempotency-Key identifies a
/// requested immutable policy snapshot; source material is not accepted here.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RequestTaskExecutionRunRequest;

public sealed record TaskExecutionSourcePolicyResponse(
    bool WebEnabled,
    bool ProjectFilesEnabled);

public sealed record ProjectExecutionScopeResponse(
    TaskExecutionSourcePolicyResponse Policy,
    long Version,
    bool CanManage);

public sealed record TaskExecutionScopeResponse(
    TaskExecutionSourcePolicyResponse EffectivePolicy,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] TaskExecutionScopeOrigin Origin,
    long ProjectDefaultVersion,
    long? TaskOverrideVersion,
    TaskExecutionSourcePolicyResponse? TaskOverridePolicy,
    bool CanManage,
    TaskExecutionRunResponse? LatestRun,
    string ChangesApplyTo);

public sealed record TaskExecutionRunResponse(
    Guid Id,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] TaskExecutionRunStatus Status,
    string? FailureCode,
    DateTimeOffset RequestedAtUtc,
    DateTimeOffset? FinishedAtUtc,
    int SnapshotSchemaVersion,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] TaskExecutionScopeOrigin SnapshotScopeOrigin,
    long SnapshotProjectScopeVersion,
    long? SnapshotTaskOverrideVersion,
    bool SnapshotWebEnabled,
    bool SnapshotProjectFilesEnabled,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] TaskExecutionProvider RuntimeProvider = TaskExecutionProvider.FirstPartyProjectFilesRuntimeV1,
    int RuntimeContractVersion = TaskExecutionRun.RuntimeContractVersion1,
    DateTimeOffset? QueuedAtUtc = null,
    DateTimeOffset? StartedAtUtc = null,
    Guid? SnapshotResearchPlanRevisionId = null,
    long? SnapshotResearchPlanRevisionNo = null)
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public TaskExecutionMajorState MajorState => Status switch
    {
        TaskExecutionRunStatus.Accepted => TaskExecutionMajorState.Accepted,
        TaskExecutionRunStatus.Queued => TaskExecutionMajorState.Queued,
        TaskExecutionRunStatus.Running => TaskExecutionMajorState.Running,
        TaskExecutionRunStatus.Succeeded => TaskExecutionMajorState.Succeeded,
        TaskExecutionRunStatus.Failed => TaskExecutionMajorState.Failed,
        _ => TaskExecutionMajorState.Failed
    };
}
