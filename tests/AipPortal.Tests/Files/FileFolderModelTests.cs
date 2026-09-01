using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace AipPortal.Tests.Files;

public sealed class FileFolderModelTests
{
    [Fact]
    public void Model_UsesAuthoritativeFolderAndOptimisticPlacementContracts()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"file-folder-model-{Guid.NewGuid():N}")
            .Options;
        using var db = new AppDbContext(options, new NoTenant());

        var folder = db.Model.FindEntityType(typeof(FileFolder));
        Assert.NotNull(folder);
        Assert.True(folder!.FindProperty(nameof(FileFolder.Version))!.IsConcurrencyToken);
        Assert.Equal(DeleteBehavior.Restrict,
            folder.FindNavigation(nameof(FileFolder.ParentFolder))!.ForeignKey.DeleteBehavior);
        Assert.Equal(DeleteBehavior.Restrict,
            folder.FindNavigation(nameof(FileFolder.Workspace))!.ForeignKey.DeleteBehavior);

        var placement = db.Model.FindEntityType(typeof(FileFolderPlacement));
        Assert.NotNull(placement);
        Assert.True(placement!.FindProperty(nameof(FileFolderPlacement.Version))!.IsConcurrencyToken);
        Assert.Contains(placement.GetIndexes(), index =>
            index.IsUnique &&
            index.Properties.Count == 1 &&
            index.Properties[0].Name == nameof(FileFolderPlacement.FileObjectId));
        Assert.Equal(DeleteBehavior.Restrict,
            placement.FindNavigation(nameof(FileFolderPlacement.Folder))!.ForeignKey.DeleteBehavior);
    }

    private sealed class NoTenant : ICurrentTenant
    {
        public Guid TenantId => Guid.Empty;
        public bool IsAvailable => false;
        public string? TenantSlug => null;
        public bool IsPlatformScope => false;
    }
}
