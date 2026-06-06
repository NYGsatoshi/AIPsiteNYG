using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> builder)
    {
        builder.ToTable("projects");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(project => project.Name).HasMaxLength(200).IsRequired();
        builder.Property(project => project.Slug).HasMaxLength(140).IsRequired();
        builder.Property(project => project.Description).HasMaxLength(4000);
        builder.Property(project => project.Status).HasEnumStringConversion().IsRequired();

        builder.HasIndex(project => project.WorkspaceId);
        builder.HasIndex(project => project.GroupId);
        builder.HasIndex(project => project.OwnerUserId);
        builder.HasIndex(project => new { project.WorkspaceId, project.Slug }).IsUnique();
        builder.HasIndex(project => project.Status);
        builder.HasIndex(project => project.DueDate);

        builder
            .HasOne(project => project.Workspace)
            .WithMany()
            .HasForeignKey(project => project.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(project => project.Group)
            .WithMany()
            .HasForeignKey(project => project.GroupId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(project => project.CreatedByUser)
            .WithMany()
            .HasForeignKey(project => project.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(project => project.OwnerUser)
            .WithMany()
            .HasForeignKey(project => project.OwnerUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class ProjectMemberConfiguration : IEntityTypeConfiguration<ProjectMember>
{
    public void Configure(EntityTypeBuilder<ProjectMember> builder)
    {
        builder.ToTable("project_members");
        builder.ConfigureAuditableEntity();

        builder.Property(member => member.Role).HasEnumStringConversion().IsRequired();
        builder.Property(member => member.JoinedAt).IsRequired();

        builder.HasIndex(member => new { member.ProjectId, member.UserId }).IsUnique();
        builder.HasIndex(member => member.UserId);

        builder
            .HasOne(member => member.Project)
            .WithMany(project => project.Members)
            .HasForeignKey(member => member.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(member => member.User)
            .WithMany()
            .HasForeignKey(member => member.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class MilestoneConfiguration : IEntityTypeConfiguration<Milestone>
{
    public void Configure(EntityTypeBuilder<Milestone> builder)
    {
        builder.ToTable("milestones");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(milestone => milestone.Name).HasMaxLength(200).IsRequired();
        builder.Property(milestone => milestone.Description).HasMaxLength(4000);
        builder.Property(milestone => milestone.Status).HasEnumStringConversion().IsRequired();

        builder.HasIndex(milestone => milestone.ProjectId);
        builder.HasIndex(milestone => milestone.DueDate);
        builder.HasIndex(milestone => new { milestone.ProjectId, milestone.SortOrder });

        builder
            .HasOne(milestone => milestone.Project)
            .WithMany(project => project.Milestones)
            .HasForeignKey(milestone => milestone.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class TaskItemConfiguration : IEntityTypeConfiguration<TaskItem>
{
    public void Configure(EntityTypeBuilder<TaskItem> builder)
    {
        builder.ToTable("task_items");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(task => task.Title).HasMaxLength(240).IsRequired();
        builder.Property(task => task.Description).HasMaxLength(8000);
        builder.Property(task => task.Status).HasEnumStringConversion().IsRequired();
        builder.Property(task => task.Priority).HasEnumStringConversion().IsRequired();

        builder.HasIndex(task => task.ProjectId);
        builder.HasIndex(task => task.MilestoneId);
        builder.HasIndex(task => task.CreatedByUserId);
        builder.HasIndex(task => task.Status);
        builder.HasIndex(task => task.Priority);
        builder.HasIndex(task => task.DueDate);
        builder.HasIndex(task => new { task.ProjectId, task.SortOrder });

        builder
            .HasOne(task => task.Project)
            .WithMany(project => project.Tasks)
            .HasForeignKey(task => task.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(task => task.Milestone)
            .WithMany(milestone => milestone.Tasks)
            .HasForeignKey(task => task.MilestoneId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(task => task.CreatedByUser)
            .WithMany()
            .HasForeignKey(task => task.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class TaskAssignmentConfiguration : IEntityTypeConfiguration<TaskAssignment>
{
    public void Configure(EntityTypeBuilder<TaskAssignment> builder)
    {
        builder.ToTable("task_assignments");
        builder.ConfigureEntity();

        builder.Property(assignment => assignment.Role).HasEnumStringConversion().IsRequired();
        builder.Property(assignment => assignment.EstimatedHours).HasPrecision(8, 2);
        builder.Property(assignment => assignment.ActualHours).HasPrecision(8, 2);
        builder.Property(assignment => assignment.AssignedAt).IsRequired();

        builder.HasIndex(assignment => new { assignment.TaskItemId, assignment.UserId, assignment.Role }).IsUnique();
        builder.HasIndex(assignment => assignment.UserId);
        builder.HasIndex(assignment => assignment.AssignedByUserId);

        builder
            .HasOne(assignment => assignment.TaskItem)
            .WithMany(task => task.Assignments)
            .HasForeignKey(assignment => assignment.TaskItemId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(assignment => assignment.User)
            .WithMany()
            .HasForeignKey(assignment => assignment.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(assignment => assignment.AssignedByUser)
            .WithMany()
            .HasForeignKey(assignment => assignment.AssignedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class TaskDependencyConfiguration : IEntityTypeConfiguration<TaskDependency>
{
    public void Configure(EntityTypeBuilder<TaskDependency> builder)
    {
        builder.ToTable("task_dependencies");
        builder.ConfigureAuditableEntity();

        builder.Property(dependency => dependency.DependencyType).HasEnumStringConversion().IsRequired();

        builder.HasIndex(dependency => dependency.ProjectId);
        builder.HasIndex(dependency => new { dependency.PredecessorTaskItemId, dependency.SuccessorTaskItemId }).IsUnique();

        builder
            .HasOne(dependency => dependency.Project)
            .WithMany()
            .HasForeignKey(dependency => dependency.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(dependency => dependency.PredecessorTaskItem)
            .WithMany(task => task.SuccessorDependencies)
            .HasForeignKey(dependency => dependency.PredecessorTaskItemId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(dependency => dependency.SuccessorTaskItem)
            .WithMany(task => task.PredecessorDependencies)
            .HasForeignKey(dependency => dependency.SuccessorTaskItemId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class ActivityLogConfiguration : IEntityTypeConfiguration<ActivityLog>
{
    public void Configure(EntityTypeBuilder<ActivityLog> builder)
    {
        builder.ToTable("activity_logs");
        builder.ConfigureAuditableEntity();

        builder.Property(log => log.ActivityType).HasEnumStringConversion().IsRequired();
        builder.Property(log => log.Body).HasMaxLength(12000).IsRequired();
        builder.Property(log => log.OccurredAt).IsRequired();

        builder.HasIndex(log => log.ProjectId);
        builder.HasIndex(log => log.TaskItemId);
        builder.HasIndex(log => log.AuthorUserId);
        builder.HasIndex(log => log.OccurredAt);

        builder
            .HasOne(log => log.Project)
            .WithMany()
            .HasForeignKey(log => log.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(log => log.TaskItem)
            .WithMany()
            .HasForeignKey(log => log.TaskItemId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(log => log.AuthorUser)
            .WithMany()
            .HasForeignKey(log => log.AuthorUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class ArtifactConfiguration : IEntityTypeConfiguration<Artifact>
{
    public void Configure(EntityTypeBuilder<Artifact> builder)
    {
        builder.ToTable("artifacts");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(artifact => artifact.Name).HasMaxLength(240).IsRequired();
        builder.Property(artifact => artifact.Description).HasMaxLength(4000);

        builder.HasIndex(artifact => artifact.ProjectId);
        builder.HasIndex(artifact => artifact.TaskItemId);
        builder.HasIndex(artifact => artifact.CurrentVersionId);
        builder.HasIndex(artifact => artifact.CreatedByUserId);

        builder
            .HasOne(artifact => artifact.Project)
            .WithMany()
            .HasForeignKey(artifact => artifact.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(artifact => artifact.TaskItem)
            .WithMany()
            .HasForeignKey(artifact => artifact.TaskItemId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(artifact => artifact.CurrentVersion)
            .WithMany()
            .HasForeignKey(artifact => artifact.CurrentVersionId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(artifact => artifact.CreatedByUser)
            .WithMany()
            .HasForeignKey(artifact => artifact.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class ArtifactVersionConfiguration : IEntityTypeConfiguration<ArtifactVersion>
{
    public void Configure(EntityTypeBuilder<ArtifactVersion> builder)
    {
        builder.ToTable("artifact_versions");
        builder.ConfigureAuditableEntity();

        builder.Property(version => version.Notes).HasMaxLength(4000);

        builder.HasIndex(version => new { version.ArtifactId, version.VersionNumber }).IsUnique();
        builder.HasIndex(version => version.AttachmentId);
        builder.HasIndex(version => version.CreatedByUserId);

        builder
            .HasOne(version => version.Artifact)
            .WithMany(artifact => artifact.Versions)
            .HasForeignKey(version => version.ArtifactId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(version => version.Attachment)
            .WithMany()
            .HasForeignKey(version => version.AttachmentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(version => version.CreatedByUser)
            .WithMany()
            .HasForeignKey(version => version.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class CommentConfiguration : IEntityTypeConfiguration<Comment>
{
    public void Configure(EntityTypeBuilder<Comment> builder)
    {
        builder.ToTable("comments");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(comment => comment.TargetType).HasEnumStringConversion().IsRequired();
        builder.Property(comment => comment.Body).HasMaxLength(12000).IsRequired();

        builder.HasIndex(comment => comment.WorkspaceId);
        builder.HasIndex(comment => comment.AuthorUserId);
        builder.HasIndex(comment => new { comment.TargetType, comment.TargetId });

        builder
            .HasOne(comment => comment.Workspace)
            .WithMany()
            .HasForeignKey(comment => comment.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(comment => comment.AuthorUser)
            .WithMany()
            .HasForeignKey(comment => comment.AuthorUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class FeedbackConfiguration : IEntityTypeConfiguration<Feedback>
{
    public void Configure(EntityTypeBuilder<Feedback> builder)
    {
        builder.ToTable("feedback");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(feedback => feedback.TargetType).HasEnumStringConversion().IsRequired();
        builder.Property(feedback => feedback.Body).HasMaxLength(12000).IsRequired();

        builder.HasIndex(feedback => feedback.WorkspaceId);
        builder.HasIndex(feedback => feedback.AuthorUserId);
        builder.HasIndex(feedback => feedback.TargetUserId);
        builder.HasIndex(feedback => feedback.ProjectId);
        builder.HasIndex(feedback => feedback.TaskItemId);
        builder.HasIndex(feedback => feedback.ArtifactId);
        builder.HasIndex(feedback => feedback.ActivityLogId);

        builder
            .HasOne(feedback => feedback.Workspace)
            .WithMany()
            .HasForeignKey(feedback => feedback.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(feedback => feedback.AuthorUser)
            .WithMany()
            .HasForeignKey(feedback => feedback.AuthorUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(feedback => feedback.TargetUser)
            .WithMany()
            .HasForeignKey(feedback => feedback.TargetUserId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(feedback => feedback.Project)
            .WithMany()
            .HasForeignKey(feedback => feedback.ProjectId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(feedback => feedback.TaskItem)
            .WithMany()
            .HasForeignKey(feedback => feedback.TaskItemId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(feedback => feedback.Artifact)
            .WithMany()
            .HasForeignKey(feedback => feedback.ArtifactId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(feedback => feedback.ActivityLog)
            .WithMany()
            .HasForeignKey(feedback => feedback.ActivityLogId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
