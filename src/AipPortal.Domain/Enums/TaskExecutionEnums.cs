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
/// The server-owned implementation selected for a Task execution run. It is
/// deliberately not browser-selectable and has no provider credentials.
/// </summary>
public enum TaskExecutionProvider
{
    FirstPartyProjectFilesRuntimeV1 = 0
}

/// <summary>
/// Durable lifecycle of a persisted execution request. It is independent from
/// Task workflow, activity, progress, and browser state.
/// </summary>
public enum TaskExecutionRunStatus
{
    Accepted = 0,
    Queued = 1,
    Running = 2,
    Succeeded = 3,
    Failed = 4
}

/// <summary>
/// Stable user-facing execution state. This is a projection of
/// <see cref="TaskExecutionRunStatus"/>, not a second mutable lifecycle.
/// </summary>
public enum TaskExecutionMajorState
{
    Accepted = 0,
    Queued = 1,
    Running = 2,
    Succeeded = 3,
    Failed = 4
}

/// <summary>
/// The only permitted V1 progression. A materialization refusal is recorded
/// after the server worker has entered <see cref="TaskExecutionRunStatus.Running"/>,
/// so it reaches the same safe terminal failure boundary as an execution
/// failure without inventing a second lifecycle.
/// </summary>
public static class TaskExecutionRunLifecycle
{
    public static bool IsTerminal(TaskExecutionRunStatus status) =>
        status is TaskExecutionRunStatus.Succeeded or TaskExecutionRunStatus.Failed;

    public static bool CanTransition(TaskExecutionRunStatus from, TaskExecutionRunStatus to) =>
        (from, to) switch
        {
            (TaskExecutionRunStatus.Accepted, TaskExecutionRunStatus.Queued) => true,
            (TaskExecutionRunStatus.Queued, TaskExecutionRunStatus.Running) => true,
            (TaskExecutionRunStatus.Running, TaskExecutionRunStatus.Succeeded) => true,
            (TaskExecutionRunStatus.Running, TaskExecutionRunStatus.Failed) => true,
            _ => false
        };
}
