namespace AipPortal.Application.Search;

public enum SearchResultType
{
    All = 0,
    User = 1,
    Group = 2,
    Channel = 3,
    Post = 4,
    Message = 5,
    Announcement = 6,
    Project = 7,
    Task = 8,
    Artifact = 9,
    ActivityLog = 10,
    Comment = 11,
    Workspace = 12,
    File = 13
}

public enum FileSearchKind
{
    All = 0,
    Document = 1,
    Image = 2,
    Pdf = 3,
    Video = 4,
    Archive = 5
}

public sealed record SearchRequest(
    string? Q = null,
    SearchResultType Type = SearchResultType.All,
    Guid? WorkspaceId = null,
    Guid? GroupId = null,
    Guid? ProjectId = null,
    Guid? AuthorUserId = null,
    DateTimeOffset? FromDate = null,
    DateTimeOffset? ToDate = null,
    int Page = 1,
    int PageSize = 20,
    FileSearchKind FileKind = FileSearchKind.All);

public sealed record SearchResultItemResponse(
    SearchResultType Type,
    Guid Id,
    string Title,
    string? Snippet,
    string Route,
    Guid? WorkspaceId,
    Guid? GroupId,
    Guid? ProjectId,
    DateTimeOffset CreatedAt,
    string? AuthorDisplayName,
    string? ContentType = null,
    long? SizeBytes = null,
    string? Status = null,
    string? ScanStatus = null,
    DateTimeOffset? UpdatedAt = null);

public sealed record SearchResponse(
    string? Query,
    int Page,
    int PageSize,
    int TotalCount,
    IReadOnlyList<SearchResultItemResponse> Items);
