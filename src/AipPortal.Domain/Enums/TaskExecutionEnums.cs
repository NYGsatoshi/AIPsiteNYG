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
/// Lifecycle of a persisted execution request. The foundation release can only
/// record an unavailable runtime outcome; it does not execute work or fetch
/// sources.
/// </summary>
public enum TaskExecutionRunStatus
{
    Prepared = 0,
    RuntimeUnavailable = 1
}
