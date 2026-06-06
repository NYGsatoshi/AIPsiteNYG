using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using Microsoft.Extensions.Options;

namespace AipPortal.Infrastructure.Files;

public sealed class LocalFileStorageService(IOptions<FileStorageOptions> options) : IFileStorageService
{
    private readonly FileStorageOptions _options = options.Value;

    public async Task<Result<StoredFileInfo>> SaveAsync(
        string originalFileName,
        string contentType,
        long sizeBytes,
        Stream content,
        CancellationToken cancellationToken = default)
    {
        var validation = Validate(originalFileName, sizeBytes);
        if (!validation.IsSuccess)
        {
            return Result<StoredFileInfo>.Failure(validation.Error!);
        }

        var root = GetRootPath();
        var extension = Path.GetExtension(originalFileName).ToLowerInvariant();
        var storedFileName = $"{Guid.NewGuid():N}{extension}";
        var dateFolder = DateTimeOffset.UtcNow.ToString("yyyy/MM/dd");
        var storageKey = dateFolder.Replace('/', Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar + storedFileName;
        var fullPath = EnsureSafePath(root, storageKey);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        await using (var output = File.Create(fullPath))
        {
            await content.CopyToAsync(output, cancellationToken);
        }

        return Result<StoredFileInfo>.Success(new StoredFileInfo(
            storedFileName,
            Path.GetRelativePath(root, fullPath),
            storageKey,
            string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType,
            extension,
            sizeBytes));
    }

    public Task<Stream> OpenReadAsync(string storageKey, CancellationToken cancellationToken = default)
    {
        var fullPath = EnsureSafePath(GetRootPath(), storageKey);
        return Task.FromResult<Stream>(File.OpenRead(fullPath));
    }

    public Task DeleteAsync(string storageKey, CancellationToken cancellationToken = default)
    {
        var fullPath = EnsureSafePath(GetRootPath(), storageKey);
        if (File.Exists(fullPath))
        {
            File.Delete(fullPath);
        }

        return Task.CompletedTask;
    }

    public Task<StoredFileInfo?> GetFileInfoAsync(string storageKey, CancellationToken cancellationToken = default)
    {
        var fullPath = EnsureSafePath(GetRootPath(), storageKey);
        if (!File.Exists(fullPath))
        {
            return Task.FromResult<StoredFileInfo?>(null);
        }

        var info = new FileInfo(fullPath);
        return Task.FromResult<StoredFileInfo?>(new StoredFileInfo(
            info.Name,
            Path.GetRelativePath(GetRootPath(), fullPath),
            storageKey,
            "application/octet-stream",
            info.Extension,
            info.Length));
    }

    private Result Validate(string originalFileName, long sizeBytes)
    {
        if (string.IsNullOrWhiteSpace(_options.RootPath))
        {
            return Result.Failure("FileStorage:RootPath is not configured.");
        }

        if (sizeBytes <= 0)
        {
            return Result.Failure("Empty files are not allowed.");
        }

        if (sizeBytes > _options.MaxFileSizeBytes)
        {
            return Result.Failure($"File exceeds the maximum size of {_options.MaxFileSizeBytes} bytes.");
        }

        var extension = Path.GetExtension(originalFileName).ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(extension) ||
            !_options.AllowedExtensions.Select(item => item.ToLowerInvariant()).Contains(extension))
        {
            return Result.Failure("File extension is not allowed.");
        }

        // TODO: add ZIP bomb protection before enabling archive inspection or extraction.
        return Result.Success();
    }

    private string GetRootPath()
    {
        return Path.GetFullPath(_options.RootPath);
    }

    private static string EnsureSafePath(string root, string storageKey)
    {
        var fullPath = Path.GetFullPath(Path.Combine(root, storageKey));
        var normalizedRoot = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!fullPath.Equals(root, StringComparison.OrdinalIgnoreCase) &&
            !fullPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Storage key resolved outside the configured file root.");
        }

        return fullPath;
    }
}
