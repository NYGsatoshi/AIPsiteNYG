using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class TaskWorkflowTemplateConfiguration : IEntityTypeConfiguration<TaskWorkflowTemplate>
{
    public void Configure(EntityTypeBuilder<TaskWorkflowTemplate> builder)
    {
        builder.ToTable("task_workflow_templates");
        builder.ConfigureAuditableEntity();

        builder.Property(template => template.Name).HasMaxLength(120).IsRequired();
        builder.Property(template => template.VersionNo).IsConcurrencyToken().HasDefaultValue(1L);

        // The composite alternate key is the Tenant-safe principal identity used
        // by Workspace/TenantSettings defaults and template stages.
        builder.HasAlternateKey(template => new { template.TenantId, template.Id });
        builder.HasIndex(template => new { template.TenantId, template.Name });

        builder.HasMany<Workspace>()
            .WithOne(workspace => workspace.DefaultTaskWorkflowTemplate)
            .HasForeignKey(workspace => new { workspace.TenantId, workspace.DefaultTaskWorkflowTemplateId })
            .HasPrincipalKey(template => new { template.TenantId, template.Id })
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany<TenantSettings>()
            .WithOne(settings => settings.DefaultTaskWorkflowTemplate)
            .HasForeignKey(settings => new { settings.TenantId, settings.DefaultTaskWorkflowTemplateId })
            .HasPrincipalKey(template => new { template.TenantId, template.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class TaskWorkflowTemplateStageConfiguration : IEntityTypeConfiguration<TaskWorkflowTemplateStage>
{
    public void Configure(EntityTypeBuilder<TaskWorkflowTemplateStage> builder)
    {
        builder.ToTable("task_workflow_template_stages", table =>
            table.HasCheckConstraint(
                "CK_task_workflow_template_stages_wip",
                "\"WipWarningLimit\" IS NULL OR \"WipWarningLimit\" > 0"));
        builder.ConfigureEntity();

        builder.Property(stage => stage.Name).HasMaxLength(120).IsRequired();
        builder.Property(stage => stage.InternalCategory).HasEnumStringConversion().IsRequired();
        builder.Property(stage => stage.VersionNo).IsConcurrencyToken().HasDefaultValue(1L);

        builder.HasIndex(stage => new { stage.TemplateId, stage.SortKey }).IsUnique();
        builder.HasIndex(stage => new { stage.TenantId, stage.TemplateId });

        builder.HasOne(stage => stage.Template)
            .WithMany(template => template.Stages)
            .HasForeignKey(stage => new { stage.TenantId, stage.TemplateId })
            .HasPrincipalKey(template => new { template.TenantId, template.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}
