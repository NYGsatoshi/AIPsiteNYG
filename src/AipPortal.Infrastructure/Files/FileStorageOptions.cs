namespace AipPortal.Infrastructure.Files;

public sealed class FileStorageOptions
{
    public string RootPath { get; set; } = string.Empty;

    public long MaxFileSizeBytes { get; set; } = 25 * 1024 * 1024;

    public string[] AllowedExtensions { get; set; } = [];
}
