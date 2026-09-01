using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Files;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class FileFolderService(
    AppDbContext dbContext,
    ICurrentTenant currentTenant,
    ICurrentUser currentUser,
    IWorkspaceAuthorizationService workspaceAuthorization,
    IFileAuthorizationService fileAuthorization) : IFileFolderService
{
    private const int MaxHierarchyDepth = 256;

    public async Task<Result<IReadOnlyList<FileFolderResponse>>> ListAsync(
        Guid workspaceId,
        CancellationToken cancellationToken = default)
    {
        var userId = CurrentUserId();
        if (workspaceId == Guid.Empty || userId is null || !CurrentTenantAvailable() ||
            !await workspaceAuthorization.CanViewWorkspace(userId.Value, workspaceId, cancellationToken))
        {
            return Result<IReadOnlyList<FileFolderResponse>>.Failure("Workspace not found.");
        }

        var folders = await dbContext.Set<FileFolder>()
            .AsNoTracking()
            .Where(folder =>
                folder.TenantId == currentTenant.TenantId &&
                folder.WorkspaceId == workspaceId &&
                folder.DeletedAt == null)
            .OrderBy(folder => folder.ParentFolderId)
            .ThenBy(folder => folder.SortOrder)
            .ThenBy(folder => folder.Name)
            .ThenBy(folder => folder.Id)
            .Select(folder => new FileFolderResponse(
                folder.Id,
                folder.WorkspaceId,
                folder.ParentFolderId,
                folder.Name,
                folder.SortOrder,
                folder.Version))
            .ToListAsync(cancellationToken);

        return Result<IReadOnlyList<FileFolderResponse>>.Success(folders);
    }

    public async Task<Result<FileFolderResponse>> CreateAsync(
        FileFolderCreateRequest request,
        CancellationToken cancellationToken = default)
    {
        var userId = CurrentUserId();
        var name = request.Name?.Trim() ?? string.Empty;
        if (request.WorkspaceId == Guid.Empty || userId is null || !CurrentTenantAvailable() ||
            !await workspaceAuthorization.CanContributeWorkspace(userId.Value, request.WorkspaceId, cancellationToken))
        {
            return Result<FileFolderResponse>.Failure("Workspace not found.");
        }

        if (name.Length is < 1 or > 180)
        {
            return Result<FileFolderResponse>.Failure("Folder name must be between 1 and 180 characters.");
        }

        if (request.ParentFolderId.HasValue &&
            !await DestinationFolderExistsAsync(request.WorkspaceId, request.ParentFolderId.Value, cancellationToken))
        {
            return Result<FileFolderResponse>.Failure("Destination folder not found.");
        }

        var duplicate = await dbContext.Set<FileFolder>().AnyAsync(folder =>
            folder.TenantId == currentTenant.TenantId &&
            folder.WorkspaceId == request.WorkspaceId &&
            folder.ParentFolderId == request.ParentFolderId &&
            folder.DeletedAt == null &&
            folder.Name == name,
            cancellationToken);
        if (duplicate)
        {
            return Result<FileFolderResponse>.Failure("A folder with the same name already exists at this location.");
        }

        var sortOrder = await NextSortOrderAsync(request.WorkspaceId, request.ParentFolderId, cancellationToken);
        var folder = new FileFolder
        {
            Id = Guid.NewGuid(),
            TenantId = currentTenant.TenantId,
            WorkspaceId = request.WorkspaceId,
            ParentFolderId = request.ParentFolderId,
            Name = name,
            SortOrder = sortOrder,
            Version = 1,
        };
        dbContext.Set<FileFolder>().Add(folder);
        await dbContext.SaveChangesAsync(cancellationToken);

        return Result<FileFolderResponse>.Success(ToResponse(folder));
    }

    public async Task<Result<FileLocationResponse>> GetFileLocationAsync(
        Guid fileObjectId,
        CancellationToken cancellationToken = default)
    {
        var authorized = await ResolveAuthorizedWorkspaceFileAsync(fileObjectId, requireContribution: false, cancellationToken);
        if (authorized is null)
        {
            return Result<FileLocationResponse>.Failure("File not found.");
        }

        var placement = await dbContext.Set<FileFolderPlacement>()
            .AsNoTracking()
            .SingleOrDefaultAsync(candidate =>
                candidate.TenantId == currentTenant.TenantId &&
                candidate.WorkspaceId == authorized.Value.WorkspaceId &&
                candidate.FileObjectId == fileObjectId,
                cancellationToken);

        return Result<FileLocationResponse>.Success(new FileLocationResponse(
            fileObjectId,
            authorized.Value.WorkspaceId,
            placement?.FolderId,
            placement?.Version ?? 0));
    }

    public async Task<Result<FileLocationResponse>> MoveFileAsync(
        Guid fileObjectId,
        FileMoveRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.ExpectedVersion < 0)
        {
            return Result<FileLocationResponse>.Failure("Invalid file location version.");
        }

        var authorized = await ResolveAuthorizedWorkspaceFileAsync(fileObjectId, requireContribution: true, cancellationToken);
        if (authorized is null)
        {
            return Result<FileLocationResponse>.Failure("File not found.");
        }

        var workspaceId = authorized.Value.WorkspaceId;
        if (request.DestinationFolderId.HasValue &&
            !await DestinationFolderExistsAsync(workspaceId, request.DestinationFolderId.Value, cancellationToken))
        {
            return Result<FileLocationResponse>.Failure("Destination folder not found.");
        }

        var placement = await dbContext.Set<FileFolderPlacement>()
            .SingleOrDefaultAsync(candidate =>
                candidate.TenantId == currentTenant.TenantId &&
                candidate.WorkspaceId == workspaceId &&
                candidate.FileObjectId == fileObjectId,
                cancellationToken);

        var currentVersion = placement?.Version ?? 0;
        var currentFolderId = placement?.FolderId;
        if (currentVersion != request.ExpectedVersion)
        {
            return Result<FileLocationResponse>.Failure("File location changed. Refresh and choose the destination again.");
        }

        if (currentFolderId == request.DestinationFolderId)
        {
            return Result<FileLocationResponse>.Success(new FileLocationResponse(
                fileObjectId,
                workspaceId,
                currentFolderId,
                currentVersion));
        }

        try
        {
            if (placement is null)
            {
                placement = new FileFolderPlacement
                {
                    Id = Guid.NewGuid(),
                    TenantId = currentTenant.TenantId,
                    WorkspaceId = workspaceId,
                    FileObjectId = fileObjectId,
                    FolderId = request.DestinationFolderId,
                    Version = 1,
                };
                dbContext.Set<FileFolderPlacement>().Add(placement);
            }
            else
            {
                placement.FolderId = request.DestinationFolderId;
                placement.Version += 1;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Result<FileLocationResponse>.Failure("File location changed. Refresh and choose the destination again.");
        }
        catch (DbUpdateException)
        {
            // The first move from logical version 0 races on the unique
            // FileObject placement key. Fail closed rather than overwriting it.
            return Result<FileLocationResponse>.Failure("File location changed. Refresh and choose the destination again.");
        }

        return Result<FileLocationResponse>.Success(new FileLocationResponse(
            fileObjectId,
            workspaceId,
            placement.FolderId,
            placement.Version));
    }

    public async Task<Result<FileFolderResponse>> MoveFolderAsync(
        Guid folderId,
        FileFolderMoveRequest request,
        CancellationToken cancellationToken = default)
    {
        if (folderId == Guid.Empty || request.ExpectedVersion < 1)
        {
            return Result<FileFolderResponse>.Failure("Folder not found.");
        }

        var userId = CurrentUserId();
        if (userId is null || !CurrentTenantAvailable())
        {
            return Result<FileFolderResponse>.Failure("Folder not found.");
        }

        var folder = await dbContext.Set<FileFolder>().SingleOrDefaultAsync(candidate =>
            candidate.Id == folderId &&
            candidate.TenantId == currentTenant.TenantId &&
            candidate.DeletedAt == null,
            cancellationToken);
        if (folder is null ||
            !await workspaceAuthorization.CanContributeWorkspace(userId.Value, folder.WorkspaceId, cancellationToken))
        {
            return Result<FileFolderResponse>.Failure("Folder not found.");
        }

        // Source is reauthorized above. Destination must resolve inside the
        // exact same Tenant/Workspace, never through a storage path or key.
        if (request.DestinationParentFolderId == folder.Id)
        {
            return Result<FileFolderResponse>.Failure("A folder cannot be moved into itself.");
        }
        if (request.DestinationParentFolderId.HasValue &&
            !await DestinationFolderExistsAsync(folder.WorkspaceId, request.DestinationParentFolderId.Value, cancellationToken))
        {
            return Result<FileFolderResponse>.Failure("Destination folder not found.");
        }
        if (folder.Version != request.ExpectedVersion)
        {
            return Result<FileFolderResponse>.Failure("Folder changed. Refresh and choose the destination again.");
        }
        if (folder.ParentFolderId == request.DestinationParentFolderId)
        {
            return Result<FileFolderResponse>.Success(ToResponse(folder));
        }

        if (request.DestinationParentFolderId.HasValue &&
            await WouldCreateCycleAsync(folder, request.DestinationParentFolderId.Value, cancellationToken))
        {
            return Result<FileFolderResponse>.Failure("A folder cannot be moved into one of its descendants.");
        }

        folder.ParentFolderId = request.DestinationParentFolderId;
        folder.SortOrder = await NextSortOrderAsync(folder.WorkspaceId, request.DestinationParentFolderId, cancellationToken);
        folder.Version += 1;

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Result<FileFolderResponse>.Failure("Folder changed. Refresh and choose the destination again.");
        }

        return Result<FileFolderResponse>.Success(ToResponse(folder));
    }

    private async Task<(Guid WorkspaceId, Attachment Attachment)?> ResolveAuthorizedWorkspaceFileAsync(
        Guid fileObjectId,
        bool requireContribution,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (fileObjectId == Guid.Empty || userId is null || !CurrentTenantAvailable())
        {
            return null;
        }

        var attachment = await dbContext.Set<Attachment>()
            .Include(candidate => candidate.FileObject)
            .SingleOrDefaultAsync(candidate =>
                candidate.TenantId == currentTenant.TenantId &&
                candidate.FileObjectId == fileObjectId &&
                candidate.OwnerType == AttachmentOwnerType.Workspace &&
                candidate.OwnerId == candidate.WorkspaceId &&
                candidate.DeletedAt == null &&
                candidate.FileObject != null &&
                candidate.FileObject.TenantId == currentTenant.TenantId &&
                candidate.FileObject.WorkspaceId == candidate.WorkspaceId &&
                candidate.FileObject.Status == FileObjectStatus.Active &&
                candidate.FileObject.DeletedAt == null,
                cancellationToken);
        if (attachment is null)
        {
            return null;
        }

        var workspaceAllowed = requireContribution
            ? await workspaceAuthorization.CanContributeWorkspace(userId.Value, attachment.WorkspaceId, cancellationToken)
            : await workspaceAuthorization.CanViewWorkspace(userId.Value, attachment.WorkspaceId, cancellationToken);
        if (!workspaceAllowed ||
            !await fileAuthorization.CanViewAttachment(userId.Value, attachment, cancellationToken))
        {
            return null;
        }

        return (attachment.WorkspaceId, attachment);
    }

    private async Task<bool> DestinationFolderExistsAsync(
        Guid workspaceId,
        Guid folderId,
        CancellationToken cancellationToken) =>
        await dbContext.Set<FileFolder>().AnyAsync(folder =>
            folder.Id == folderId &&
            folder.TenantId == currentTenant.TenantId &&
            folder.WorkspaceId == workspaceId &&
            folder.DeletedAt == null,
            cancellationToken);

    private async Task<int> NextSortOrderAsync(
        Guid workspaceId,
        Guid? parentFolderId,
        CancellationToken cancellationToken)
    {
        var max = await dbContext.Set<FileFolder>()
            .Where(folder =>
                folder.TenantId == currentTenant.TenantId &&
                folder.WorkspaceId == workspaceId &&
                folder.ParentFolderId == parentFolderId &&
                folder.DeletedAt == null)
            .Select(folder => (int?)folder.SortOrder)
            .MaxAsync(cancellationToken);
        return (max ?? -1) + 1;
    }

    private async Task<bool> WouldCreateCycleAsync(
        FileFolder source,
        Guid destinationFolderId,
        CancellationToken cancellationToken)
    {
        var parentById = await dbContext.Set<FileFolder>()
            .AsNoTracking()
            .Where(folder =>
                folder.TenantId == currentTenant.TenantId &&
                folder.WorkspaceId == source.WorkspaceId &&
                folder.DeletedAt == null)
            .Select(folder => new { folder.Id, folder.ParentFolderId })
            .ToDictionaryAsync(folder => folder.Id, folder => folder.ParentFolderId, cancellationToken);

        Guid? cursor = destinationFolderId;
        for (var depth = 0; cursor.HasValue && depth < MaxHierarchyDepth; depth += 1)
        {
            if (cursor.Value == source.Id)
            {
                return true;
            }
            if (!parentById.TryGetValue(cursor.Value, out cursor))
            {
                return false;
            }
        }

        // Existing corrupted/cyclic trees fail closed instead of accepting a
        // move whose ancestry cannot be proven safe.
        return cursor.HasValue;
    }

    private bool CurrentTenantAvailable() =>
        currentTenant.IsAvailable && !currentTenant.IsPlatformScope && currentTenant.TenantId != Guid.Empty;

    private Guid? CurrentUserId() =>
        currentUser.IsAuthenticated && currentUser.UserId is { } userId && userId != Guid.Empty
            ? userId
            : null;

    private static FileFolderResponse ToResponse(FileFolder folder) => new(
        folder.Id,
        folder.WorkspaceId,
        folder.ParentFolderId,
        folder.Name,
        folder.SortOrder,
        folder.Version);
}
