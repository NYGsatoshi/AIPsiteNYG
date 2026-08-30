using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class TaskExecutionMaterializedSourceConfiguration
    : IEntityTypeConfiguration<TaskExecutionMaterializedSource>
{
    public void Configure(EntityTypeBuilder<TaskExecutionMaterializedSource> builder)
    {
        builder.ToTable("task_execution_materialized_sources", table =>
        {
            table.HasCheckConstraint(
                "CK_task_execution_materialized_sources_schema",
                "\"SchemaVersion\" = 1");
            table.HasCheckConstraint(
                "CK_task_execution_materialized_sources_media_type",
                "\"MediaType\" IN ('text/plain', 'text/markdown')");
            table.HasCheckConstraint(
                "CK_task_execution_materialized_sources_byte_count",
                $"\"MaterializedByteCount\" >= 0 AND \"MaterializedByteCount\" <= {FirstPartyProjectFilesMaterializationV1.MaxSourceBytes}");
            table.HasCheckConstraint(
                "CK_task_execution_materialized_sources_hash",
                "length(\"ContentSha256\") = 64");
        });
        builder.ConfigureEntity();

        builder.Property(source => source.SchemaVersion)
            .HasDefaultValue(TaskExecutionMaterializedSource.SchemaVersion1)
            .IsRequired();
        builder.Property(source => source.ContentSha256)
            .HasMaxLength(64)
            .IsRequired();
        builder.Property(source => source.MediaType)
            .HasMaxLength(80)
            .IsRequired();
        builder.Property(source => source.MaterializedByteCount).IsRequired();
        builder.Property(source => source.MaterializedAtUtc).IsRequired();

        builder.HasIndex(source => new { source.TaskExecutionRunId, source.AttachmentId })
            .IsUnique();
        builder.HasIndex(source => new { source.TenantId, source.TaskExecutionRunId });
        builder.HasIndex(source => new { source.TenantId, source.ProjectId, source.TaskItemId });
        builder.HasIndex(source => source.FileObjectId);
        builder.HasIndex(source => source.AttachmentId);

        builder
            .HasOne<TaskExecutionRun>()
            .WithMany()
            .HasForeignKey(source => source.TaskExecutionRunId)
            .OnDelete(DeleteBehavior.Restrict);
        builder
            .HasOne<FileObject>()
            .WithMany()
            .HasForeignKey(source => source.FileObjectId)
            .OnDelete(DeleteBehavior.Restrict);
        builder
            .HasOne<Attachment>()
            .WithMany()
            .HasForeignKey(source => source.AttachmentId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
