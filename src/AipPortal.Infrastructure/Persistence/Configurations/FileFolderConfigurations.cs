using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class FileFolderConfiguration : IEntityTypeConfiguration<FileFolder>
{
    public void Configure(EntityTypeBuilder<FileFolder> builder)
    {
        builder.ToTable("file_folders");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(folder => folder.Name).HasMaxLength(180).IsRequired();
        builder.Property(folder => folder.Version).IsConcurrencyToken().HasDefaultValue(1L).IsRequired();

        builder.HasIndex(folder => new { folder.TenantId, folder.WorkspaceId, folder.ParentFolderId, folder.SortOrder });
        builder.HasIndex(folder => new { folder.TenantId, folder.WorkspaceId, folder.DeletedAt });

        builder
            .HasOne(folder => folder.Workspace)
            .WithMany()
            .HasForeignKey(folder => folder.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(folder => folder.ParentFolder)
            .WithMany(folder => folder.ChildFolders)
            .HasForeignKey(folder => folder.ParentFolderId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class FileFolderPlacementConfiguration : IEntityTypeConfiguration<FileFolderPlacement>
{
    public void Configure(EntityTypeBuilder<FileFolderPlacement> builder)
    {
        builder.ToTable("file_folder_placements");
        builder.ConfigureAuditableEntity();

        builder.Property(placement => placement.Version).IsConcurrencyToken().HasDefaultValue(1L).IsRequired();

        builder.HasIndex(placement => placement.FileObjectId).IsUnique();
        builder.HasIndex(placement => new { placement.TenantId, placement.WorkspaceId, placement.FolderId });

        builder
            .HasOne(placement => placement.Workspace)
            .WithMany()
            .HasForeignKey(placement => placement.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(placement => placement.FileObject)
            .WithMany()
            .HasForeignKey(placement => placement.FileObjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(placement => placement.Folder)
            .WithMany()
            .HasForeignKey(placement => placement.FolderId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
