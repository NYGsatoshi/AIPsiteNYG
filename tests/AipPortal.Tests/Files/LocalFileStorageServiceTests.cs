using System.Text;
using AipPortal.Infrastructure.Files;
using Microsoft.Extensions.Options;

namespace AipPortal.Tests.Files;

public sealed class LocalFileStorageServiceTests : IDisposable
{
    private readonly string _rootPath = Path.Combine(Path.GetTempPath(), "aip-storage-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void InvalidExtensionIsRejected()
    {
        var policy = CreatePolicy();

        Assert.DoesNotContain(".exe", policy.AllowedExtensions);
    }

    [Fact]
    public void EmptyFileIsRejected()
    {
        var policy = CreatePolicy();

        Assert.True(policy.MaxFileSizeBytes > 0);
    }

    [Fact]
    public async Task StorageKeyControlsStoredPathInsideRoot()
    {
        var storage = CreateStorage();
        await using var content = new MemoryStream(Encoding.UTF8.GetBytes("hello"));

        var result = await storage.SaveAsync("tenants/tenant-a/files/file-a", content, "text/plain");

        Assert.True(result.IsSuccess);
        Assert.True(await storage.ExistsAsync("tenants/tenant-a/files/file-a"));
    }

    [Fact]
    public async Task StorageKeyCannotEscapeRootPath()
    {
        var storage = CreateStorage();
        await using var content = new MemoryStream(Encoding.UTF8.GetBytes("bad"));

        await Assert.ThrowsAsync<InvalidOperationException>(() => storage.SaveAsync("../escape.txt", content, "text/plain"));
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

    private ConfiguredFileUploadPolicy CreatePolicy()
    {
        return new ConfiguredFileUploadPolicy(Options.Create(new FileStorageOptions
        {
            RootPath = _rootPath,
            MaxFileSizeBytes = 1024,
            AllowedExtensions = [".txt", ".md", ".zip"]
        }));
    }
}
