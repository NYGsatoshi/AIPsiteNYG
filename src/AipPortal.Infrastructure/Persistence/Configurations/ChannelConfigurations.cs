using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class ChannelConfiguration : IEntityTypeConfiguration<Channel>
{
    public void Configure(EntityTypeBuilder<Channel> builder)
    {
        builder.ToTable("channels");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(channel => channel.Name).HasMaxLength(160).IsRequired();
        builder.Property(channel => channel.Slug).HasMaxLength(120).IsRequired();
        builder.Property(channel => channel.Description).HasMaxLength(2000);
        builder.Property(channel => channel.Type).HasEnumStringConversion().IsRequired();

        builder.HasIndex(channel => channel.WorkspaceId);
        builder.HasIndex(channel => channel.GroupId);
        builder.HasIndex(channel => new { channel.WorkspaceId, channel.Slug }).IsUnique();

        builder
            .HasOne(channel => channel.Workspace)
            .WithMany()
            .HasForeignKey(channel => channel.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(channel => channel.Group)
            .WithMany()
            .HasForeignKey(channel => channel.GroupId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

public sealed class ChannelMemberConfiguration : IEntityTypeConfiguration<ChannelMember>
{
    public void Configure(EntityTypeBuilder<ChannelMember> builder)
    {
        builder.ToTable("channel_members");
        builder.ConfigureAuditableEntity();

        builder.Property(member => member.Role).HasEnumStringConversion().IsRequired();
        builder.Property(member => member.JoinedAt).IsRequired();

        builder.HasIndex(member => new { member.ChannelId, member.UserId }).IsUnique();
        builder.HasIndex(member => member.UserId);

        builder
            .HasOne(member => member.Channel)
            .WithMany(channel => channel.Members)
            .HasForeignKey(member => member.ChannelId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(member => member.User)
            .WithMany()
            .HasForeignKey(member => member.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class PostConfiguration : IEntityTypeConfiguration<Post>
{
    public void Configure(EntityTypeBuilder<Post> builder)
    {
        builder.ToTable("posts");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(post => post.Body).HasMaxLength(12000).IsRequired();

        builder.HasIndex(post => post.ChannelId);
        builder.HasIndex(post => post.AuthorUserId);

        builder
            .HasOne(post => post.Channel)
            .WithMany(channel => channel.Posts)
            .HasForeignKey(post => post.ChannelId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(post => post.AuthorUser)
            .WithMany()
            .HasForeignKey(post => post.AuthorUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class PostThreadConfiguration : IEntityTypeConfiguration<PostThread>
{
    public void Configure(EntityTypeBuilder<PostThread> builder)
    {
        builder.ToTable("post_threads");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(thread => thread.Body).HasMaxLength(12000).IsRequired();

        builder.HasIndex(thread => thread.PostId);
        builder.HasIndex(thread => thread.AuthorUserId);

        builder
            .HasOne(thread => thread.Post)
            .WithMany(post => post.Threads)
            .HasForeignKey(thread => thread.PostId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(thread => thread.AuthorUser)
            .WithMany()
            .HasForeignKey(thread => thread.AuthorUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
