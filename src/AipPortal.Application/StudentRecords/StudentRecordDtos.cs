namespace AipPortal.Application.StudentRecords;

public sealed record StudentRecordPublicResponse(
    Guid Id,
    Guid WorkspaceId,
    string? PublicDisplayName,
    string? HomeroomLabel);

public sealed record StudentRecordRestrictedRequest(
    IReadOnlyCollection<string> Fields,
    bool IncludePublic = false);

public sealed record StudentRecordRestrictedResponse(
    Guid Id,
    Guid WorkspaceId,
    StudentRecordPublicResponse? Public,
    IReadOnlyDictionary<string, string?> RestrictedFields);
