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
        builder.Property(announcement => announcement.Priority).HasEnumStringConversion().IsRequired();
        builder.Property(announcement => announcement.PublishedAt).IsRequired();

        builder.HasIndex(announcement => announcement.WorkspaceId);
        builder.HasIndex(announcement => announcement.GroupId);
        builder.HasIndex(announcement => announcement.ChannelId);
        builder.HasIndex(announcement => announcement.PublishedAt);
        builder.HasIndex(announcement => announcement.ExpiresAt);
        builder.HasIndex(announcement => announcement.AuthorUserId);
        builder.HasIndex(announcement => announcement.IsPinned);

        builder
            .HasOne(announcement => announcement.Workspace)
            .WithMany()
            .HasForeignKey(announcement => announcement.WorkspaceId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(announcement => announcement.Group)
            .WithMany()
            .HasForeignKey(announcement => announcement.GroupId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(announcement => announcement.Channel)
            .WithMany()
            .HasForeignKey(announcement => announcement.ChannelId)
            .OnDelete(DeleteBehavior.SetNull);

        builder
            .HasOne(announcement => announcement.AuthorUser)
            .WithMany()
            .HasForeignKey(announcement => announcement.AuthorUserId)
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

        builder.HasIndex(read => new { read.TenantId, read.AnnouncementId, read.UserId }).IsUnique();
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

        builder.Property(notification => notification.NotificationType).HasEnumStringConversion().IsRequired();
        builder.Property(notification => notification.Title).HasMaxLength(200).IsRequired();
        builder.Property(notification => notification.Body).HasMaxLength(2000);
        builder.Property(notification => notification.RelatedEntityType).HasMaxLength(80);
        builder.Property(notification => notification.CreatedAt).IsRequired();

        builder.HasIndex(notification => notification.UserId);
        builder.HasIndex(notification => notification.CreatedAt);
        builder.HasIndex(notification => notification.ReadAt);
        builder.HasIndex(notification => notification.DeletedAt);
        builder.HasIndex(notification => new { notification.UserId, notification.IsRead, notification.DeletedAt });
        builder.HasIndex(notification => new { notification.TenantId, notification.UserId, notification.IsRead, notification.CreatedAt });
        builder.HasIndex(notification => new { notification.RelatedEntityType, notification.RelatedEntityId });

        builder
            .HasOne(notification => notification.User)
            .WithMany()
            .HasForeignKey(notification => notification.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
