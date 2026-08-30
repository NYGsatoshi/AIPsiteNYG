using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class ProjectExecutionScopeConfiguration : IEntityTypeConfiguration<ProjectExecutionScope>
{
    public void Configure(EntityTypeBuilder<ProjectExecutionScope> builder)
    {
        builder.ToTable("project_execution_scopes");
        builder.ConfigureAuditableEntity();

        builder.Property(scope => scope.VersionNo).IsConcurrencyToken().HasDefaultValue(1L);
        builder.Property(scope => scope.WebEnabled).HasDefaultValue(false).IsRequired();
        builder.Property(scope => scope.ProjectFilesEnabled).HasDefaultValue(false).IsRequired();

        builder.HasIndex(scope => scope.ProjectId).IsUnique();
        builder.HasIndex(scope => new { scope.TenantId, scope.WorkspaceId });
        builder.HasIndex(scope => scope.UpdatedByUserId);

        builder
            .HasOne(scope => scope.Project)
            .WithOne(project => project.ExecutionScope)
            .HasForeignKey<ProjectExecutionScope>(scope => scope.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(scope => scope.UpdatedByUser)
            .WithMany()
            .HasForeignKey(scope => scope.UpdatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class TaskExecutionScopeOverrideConfiguration : IEntityTypeConfiguration<TaskExecutionScopeOverride>
{
    public void Configure(EntityTypeBuilder<TaskExecutionScopeOverride> builder)
    {
        builder.ToTable("task_execution_scope_overrides");
        builder.ConfigureAuditableEntity();

        builder.Property(scope => scope.VersionNo).IsConcurrencyToken().HasDefaultValue(1L);
        builder.Property(scope => scope.WebEnabled).HasDefaultValue(false).IsRequired();
        builder.Property(scope => scope.ProjectFilesEnabled).HasDefaultValue(false).IsRequired();

        builder.HasIndex(scope => scope.TaskItemId).IsUnique();
        builder.HasIndex(scope => new { scope.TenantId, scope.WorkspaceId, scope.ProjectId });
        builder.HasIndex(scope => scope.UpdatedByUserId);

        builder
            .HasOne(scope => scope.Project)
            .WithMany()
            .HasForeignKey(scope => scope.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(scope => scope.TaskItem)
            .WithOne(task => task.ExecutionScopeOverride)
            .HasForeignKey<TaskExecutionScopeOverride>(scope => new { scope.TaskItemId, scope.ProjectId })
            .HasPrincipalKey<TaskItem>(task => new { task.Id, task.ProjectId })
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(scope => scope.UpdatedByUser)
            .WithMany()
            .HasForeignKey(scope => scope.UpdatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class TaskExecutionRunConfiguration : IEntityTypeConfiguration<TaskExecutionRun>
{
    public void Configure(EntityTypeBuilder<TaskExecutionRun> builder)
    {
        builder.ToTable("task_execution_runs");
        builder.ConfigureEntity();

        builder.Property(run => run.RequestedAtUtc).IsRequired();
        builder.Property(run => run.QueuedAtUtc);
        builder.Property(run => run.StartedAtUtc);
        builder.Property(run => run.Status).HasEnumStringConversion().IsRequired();
        builder.Property(run => run.RuntimeProvider)
            .HasEnumStringConversion()
            .HasMaxLength(80)
            .HasDefaultValue(TaskExecutionProvider.FirstPartyProjectFilesRuntimeV1)
            .IsRequired();
        builder.Property(run => run.RuntimeContractVersion)
            .HasDefaultValue(TaskExecutionRun.RuntimeContractVersion1)
            .IsRequired();
        builder.Property(run => run.FailureCode).HasMaxLength(100);
        builder.Property(run => run.VersionNo).IsConcurrencyToken().HasDefaultValue(1L);
        builder.Property(run => run.SnapshotSchemaVersion).IsRequired();
        builder.Property(run => run.SnapshotScopeOrigin).HasEnumStringConversion().IsRequired();
        builder.Property(run => run.SnapshotProjectScopeVersion).IsRequired();
        builder.Property(run => run.SnapshotWebEnabled).IsRequired();
        builder.Property(run => run.SnapshotProjectFilesEnabled).IsRequired();

        builder.HasIndex(run => new { run.TenantId, run.TaskItemId, run.RequestedAtUtc });
        builder.HasIndex(run => new { run.TenantId, run.ProjectId, run.RequestedAtUtc });
        builder.HasIndex(run => run.RequestedByUserId);

        builder
            .HasOne(run => run.Project)
            .WithMany()
            .HasForeignKey(run => run.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(run => run.TaskItem)
            .WithMany(task => task.ExecutionRuns)
            .HasForeignKey(run => new { run.TaskItemId, run.ProjectId })
            .HasPrincipalKey(task => new { task.Id, task.ProjectId })
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(run => run.RequestedByUser)
            .WithMany()
            .HasForeignKey(run => run.RequestedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
