using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class MessagingRepository(AppDbContext dbContext) : IMessagingRepository
{
    public async Task<PagedResponse<Conversation>> ListForUserAsync(Guid userId, int page, int pageSize, CancellationToken cancellationToken = default)
    {
        var visibleProjectIds = dbContext.Projects
            .AsNoTracking()
            .Where(project =>
                project.DeletedAt == null &&
                project.Status != ProjectStatus.Archived &&
                project.Status != ProjectStatus.Deleted &&
                dbContext.WorkspaceMembers.Any(workspaceMember =>
                    workspaceMember.WorkspaceId == project.WorkspaceId &&
                    workspaceMember.UserId == userId &&
                    workspaceMember.Status == MembershipStatus.Active) &&
                (dbContext.ProjectMembers.Any(projectMember =>
                     projectMember.ProjectId == project.Id && projectMember.UserId == userId) ||
                 ((project.Status == ProjectStatus.Active ||
                   project.Status == ProjectStatus.Review ||
                   project.Status == ProjectStatus.Completed) &&
                  (!project.GroupId.HasValue ||
                   dbContext.WorkspaceMembers.Any(workspaceMember =>
                       workspaceMember.WorkspaceId == project.WorkspaceId &&
                       workspaceMember.UserId == userId &&
                       workspaceMember.Status == MembershipStatus.Active &&
                       (workspaceMember.Role == WorkspaceRole.Owner || workspaceMember.Role == WorkspaceRole.Admin)) ||
                   dbContext.GroupMembers.Any(groupMember =>
                       groupMember.GroupId == project.GroupId.Value && groupMember.UserId == userId)))))
            .Select(project => project.Id);

        var query = dbContext.Conversations
            .AsNoTracking()
            .Where(c =>
                (c.Type == Domain.Enums.ConversationType.DirectMessage ||
                    c.Type == Domain.Enums.ConversationType.ProjectChannel ||
                    c.Type == Domain.Enums.ConversationType.Thread) &&
                c.Members.Any(m => m.UserId == userId && m.LeftAt == null && m.RemovedAt == null && m.CanRead) &&
                (c.Type != Domain.Enums.ConversationType.Thread ||
                    c.ParentConversationId != null &&
                    c.ParentConversation!.Members.Any(m => m.UserId == userId && m.LeftAt == null && m.RemovedAt == null && m.CanRead)) &&
                (c.Type != Domain.Enums.ConversationType.ProjectChannel || c.ProjectId.HasValue) &&
                (!c.ProjectId.HasValue || visibleProjectIds.Contains(c.ProjectId.Value)))
            .OrderByDescending(c => c.UpdatedAt ?? c.CreatedAt);

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return new PagedResponse<Conversation>(items, page, pageSize, total);
    }

    public async Task<IReadOnlyList<User>> SearchDirectRecipientsAsync(Guid userId, string? query, int limit, CancellationToken cancellationToken = default)
    {
        var normalizedQuery = query?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedQuery))
        {
            return [];
        }

        var normalizedLowerQuery = normalizedQuery.ToLowerInvariant();
        return await dbContext.Users
            .AsNoTracking()
            .Where(user =>
                user.Id != userId &&
                user.Status == UserStatus.Active &&
                user.DeletedAt == null &&
                (user.DisplayName.ToLower().Contains(normalizedLowerQuery) ||
                    user.Email.ToLower().Contains(normalizedLowerQuery)) &&
                dbContext.TenantUsers.Any(tenantUser =>
                    tenantUser.UserId == user.Id &&
                    tenantUser.Status == TenantUserStatus.Active) &&
                dbContext.WorkspaceMembers.Any(member =>
                    member.UserId == user.Id &&
                    member.Status == MembershipStatus.Active &&
                    member.Workspace != null &&
                    member.Workspace.Status == WorkspaceStatus.Active &&
                    member.Workspace.DeletedAt == null &&
                    dbContext.WorkspaceMembers.Any(currentMember =>
                        currentMember.WorkspaceId == member.WorkspaceId &&
                        currentMember.UserId == userId &&
                        currentMember.Status == MembershipStatus.Active)))
            .OrderBy(user => user.DisplayName)
            .ThenBy(user => user.Id)
            .Take(Math.Clamp(limit, 1, 25))
            .ToListAsync(cancellationToken);
    }

    public Task<Conversation?> GetConversationAsync(Guid conversationId, CancellationToken cancellationToken = default)
    {
        return dbContext.Conversations.FirstOrDefaultAsync(c => c.Id == conversationId, cancellationToken);
    }

    public Task<Conversation?> FindDirectAsync(Guid workspaceId, Guid userAId, Guid userBId, CancellationToken cancellationToken = default)
    {
        return dbContext.Conversations
            .Where(c => c.WorkspaceId == workspaceId && c.Type == Domain.Enums.ConversationType.DirectMessage && c.Members.Count == 2)
            .FirstOrDefaultAsync(c =>
                c.Members.Any(m => m.UserId == userAId && m.LeftAt == null && m.RemovedAt == null && m.CanRead) &&
                c.Members.Any(m => m.UserId == userBId && m.LeftAt == null && m.RemovedAt == null && m.CanRead),
                cancellationToken);
    }

    public Task<Conversation?> FindDirectForUsersAsync(Guid userAId, Guid userBId, CancellationToken cancellationToken = default)
    {
        return dbContext.Conversations
            .Where(c => c.Type == ConversationType.DirectMessage && c.Members.Count == 2)
            .OrderBy(c => c.CreatedAt)
            .FirstOrDefaultAsync(c =>
                c.Members.Any(m => m.UserId == userAId && m.LeftAt == null && m.RemovedAt == null && m.CanRead) &&
                c.Members.Any(m => m.UserId == userBId && m.LeftAt == null && m.RemovedAt == null && m.CanRead),
                cancellationToken);
    }

    public Task<Workspace?> FindSharedActiveWorkspaceAsync(Guid userAId, Guid userBId, CancellationToken cancellationToken = default)
    {
        return dbContext.Workspaces
            .AsNoTracking()
            .Where(workspace =>
                workspace.Status == WorkspaceStatus.Active &&
                workspace.DeletedAt == null &&
                workspace.Members.Any(member => member.UserId == userAId && member.Status == MembershipStatus.Active) &&
                workspace.Members.Any(member => member.UserId == userBId && member.Status == MembershipStatus.Active))
            .OrderBy(workspace => workspace.Name)
            .FirstOrDefaultAsync(cancellationToken);
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
        var query = dbContext.Messages
            .AsNoTracking()
            .Include(m => m.AuthorUser)
            .Include(m => m.Attachments)
            .ThenInclude(a => a.Attachment)
            .Where(m => m.ConversationId == conversationId && m.DeletedAt == null);
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

    public Task<Message?> FindMessageByClientRequestIdAsync(Guid conversationId, Guid authorUserId, Guid clientRequestId, CancellationToken cancellationToken = default)
    {
        return dbContext.Messages
            .Include(m => m.AuthorUser)
            .Include(m => m.Attachments)
            .ThenInclude(a => a.Attachment)
            .FirstOrDefaultAsync(m =>
                m.ConversationId == conversationId &&
                m.AuthorUserId == authorUserId &&
                m.ClientRequestId == clientRequestId,
                cancellationToken);
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
