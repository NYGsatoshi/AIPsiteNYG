namespace AipPortal.Domain.Enums;

/// <summary>
/// Identifies the server-authoritative policy that was selected for a Task.
/// A Task override always replaces the Project default in full; it is never a
/// partial merge.
/// </summary>
public enum TaskExecutionScopeOrigin
{
    ProjectDefault = 0,
    TaskOverride = 1
}

/// <summary>
/// Durable lifecycle of a persisted execution request. Values 0 and 1 preserve
/// the foundation contract; subsequent values are runtime-owned states and are
/// never inferred from Workflow Stage, Activity text, or progress percentage.
/// </summary>
public enum TaskExecutionRunStatus
{
    Prepared = 0,
    RuntimeUnavailable = 1,
    Waiting = 2,
    NeedsInput = 3,
    Failed = 4,
    Completed = 5
}

/// <summary>
/// Stable user-facing execution state required by Task Progress. This is a
/// projection of TaskExecutionRunStatus, not a second mutable lifecycle.
/// </summary>
public enum TaskExecutionMajorState
{
    Running = 0,
    Waiting = 1,
    NeedsInput = 2,
    Failed = 3,
    Completed = 4
}
