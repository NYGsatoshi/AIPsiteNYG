using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class MessagingRepository(AppDbContext dbContext) : IMessagingRepository
{
    public async Task<IReadOnlyList<Conversation>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        return await dbContext.Conversations
            .Where(c => c.Members.Any(m => m.UserId == userId && m.LeftAt == null))
            .OrderByDescending(c => c.UpdatedAt ?? c.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public Task<Conversation?> GetConversationAsync(Guid conversationId, CancellationToken cancellationToken = default)
    {
        return dbContext.Conversations.FirstOrDefaultAsync(c => c.Id == conversationId, cancellationToken);
    }

    public Task<Conversation?> FindDirectAsync(Guid userAId, Guid userBId, CancellationToken cancellationToken = default)
    {
        return dbContext.Conversations
            .Where(c => c.Type == Domain.Enums.ConversationType.Direct && c.Members.Count == 2)
            .FirstOrDefaultAsync(c => c.Members.Any(m => m.UserId == userAId) && c.Members.Any(m => m.UserId == userBId), cancellationToken);
    }

    public Task<ConversationMember?> GetMemberAsync(Guid conversationId, Guid userId, CancellationToken cancellationToken = default)
    {
        return dbContext.ConversationMembers.Include(m => m.User).FirstOrDefaultAsync(m => m.ConversationId == conversationId && m.UserId == userId, cancellationToken);
    }

    public async Task<IReadOnlyList<ConversationMember>> ListMembersAsync(Guid conversationId, CancellationToken cancellationToken = default)
    {
        return await dbContext.ConversationMembers.Include(m => m.User).Where(m => m.ConversationId == conversationId).ToListAsync(cancellationToken);
    }

    public async Task<PagedResponse<Message>> ListMessagesAsync(Guid conversationId, int limit, DateTimeOffset? before, CancellationToken cancellationToken = default)
    {
        var query = dbContext.Messages.Include(m => m.AuthorUser).Include(m => m.Attachments).ThenInclude(a => a.Attachment).Where(m => m.ConversationId == conversationId);
        if (before.HasValue) query = query.Where(m => m.CreatedAt < before.Value);
        var total = await query.CountAsync(cancellationToken);
        var items = await query.OrderByDescending(m => m.CreatedAt).Take(limit).ToListAsync(cancellationToken);
        return new PagedResponse<Message>(items, 1, limit, total);
    }

    public Task<int> CountUnreadMessagesAsync(Guid conversationId, Guid userId, DateTimeOffset? lastReadAt, CancellationToken cancellationToken = default)
    {
        var query = dbContext.Messages.Where(m => m.ConversationId == conversationId && m.AuthorUserId != userId && m.DeletedAt == null);
        if (lastReadAt.HasValue)
        {
            query = query.Where(m => m.CreatedAt > lastReadAt.Value);
        }

        return query.CountAsync(cancellationToken);
    }

    public Task<Message?> GetMessageAsync(Guid messageId, CancellationToken cancellationToken = default)
    {
        return dbContext.Messages.Include(m => m.AuthorUser).Include(m => m.Attachments).ThenInclude(a => a.Attachment).FirstOrDefaultAsync(m => m.Id == messageId, cancellationToken);
    }

    public Task<ReadState?> GetReadStateAsync(Guid conversationId, Guid userId, CancellationToken cancellationToken = default)
    {
        return dbContext.ReadStates.FirstOrDefaultAsync(r => r.ConversationId == conversationId && r.UserId == userId, cancellationToken);
    }

    public async Task AddConversationAsync(Conversation conversation, CancellationToken cancellationToken = default) => await dbContext.Conversations.AddAsync(conversation, cancellationToken);
    public async Task AddMemberAsync(ConversationMember member, CancellationToken cancellationToken = default) => await dbContext.ConversationMembers.AddAsync(member, cancellationToken);
    public async Task AddMessageAsync(Message message, CancellationToken cancellationToken = default) => await dbContext.Messages.AddAsync(message, cancellationToken);
    public async Task AddReadStateAsync(ReadState readState, CancellationToken cancellationToken = default) => await dbContext.ReadStates.AddAsync(readState, cancellationToken);

    public async Task AddAttachmentAsync(Attachment attachment, MessageAttachment link, CancellationToken cancellationToken = default)
    {
        await dbContext.Attachments.AddAsync(attachment, cancellationToken);
        await dbContext.MessageAttachments.AddAsync(link, cancellationToken);
    }
}
