using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class AnnouncementConfiguration : IEntityTypeConfiguration<Announcement>
{
    public void Configure(EntityTypeBuilder<Announcement> builder)
    {
        builder.ToTable("announcements");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(announcement => announcement.Title).HasMaxLength(200).IsRequired();
        builder.Property(announcement => announcement.Body).HasMaxLength(20000).IsRequired();

        builder.HasIndex(announcement => announcement.WorkspaceId);
        builder.HasIndex(announcement => announcement.GroupId);
        builder.HasIndex(announcement => announcement.PublishedAt);
        builder.HasIndex(announcement => announcement.CreatedByUserId);

        builder
            .HasOne(announcement => announcement.Workspace)
            .WithMany()
            .HasForeignKey(announcement => announcement.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(announcement => announcement.Group)
            .WithMany()
            .HasForeignKey(announcement => announcement.GroupId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(announcement => announcement.CreatedByUser)
            .WithMany()
            .HasForeignKey(announcement => announcement.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class AnnouncementReadConfiguration : IEntityTypeConfiguration<AnnouncementRead>
{
    public void Configure(EntityTypeBuilder<AnnouncementRead> builder)
    {
        builder.ToTable("announcement_reads");
        builder.ConfigureEntity();

        builder.Property(read => read.ReadAt).IsRequired();

        builder.HasIndex(read => new { read.AnnouncementId, read.UserId }).IsUnique();
        builder.HasIndex(read => read.UserId);
        builder.HasIndex(read => read.ReadAt);

        builder
            .HasOne(read => read.Announcement)
            .WithMany(announcement => announcement.Reads)
            .HasForeignKey(read => read.AnnouncementId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(read => read.User)
            .WithMany()
            .HasForeignKey(read => read.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.ToTable("notifications");
        builder.ConfigureEntity();

        builder.Property(notification => notification.Type).HasEnumStringConversion().IsRequired();
        builder.Property(notification => notification.SourceType).HasEnumStringConversion().IsRequired();
        builder.Property(notification => notification.Title).HasMaxLength(200).IsRequired();
        builder.Property(notification => notification.Body).HasMaxLength(2000);
        builder.Property(notification => notification.CreatedAt).IsRequired();

        builder.HasIndex(notification => notification.RecipientUserId);
        builder.HasIndex(notification => notification.WorkspaceId);
        builder.HasIndex(notification => notification.CreatedAt);
        builder.HasIndex(notification => notification.ReadAt);
        builder.HasIndex(notification => new { notification.SourceType, notification.SourceId });

        builder
            .HasOne(notification => notification.RecipientUser)
            .WithMany()
            .HasForeignKey(notification => notification.RecipientUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(notification => notification.Workspace)
            .WithMany()
            .HasForeignKey(notification => notification.WorkspaceId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
