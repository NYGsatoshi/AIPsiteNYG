using AipPortal.Application.Common;

namespace AipPortal.Application.Files;

public sealed record FileFolderResponse(
    Guid Id,
    Guid WorkspaceId,
    Guid? ParentFolderId,
    string Name,
    int SortOrder,
    long Version);

public sealed record FileFolderCreateRequest(
    Guid WorkspaceId,
    Guid? ParentFolderId,
    string Name);

public sealed record FileLocationResponse(
    Guid FileObjectId,
    Guid WorkspaceId,
    Guid? FolderId,
    long Version);

public sealed record FileMoveRequest(
    Guid? DestinationFolderId,
    long ExpectedVersion);

public sealed record FileFolderMoveRequest(
    Guid? DestinationParentFolderId,
    long ExpectedVersion);

/// <summary>
/// Authoritative Workspace-scoped folder hierarchy and logical placement.
/// Storage keys/paths are deliberately not part of this contract.
/// </summary>
public interface IFileFolderService
{
    Task<Result<IReadOnlyList<FileFolderResponse>>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken = default);

    Task<Result<FileFolderResponse>> CreateAsync(
        FileFolderCreateRequest request,
        CancellationToken cancellationToken = default);

    Task<Result<FileLocationResponse>> GetFileLocationAsync(
        Guid fileObjectId,
        CancellationToken cancellationToken = default);

    Task<Result<FileLocationResponse>> MoveFileAsync(
        Guid fileObjectId,
        FileMoveRequest request,
        CancellationToken cancellationToken = default);

    Task<Result<FileFolderResponse>> MoveFolderAsync(
        Guid folderId,
        FileFolderMoveRequest request,
        CancellationToken cancellationToken = default);
}
