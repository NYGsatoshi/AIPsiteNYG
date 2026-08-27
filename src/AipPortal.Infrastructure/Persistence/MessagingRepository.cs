using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Messaging;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class MessagingRepository(AppDbContext dbContext) : IMessagingRepository
{
    private const int ConversationAuthorizationBatchSize = 250;
    private const int MaxThreadDepth = 32;

    public async Task<PagedResponse<Conversation>> ListForUserAsync(Guid userId, int page, int pageSize, CancellationToken cancellationToken = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var skip = (int)Math.Min(((long)page - 1L) * pageSize, int.MaxValue);
        var candidates = ReadableConversationCandidates(userId);

        if (UsesPostgreSql())
        {
            var readableIds = QueryReadableConversationIds(userId)!;
            var query = candidates.Where(conversation => readableIds.Contains(conversation.Id));
            var total = await query.CountAsync(cancellationToken);
            var items = await query
                .OrderByDescending(conversation => conversation.UpdatedAt ?? conversation.CreatedAt)
                .ThenBy(conversation => conversation.Id)
                .Skip(skip)
                .Take(pageSize)
                .ToListAsync(cancellationToken);
            return new PagedResponse<Conversation>(items, page, pageSize, total);
        }

        return await ListForUserNonPostgreSqlAsync(userId, page, pageSize, candidates, cancellationToken);
    }

    public IQueryable<Guid>? QueryReadableConversationIds(Guid userId)
    {
        return UsesPostgreSql()
            ? PostgreSqlQueryableReadableConversationIds(userId)
            : null;
    }

    public async Task<IReadOnlySet<Guid>> FilterReadableConversationIdsAsync(
        Guid userId,
        IReadOnlyCollection<Guid> conversationIds,
        CancellationToken cancellationToken = default)
    {
        var originalIds = conversationIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .Take(ConversationAuthorizationBatchSize)
            .ToArray();
        if (originalIds.Length == 0 || dbContext.ActiveTenantId is null)
        {
            return new HashSet<Guid>();
        }

        if (UsesPostgreSql())
        {
            return await PostgreSqlQueryableReadableConversationIds(userId, originalIds)
                .ToHashSetAsync(cancellationToken);
        }

        return await FilterReadableConversationIdsNonPostgreSqlAsync(
            userId,
            originalIds,
            cancellationToken);
    }

    private async Task<IReadOnlySet<Guid>> FilterReadableConversationIdsNonPostgreSqlAsync(
        Guid userId,
        IReadOnlyCollection<Guid> originalIds,
        CancellationToken cancellationToken)
    {
        var currentByOriginal = originalIds.ToDictionary(id => id, id => id);
        var scopeByOriginal = new Dictionary<Guid, ConversationAuthorizationScope>();
        var visitedByOriginal = originalIds.ToDictionary(id => id, _ => new HashSet<Guid>());
        var authorized = new HashSet<Guid>();

        for (var depth = 0; depth <= MaxThreadDepth && currentByOriginal.Count > 0; depth++)
        {
            var currentIds = currentByOriginal.Values.Distinct().ToArray();
            var nodes = await ReadableConversationCandidates(userId)
                .Where(conversation => currentIds.Contains(conversation.Id))
                .Select(conversation => new ConversationAuthorizationNode(
                    conversation.Id,
                    conversation.WorkspaceId,
                    conversation.ProjectId,
                    conversation.Type,
                    conversation.ParentConversationId,
                    conversation.RootConversationId))
                .ToDictionaryAsync(conversation => conversation.Id, cancellationToken);

            foreach (var originalId in currentByOriginal.Keys.ToArray())
            {
                var currentId = currentByOriginal[originalId];
                if (!visitedByOriginal[originalId].Add(currentId) ||
                    !nodes.TryGetValue(currentId, out var node))
                {
                    currentByOriginal.Remove(originalId);
                    continue;
                }

                if (!scopeByOriginal.TryGetValue(originalId, out var scope))
                {
                    scope = new ConversationAuthorizationScope(
                        node.WorkspaceId,
                        node.ProjectId,
                        node.RootConversationId);
                    scopeByOriginal[originalId] = scope;
                }
                else if (node.WorkspaceId != scope.WorkspaceId ||
                         node.ProjectId != scope.ProjectId ||
                         (node.Type == ConversationType.Thread &&
                          node.RootConversationId != scope.RootConversationId))
                {
                    currentByOriginal.Remove(originalId);
                    continue;
                }

                if (node.Type != ConversationType.Thread)
                {
                    if (!scope.RootConversationId.HasValue ||
                        scope.RootConversationId.Value == node.Id)
                    {
                        authorized.Add(originalId);
                    }

                    currentByOriginal.Remove(originalId);
                    continue;
                }

                if (!node.ParentConversationId.HasValue ||
                    !node.RootConversationId.HasValue)
                {
                    currentByOriginal.Remove(originalId);
                    continue;
                }

                currentByOriginal[originalId] = node.ParentConversationId.Value;
            }
        }

        return authorized;
    }

    private IQueryable<Guid> PostgreSqlQueryableReadableConversationIds(
        Guid userId,
        IReadOnlyCollection<Guid>? originIds = null)
    {
        var candidates = ReadableConversationCandidates(userId);
        if (originIds is not null)
        {
            candidates = candidates.Where(conversation => originIds.Contains(conversation.Id));
        }

        var recursivelyReadableIds = PostgreSqlReadableConversationIds(userId, originIds);
        return candidates
            .Where(conversation => recursivelyReadableIds.Contains(conversation.Id))
            .Select(conversation => conversation.Id);
    }

    private IQueryable<Guid> PostgreSqlReadableConversationIds(
        Guid userId,
        IReadOnlyCollection<Guid>? originIds = null)
    {
        var tenantId = dbContext.ActiveTenantId;
        if (!tenantId.HasValue)
        {
            return dbContext.Conversations
                .Where(_ => false)
                .Select(conversation => conversation.Id);
        }

        var restrictOrigins = originIds is not null;
        var requestedOriginIds = originIds?.ToArray() ?? [];
        return dbContext.Database.SqlQuery<Guid>($$"""
            WITH RECURSIVE readable_conversation_ancestry AS (
                SELECT
                    conversation."Id" AS "OriginId",
                    conversation."Id" AS "CurrentId",
                    conversation."WorkspaceId" AS "OriginWorkspaceId",
                    conversation."ProjectId" AS "OriginProjectId",
                    conversation."RootConversationId" AS "OriginRootConversationId",
                    conversation."Type" AS "CurrentType",
                    conversation."ParentConversationId" AS "ParentConversationId",
                    0 AS "Depth",
                    ARRAY[conversation."Id"]::uuid[] AS "VisitedIds"
                FROM conversations AS conversation
                WHERE conversation."TenantId" = {{tenantId.Value}}
                  AND (NOT {{restrictOrigins}} OR conversation."Id" = ANY({{requestedOriginIds}}))
                  AND conversation."Type" IN ('DirectMessage', 'WorkspaceChannel', 'ProjectChannel', 'Thread')
                  AND (conversation."Type" <> 'ProjectChannel' OR conversation."ProjectId" IS NOT NULL)
                  AND (conversation."Type" <> 'WorkspaceChannel' OR (
                      conversation."ProjectId" IS NULL AND EXISTS (
                          SELECT 1
                          FROM workspaces AS workspace
                          INNER JOIN workspace_members AS workspace_member
                              ON workspace_member."WorkspaceId" = workspace."Id"
                             AND workspace_member."TenantId" = workspace."TenantId"
                          WHERE workspace."Id" = conversation."WorkspaceId"
                            AND workspace."TenantId" = {{tenantId.Value}}
                            AND workspace."DeletedAt" IS NULL
                            AND workspace."Status" IN ('Active', 'Archived')
                            AND workspace_member."UserId" = {{userId}}
                            AND workspace_member."Status" = 'Active')))

                  AND (conversation."Type" <> 'Thread' OR
                       (conversation."ParentConversationId" IS NOT NULL AND conversation."RootConversationId" IS NOT NULL))
                  AND EXISTS (
                      SELECT 1
                      FROM conversation_members AS member
                      WHERE member."TenantId" = {{tenantId.Value}}
                        AND member."ConversationId" = conversation."Id"
                        AND member."UserId" = {{userId}}
                        AND member."LeftAt" IS NULL
                        AND member."RemovedAt" IS NULL
                        AND member."CanRead")

                UNION ALL

                SELECT
                    ancestry."OriginId",
                    parent."Id" AS "CurrentId",
                    ancestry."OriginWorkspaceId",
                    ancestry."OriginProjectId",
                    ancestry."OriginRootConversationId",
                    parent."Type" AS "CurrentType",
                    parent."ParentConversationId" AS "ParentConversationId",
                    ancestry."Depth" + 1 AS "Depth",
                    ancestry."VisitedIds" || parent."Id" AS "VisitedIds"
                FROM readable_conversation_ancestry AS ancestry
                INNER JOIN conversations AS parent
                    ON parent."Id" = ancestry."ParentConversationId"
                   AND parent."TenantId" = {{tenantId.Value}}
                WHERE ancestry."CurrentType" = 'Thread'
                  AND ancestry."Depth" < {{MaxThreadDepth}}
                  AND parent."Type" IN ('DirectMessage', 'WorkspaceChannel', 'ProjectChannel', 'Thread')
                  AND (parent."Type" <> 'ProjectChannel' OR parent."ProjectId" IS NOT NULL)
                  AND (parent."Type" <> 'WorkspaceChannel' OR (
                      parent."ProjectId" IS NULL AND EXISTS (
                          SELECT 1
                          FROM workspaces AS workspace
                          INNER JOIN workspace_members AS workspace_member
                              ON workspace_member."WorkspaceId" = workspace."Id"
                             AND workspace_member."TenantId" = workspace."TenantId"
                          WHERE workspace."Id" = parent."WorkspaceId"
                            AND workspace."TenantId" = {{tenantId.Value}}
                            AND workspace."DeletedAt" IS NULL
                            AND workspace."Status" IN ('Active', 'Archived')
                            AND workspace_member."UserId" = {{userId}}
                            AND workspace_member."Status" = 'Active')))

                  AND (parent."Type" <> 'Thread' OR
                       (parent."ParentConversationId" IS NOT NULL AND
                        parent."RootConversationId" = ancestry."OriginRootConversationId"))
                  AND parent."WorkspaceId" = ancestry."OriginWorkspaceId"
                  AND parent."ProjectId" IS NOT DISTINCT FROM ancestry."OriginProjectId"
                  AND NOT parent."Id" = ANY(ancestry."VisitedIds")
                  AND EXISTS (
                      SELECT 1
                      FROM conversation_members AS member
                      WHERE member."TenantId" = {{tenantId.Value}}
                        AND member."ConversationId" = parent."Id"
                        AND member."UserId" = {{userId}}
                        AND member."LeftAt" IS NULL
                        AND member."RemovedAt" IS NULL
                        AND member."CanRead")
            )
            SELECT ancestry."OriginId" AS "Value"
            FROM readable_conversation_ancestry AS ancestry
            WHERE ancestry."CurrentType" <> 'Thread'
              AND (ancestry."OriginRootConversationId" IS NULL OR
                   ancestry."OriginRootConversationId" = ancestry."CurrentId")
            """);
    }

    private async Task<PagedResponse<Conversation>> ListForUserNonPostgreSqlAsync(
        Guid userId,
        int page,
        int pageSize,
        IQueryable<Conversation> candidates,
        CancellationToken cancellationToken)
    {
        var skip = ((long)page - 1L) * pageSize;
        var candidateOffset = 0;
        var total = 0;
        var pageIds = new List<Guid>(pageSize);

        while (true)
        {
            var batch = await candidates
                .OrderByDescending(conversation => conversation.UpdatedAt ?? conversation.CreatedAt)
                .ThenBy(conversation => conversation.Id)
                .Skip(candidateOffset)
                .Take(ConversationAuthorizationBatchSize)
                .Select(conversation => conversation.Id)
                .ToListAsync(cancellationToken);
            if (batch.Count == 0)
            {
                break;
            }

            candidateOffset += batch.Count;
            var readableIds = await FilterReadableConversationIdsNonPostgreSqlAsync(
                userId,
                batch,
                cancellationToken);
            foreach (var candidateId in batch)
            {
                if (!readableIds.Contains(candidateId))
                {
                    continue;
                }

                if ((long)total >= skip && pageIds.Count < pageSize)
                {
                    pageIds.Add(candidateId);
                }

                total++;
            }
        }

        var selected = await dbContext.Conversations
            .AsNoTracking()
            .Where(conversation => pageIds.Contains(conversation.Id))
            .ToDictionaryAsync(conversation => conversation.Id, cancellationToken);
        var items = pageIds
            .Where(selected.ContainsKey)
            .Select(id => selected[id])
            .ToList();

        return new PagedResponse<Conversation>(items, page, pageSize, total);
    }

    private bool UsesPostgreSql() =>
        string.Equals(
            dbContext.Database.ProviderName,
            "Npgsql.EntityFrameworkCore.PostgreSQL",
            StringComparison.Ordinal);

    private IQueryable<Conversation> ReadableConversationCandidates(Guid userId)
    {
        var visibleProjectIds = dbContext.VisibleProjectsFor(userId)
            .Select(project => project.Id);
        return dbContext.Conversations
            .AsNoTracking()
            .Where(conversation =>
                (conversation.Type == ConversationType.DirectMessage ||
                 conversation.Type == ConversationType.WorkspaceChannel ||
                 conversation.Type == ConversationType.ProjectChannel ||
                 conversation.Type == ConversationType.Thread) &&
                conversation.Members.Any(member =>
                    member.UserId == userId &&
                    member.LeftAt == null &&
                    member.RemovedAt == null &&
                    member.CanRead) &&
                (conversation.Type != ConversationType.ProjectChannel ||
                 conversation.ProjectId.HasValue) &&
                (conversation.Type != ConversationType.WorkspaceChannel ||
                 (!conversation.ProjectId.HasValue &&
                  dbContext.Workspaces.Any(workspace =>
                      workspace.Id == conversation.WorkspaceId &&
                      workspace.DeletedAt == null &&
                      (workspace.Status == WorkspaceStatus.Active || workspace.Status == WorkspaceStatus.Archived) &&
                      workspace.Members.Any(member =>
                          member.UserId == userId && member.Status == MembershipStatus.Active)))) &&
                (!conversation.ProjectId.HasValue ||
                 visibleProjectIds.Contains(conversation.ProjectId.Value)));
    }

    private sealed record ConversationAuthorizationNode(
        Guid Id,
        Guid WorkspaceId,
        Guid? ProjectId,
        ConversationType Type,
        Guid? ParentConversationId,
        Guid? RootConversationId);

    private sealed record ConversationAuthorizationScope(
        Guid WorkspaceId,
        Guid? ProjectId,
        Guid? RootConversationId);

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

    public Task<Conversation?> FindDirectAsync(Guid workspaceId, Guid? projectId, Guid userAId, Guid userBId, CancellationToken cancellationToken = default)
    {
        return dbContext.Conversations
            .Where(c =>
                c.WorkspaceId == workspaceId &&
                c.ProjectId == projectId &&
                c.Type == Domain.Enums.ConversationType.DirectMessage &&
                c.Members.Count == 2)
            .FirstOrDefaultAsync(c =>
                c.Members.Any(m => m.UserId == userAId && m.LeftAt == null && m.RemovedAt == null && m.CanRead) &&
                c.Members.Any(m => m.UserId == userBId && m.LeftAt == null && m.RemovedAt == null && m.CanRead),
                cancellationToken);
    }

    public Task<Conversation?> FindDirectForUsersAsync(Guid userAId, Guid userBId, CancellationToken cancellationToken = default)
    {
        return dbContext.Conversations
            .Where(c =>
                c.ProjectId == null &&
                c.Type == ConversationType.DirectMessage &&
                c.Members.Count == 2)
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
            .Where(m =>
                m.ConversationId == conversationId &&
                m.ThreadRootMessageId == null &&
                m.DeletedAt == null);
        if (before.HasValue) query = query.Where(m => m.CreatedAt < before.Value);
        var total = await query.CountAsync(cancellationToken);
        var items = await query.OrderByDescending(m => m.CreatedAt).Take(limit).ToListAsync(cancellationToken);
        return new PagedResponse<Message>(items, 1, limit, total);
    }

    public async Task<PagedResponse<Message>> ListThreadRepliesAsync(
        Guid conversationId,
        Guid threadRootMessageId,
        int limit,
        DateTimeOffset? before,
        CancellationToken cancellationToken = default)
    {
        limit = Math.Clamp(limit, 1, 100);
        var query = dbContext.Messages
            .AsNoTracking()
            .Include(message => message.AuthorUser)
            .Include(message => message.Attachments)
            .ThenInclude(link => link.Attachment)
            .Where(message =>
                message.ConversationId == conversationId &&
                message.ThreadRootMessageId == threadRootMessageId);
        if (before.HasValue)
        {
            query = query.Where(message => message.CreatedAt < before.Value);
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(message => message.CreatedAt)
            .ThenByDescending(message => message.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);
        return new PagedResponse<Message>(items, 1, limit, total);
    }

    public async Task<IReadOnlyDictionary<Guid, MessageThreadSummaryResponse>> GetThreadSummariesAsync(
        Guid conversationId,
        IReadOnlyCollection<Guid> threadRootMessageIds,
        int participantLimit,
        CancellationToken cancellationToken = default)
    {
        var rootIds = threadRootMessageIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .Take(100)
            .ToArray();
        if (rootIds.Length == 0)
        {
            return new Dictionary<Guid, MessageThreadSummaryResponse>();
        }

        participantLimit = Math.Clamp(participantLimit, 0, 5);
        var replyQuery = dbContext.Messages
            .AsNoTracking()
            .Where(message =>
                message.ConversationId == conversationId &&
                message.ThreadRootMessageId.HasValue &&
                rootIds.Contains(message.ThreadRootMessageId.Value));
        var aggregates = await replyQuery
            .GroupBy(message => message.ThreadRootMessageId!.Value)
            .Select(group => new
            {
                RootId = group.Key,
                ReplyCount = group.Count(),
                LatestReplyAt = group.Max(message => message.CreatedAt)
            })
            .ToListAsync(cancellationToken);

        IReadOnlyList<ThreadParticipantRow> participants = [];
        if (participantLimit > 0)
        {
            var tenantId = dbContext.ActiveTenantId;
            if (UsesPostgreSql() && tenantId.HasValue)
            {
                // Rank distinct names inside PostgreSQL and apply the per-root
                // bound before materialization. At most rootIds.Length *
                // participantLimit rows cross the provider boundary.
                participants = await dbContext.Database.SqlQuery<ThreadParticipantRow>($$"""
                    SELECT ranked."ThreadRootMessageId", ranked."DisplayName"
                    FROM (
                        SELECT distinct_names."ThreadRootMessageId",
                               distinct_names."DisplayName",
                               ROW_NUMBER() OVER (
                                   PARTITION BY distinct_names."ThreadRootMessageId"
                                   ORDER BY distinct_names."DisplayName") AS "ParticipantOrdinal"
                        FROM (
                            SELECT DISTINCT reply."ThreadRootMessageId", author."DisplayName"
                            FROM messages AS reply
                            INNER JOIN users AS author ON author."Id" = reply."AuthorUserId"
                            WHERE reply."TenantId" = {{tenantId.Value}}
                              AND reply."ConversationId" = {{conversationId}}
                              AND reply."ThreadRootMessageId" = ANY({{rootIds}})
                              AND BTRIM(author."DisplayName") <> ''
                        ) AS distinct_names
                    ) AS ranked
                    WHERE ranked."ParticipantOrdinal" <= {{participantLimit}}
                    ORDER BY ranked."ThreadRootMessageId", ranked."DisplayName"
                    """).ToListAsync(cancellationToken);
            }
            else
            {
                // Non-PostgreSQL test providers have no window-function path.
                // Keep their materialized result bounded with a provider Take
                // for each already-bounded root instead of loading every author.
                var boundedParticipants = new List<ThreadParticipantRow>(rootIds.Length * participantLimit);
                foreach (var rootId in rootIds)
                {
                    var displayNames = await replyQuery
                        .Where(message => message.ThreadRootMessageId == rootId && message.AuthorUser != null)
                        .Select(message => message.AuthorUser!.DisplayName)
                        .Where(displayName => displayName != string.Empty)
                        .Distinct()
                        .OrderBy(displayName => displayName)
                        .Take(participantLimit)
                        .ToListAsync(cancellationToken);
                    boundedParticipants.AddRange(displayNames.Select(displayName => new ThreadParticipantRow
                    {
                        ThreadRootMessageId = rootId,
                        DisplayName = displayName
                    }));
                }
                participants = boundedParticipants;
            }
        }
        var participantsByRoot = participants
            .GroupBy(item => item.ThreadRootMessageId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<string>)group
                    .Select(item => item.DisplayName)
                    .Where(displayName => !string.IsNullOrWhiteSpace(displayName))
                    .Take(participantLimit)
                    .ToList());

        return aggregates.ToDictionary(
            item => item.RootId,
            item => new MessageThreadSummaryResponse(
                item.RootId,
                item.ReplyCount,
                item.LatestReplyAt,
                participantsByRoot.GetValueOrDefault(item.RootId) ?? []));
    }

    public async Task<MessageThreadSummaryResponse> GetThreadSummaryAsync(
        Guid conversationId,
        Guid threadRootMessageId,
        int participantLimit,
        CancellationToken cancellationToken = default)
    {
        participantLimit = Math.Clamp(participantLimit, 0, 5);
        var query = dbContext.Messages
            .AsNoTracking()
            .Where(message =>
                message.ConversationId == conversationId &&
                message.ThreadRootMessageId == threadRootMessageId);
        var replyCount = await query.CountAsync(cancellationToken);
        var latestReplyAt = await query
            .OrderByDescending(message => message.CreatedAt)
            .Select(message => (DateTimeOffset?)message.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        var participantDisplayNames = await query
            .Where(message => message.AuthorUser != null)
            .Select(message => message.AuthorUser!.DisplayName)
            .Where(displayName => displayName != string.Empty)
            .Distinct()
            .OrderBy(displayName => displayName)
            .Take(participantLimit)
            .ToListAsync(cancellationToken);
        return new MessageThreadSummaryResponse(
            threadRootMessageId,
            replyCount,
            latestReplyAt,
            participantDisplayNames);
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

    private sealed class ThreadParticipantRow
    {
        public Guid ThreadRootMessageId { get; set; }
        public string DisplayName { get; set; } = string.Empty;
    }
}
