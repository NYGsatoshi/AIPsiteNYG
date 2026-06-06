using AipPortal.Application.Common;

namespace AipPortal.Application.Common.Interfaces;

public sealed record StoredFileInfo(
    string StoredFileName,
    string FilePath,
    string StorageKey,
    string ContentType,
    string Extension,
    long SizeBytes);

public interface IFileStorageService
{
    Task<Result<StoredFileInfo>> SaveAsync(
        string originalFileName,
        string contentType,
        long sizeBytes,
        Stream content,
        CancellationToken cancellationToken = default);

    Task<Stream> OpenReadAsync(string storageKey, CancellationToken cancellationToken = default);

    Task DeleteAsync(string storageKey, CancellationToken cancellationToken = default);

    Task<StoredFileInfo?> GetFileInfoAsync(string storageKey, CancellationToken cancellationToken = default);
}
