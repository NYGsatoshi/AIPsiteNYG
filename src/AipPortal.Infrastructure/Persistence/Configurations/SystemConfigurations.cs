using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class AttachmentConfiguration : IEntityTypeConfiguration<Attachment>
{
    public void Configure(EntityTypeBuilder<Attachment> builder)
    {
        builder.ToTable("attachments");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(attachment => attachment.FileName).HasMaxLength(260).IsRequired();
        builder.Property(attachment => attachment.ContentType).HasMaxLength(160).IsRequired();
        builder.Property(attachment => attachment.Extension).HasMaxLength(32).IsRequired();
        builder.Property(attachment => attachment.StorageProvider).HasMaxLength(80).IsRequired();
        builder.Property(attachment => attachment.StorageKey).HasMaxLength(1024).IsRequired();
        builder.Property(attachment => attachment.ScanStatus).HasEnumStringConversion().IsRequired();

        builder.HasIndex(attachment => attachment.WorkspaceId);
        builder.HasIndex(attachment => attachment.OwnerUserId);
        builder.HasIndex(attachment => attachment.ScanStatus);
        builder.HasIndex(attachment => attachment.Extension);

        builder
            .HasOne(attachment => attachment.Workspace)
            .WithMany()
            .HasForeignKey(attachment => attachment.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(attachment => attachment.OwnerUser)
            .WithMany()
            .HasForeignKey(attachment => attachment.OwnerUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class FileScanResultConfiguration : IEntityTypeConfiguration<FileScanResult>
{
    public void Configure(EntityTypeBuilder<FileScanResult> builder)
    {
        builder.ToTable("file_scan_results");
        builder.ConfigureEntity();

        builder.Property(result => result.Status).HasEnumStringConversion().IsRequired();
        builder.Property(result => result.ScannerName).HasMaxLength(120).IsRequired();
        builder.Property(result => result.ResultSummary).HasMaxLength(2000);
        builder.Property(result => result.ScannedAt).IsRequired();

        builder.HasIndex(result => result.AttachmentId);
        builder.HasIndex(result => result.ScannedAt);

        builder
            .HasOne(result => result.Attachment)
            .WithMany(attachment => attachment.ScanResults)
            .HasForeignKey(result => result.AttachmentId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class AuditLogConfiguration : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> builder)
    {
        builder.ToTable("audit_logs");
        builder.ConfigureEntity();

        builder.Property(log => log.Action).HasMaxLength(160).IsRequired();
        builder.Property(log => log.TargetType).HasEnumStringConversion().IsRequired();
        builder.Property(log => log.Summary).HasMaxLength(2000);
        builder.Property(log => log.MetadataJson).HasColumnType("jsonb");
        builder.Property(log => log.CorrelationId).HasMaxLength(120);
        builder.Property(log => log.CreatedAt).IsRequired();

        builder.HasIndex(log => log.ActorUserId);
        builder.HasIndex(log => log.WorkspaceId);
        builder.HasIndex(log => new { log.TargetType, log.TargetId });
        builder.HasIndex(log => log.CreatedAt);

        builder
            .HasOne(log => log.ActorUser)
            .WithMany()
            .HasForeignKey(log => log.ActorUserId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(log => log.Workspace)
            .WithMany()
            .HasForeignKey(log => log.WorkspaceId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

public sealed class FeatureModuleConfiguration : IEntityTypeConfiguration<FeatureModule>
{
    public void Configure(EntityTypeBuilder<FeatureModule> builder)
    {
        builder.ToTable("feature_modules");
        builder.ConfigureEntity();

        builder.Property(module => module.Key).HasMaxLength(120).IsRequired();
        builder.Property(module => module.Name).HasMaxLength(160).IsRequired();
        builder.Property(module => module.Description).HasMaxLength(1000);

        builder.HasIndex(module => module.Key).IsUnique();
        builder.HasIndex(module => module.SortOrder);
    }
}

public sealed class PanelDefinitionConfiguration : IEntityTypeConfiguration<PanelDefinition>
{
    public void Configure(EntityTypeBuilder<PanelDefinition> builder)
    {
        builder.ToTable("panel_definitions");
        builder.ConfigureEntity();

        builder.Property(panel => panel.Key).HasMaxLength(120).IsRequired();
        builder.Property(panel => panel.Name).HasMaxLength(160).IsRequired();
        builder.Property(panel => panel.Route).HasMaxLength(300).IsRequired();
        builder.Property(panel => panel.DefaultDockArea).HasEnumStringConversion().IsRequired();

        builder.HasIndex(panel => panel.FeatureModuleId);
        builder.HasIndex(panel => panel.Key).IsUnique();

        builder
            .HasOne(panel => panel.FeatureModule)
            .WithMany(module => module.PanelDefinitions)
            .HasForeignKey(panel => panel.FeatureModuleId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class UserLayoutConfiguration : IEntityTypeConfiguration<UserLayout>
{
    public void Configure(EntityTypeBuilder<UserLayout> builder)
    {
        builder.ToTable("user_layouts");
        builder.ConfigureEntity();

        builder.Property(layout => layout.Name).HasMaxLength(160).IsRequired();
        builder.Property(layout => layout.LayoutJson).HasColumnType("jsonb").IsRequired();
        builder.Property(layout => layout.UpdatedAt).IsRequired();

        builder.HasIndex(layout => layout.UserId);
        builder.HasIndex(layout => layout.WorkspaceId);
        builder.HasIndex(layout => new { layout.UserId, layout.WorkspaceId, layout.Name }).IsUnique();

        builder
            .HasOne(layout => layout.User)
            .WithMany()
            .HasForeignKey(layout => layout.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(layout => layout.Workspace)
            .WithMany()
            .HasForeignKey(layout => layout.WorkspaceId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

public sealed class CommandDefinitionConfiguration : IEntityTypeConfiguration<CommandDefinition>
{
    public void Configure(EntityTypeBuilder<CommandDefinition> builder)
    {
        builder.ToTable("command_definitions");
        builder.ConfigureEntity();

        builder.Property(command => command.Key).HasMaxLength(120).IsRequired();
        builder.Property(command => command.Name).HasMaxLength(160).IsRequired();
        builder.Property(command => command.Description).HasMaxLength(1000);
        builder.Property(command => command.Icon).HasMaxLength(120);
        builder.Property(command => command.Route).HasMaxLength(300);
        builder.Property(command => command.HandlerKey).HasMaxLength(160);

        builder.HasIndex(command => command.FeatureModuleId);
        builder.HasIndex(command => command.Key).IsUnique();

        builder
            .HasOne(command => command.FeatureModule)
            .WithMany(module => module.CommandDefinitions)
            .HasForeignKey(command => command.FeatureModuleId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

public sealed class RadialMenuProfileConfiguration : IEntityTypeConfiguration<RadialMenuProfile>
{
    public void Configure(EntityTypeBuilder<RadialMenuProfile> builder)
    {
        builder.ToTable("radial_menu_profiles");
        builder.ConfigureAuditableEntity();

        builder.Property(profile => profile.Name).HasMaxLength(160).IsRequired();
        builder.Property(profile => profile.Scope).HasEnumStringConversion().IsRequired();

        builder.HasIndex(profile => profile.UserId);
        builder.HasIndex(profile => profile.WorkspaceId);
        builder.HasIndex(profile => new { profile.UserId, profile.WorkspaceId, profile.Name }).IsUnique();

        builder
            .HasOne(profile => profile.User)
            .WithMany()
            .HasForeignKey(profile => profile.UserId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(profile => profile.Workspace)
            .WithMany()
            .HasForeignKey(profile => profile.WorkspaceId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

public sealed class RadialMenuItemConfiguration : IEntityTypeConfiguration<RadialMenuItem>
{
    public void Configure(EntityTypeBuilder<RadialMenuItem> builder)
    {
        builder.ToTable("radial_menu_items");
        builder.ConfigureEntity();

        builder.Property(item => item.Label).HasMaxLength(160).IsRequired();
        builder.Property(item => item.Icon).HasMaxLength(120);
        builder.Property(item => item.AngleDegrees).HasPrecision(6, 2);
        builder.Property(item => item.PayloadJson).HasColumnType("jsonb");

        builder.HasIndex(item => item.RadialMenuProfileId);
        builder.HasIndex(item => item.CommandDefinitionId);
        builder.HasIndex(item => item.ParentItemId);
        builder.HasIndex(item => new { item.RadialMenuProfileId, item.SortOrder });

        builder
            .HasOne(item => item.RadialMenuProfile)
            .WithMany(profile => profile.Items)
            .HasForeignKey(item => item.RadialMenuProfileId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(item => item.CommandDefinition)
            .WithMany()
            .HasForeignKey(item => item.CommandDefinitionId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(item => item.ParentItem)
            .WithMany(parent => parent.ChildItems)
            .HasForeignKey(item => item.ParentItemId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
