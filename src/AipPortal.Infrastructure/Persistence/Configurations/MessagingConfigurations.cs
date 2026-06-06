using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AipPortal.Infrastructure.Persistence.Configurations;

public sealed class ConversationConfiguration : IEntityTypeConfiguration<Conversation>
{
    public void Configure(EntityTypeBuilder<Conversation> builder)
    {
        builder.ToTable("conversations");
        builder.ConfigureAuditableEntity();

        builder.Property(conversation => conversation.Type).HasEnumStringConversion().IsRequired();

        builder.HasIndex(conversation => conversation.WorkspaceId);

        builder
            .HasOne(conversation => conversation.Workspace)
            .WithMany()
            .HasForeignKey(conversation => conversation.WorkspaceId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class ConversationMemberConfiguration : IEntityTypeConfiguration<ConversationMember>
{
    public void Configure(EntityTypeBuilder<ConversationMember> builder)
    {
        builder.ToTable("conversation_members");
        builder.ConfigureAuditableEntity();

        builder.Property(member => member.JoinedAt).IsRequired();

        builder.HasIndex(member => new { member.ConversationId, member.UserId }).IsUnique();
        builder.HasIndex(member => member.UserId);
        builder.HasIndex(member => member.LastReadMessageId);

        builder
            .HasOne(member => member.Conversation)
            .WithMany(conversation => conversation.Members)
            .HasForeignKey(member => member.ConversationId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(member => member.User)
            .WithMany()
            .HasForeignKey(member => member.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(member => member.LastReadMessage)
            .WithMany()
            .HasForeignKey(member => member.LastReadMessageId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}

public sealed class MessageConfiguration : IEntityTypeConfiguration<Message>
{
    public void Configure(EntityTypeBuilder<Message> builder)
    {
        builder.ToTable("messages");
        builder.ConfigureSoftDeletableEntity();

        builder.Property(message => message.Body).HasMaxLength(12000).IsRequired();

        builder.HasIndex(message => message.ConversationId);
        builder.HasIndex(message => message.AuthorUserId);

        builder
            .HasOne(message => message.Conversation)
            .WithMany(conversation => conversation.Messages)
            .HasForeignKey(message => message.ConversationId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasOne(message => message.AuthorUser)
            .WithMany()
            .HasForeignKey(message => message.AuthorUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class ReadStateConfiguration : IEntityTypeConfiguration<ReadState>
{
    public void Configure(EntityTypeBuilder<ReadState> builder)
    {
        builder.ToTable("read_states");
        builder.ConfigureAuditableEntity();

        builder.Property(readState => readState.ScopeType).HasEnumStringConversion().IsRequired();
        builder.Property(readState => readState.LastReadAt).IsRequired();

        builder.HasIndex(readState => new { readState.UserId, readState.ScopeType, readState.ScopeId }).IsUnique();
        builder.HasIndex(readState => readState.ScopeId);
        builder.HasIndex(readState => readState.LastReadAt);

        builder
            .HasOne(readState => readState.User)
            .WithMany()
            .HasForeignKey(readState => readState.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
