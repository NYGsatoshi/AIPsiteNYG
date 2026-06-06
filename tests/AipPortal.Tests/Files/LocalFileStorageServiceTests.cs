using System.Text;
using AipPortal.Infrastructure.Files;
using Microsoft.Extensions.Options;

namespace AipPortal.Tests.Files;

public sealed class LocalFileStorageServiceTests : IDisposable
{
    private readonly string _rootPath = Path.Combine(Path.GetTempPath(), "aip-storage-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task InvalidExtensionIsRejected()
    {
        var storage = CreateStorage();
        await using var content = new MemoryStream(Encoding.UTF8.GetBytes("bad"));

        var result = await storage.SaveAsync("script.exe", "application/octet-stream", content.Length, content);

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task EmptyFileIsRejected()
    {
        var storage = CreateStorage();
        await using var content = new MemoryStream();

        var result = await storage.SaveAsync("empty.txt", "text/plain", 0, content);

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task OriginalFileNameDoesNotControlStoredPath()
    {
        var storage = CreateStorage();
        await using var content = new MemoryStream(Encoding.UTF8.GetBytes("hello"));

        var result = await storage.SaveAsync("..\\..\\report.txt", "text/plain", content.Length, content);

        Assert.True(result.IsSuccess);
        Assert.NotEqual("report.txt", result.Value!.StoredFileName);
        Assert.EndsWith(".txt", result.Value.StoredFileName);
        Assert.DoesNotContain("..", result.Value.StorageKey);
    }

    public void Dispose()
    {
        if (Directory.Exists(_rootPath))
        {
            Directory.Delete(_rootPath, recursive: true);
        }
    }

    private LocalFileStorageService CreateStorage()
    {
        return new LocalFileStorageService(Options.Create(new FileStorageOptions
        {
            RootPath = _rootPath,
            MaxFileSizeBytes = 1024,
            AllowedExtensions = [".txt", ".md", ".zip"]
        }));
    }
}
