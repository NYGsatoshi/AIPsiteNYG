using AipPortal.Application.Common.Tenancy;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace AipPortal.Tests.PostgreSql;

[Collection("PostgreSqlTaskV1")]
[Trait("Scope", "Issue362")]
public sealed class MessageThreadContextPostgreSqlTests
{
    private const string PreviousMigration = "20260825081645_AddTaskExecutionScopeFoundation";

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task MigrationIsAdditiveIndexedConstrainedAndLeavesLegacyMessagesUnlinked()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database, PreviousMigration);
            var graph = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(database, $"message-thread-{Guid.NewGuid():N}");
            var conversationId = Guid.NewGuid();
            var legacyMessageId = Guid.NewGuid();
            var now = new DateTimeOffset(2026, 8, 28, 0, 0, 0, TimeSpan.Zero);
            await PostgreSqlMigrationTestDatabase.ExecuteAsync(database, """
INSERT INTO conversations ("Id", "TenantId", "WorkspaceId", "Type", "Title", "IsArchived", "IsLocked", "CreatedByUserId", "CreatedAt")
VALUES (@conversationId, @tenantId, @workspaceId, 'DirectMessage', 'Legacy conversation', false, false, @userId, @now);
INSERT INTO messages ("Id", "TenantId", "WorkspaceId", "ConversationId", "AuthorUserId", "Body", "Version", "CreatedAt")
VALUES (@messageId, @tenantId, @workspaceId, @conversationId, @userId, 'legacy root', 1, @now);
""",
                ("conversationId", conversationId), ("messageId", legacyMessageId),
                ("tenantId", graph.TenantId), ("workspaceId", graph.WorkspaceId),
                ("userId", graph.UserId), ("now", now));

            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);

            Assert.Equal(
                "uuid:YES",
                await PostgreSqlMigrationTestDatabase.ScalarAsync<string>(database, """
SELECT data_type || ':' || is_nullable
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'messages' AND column_name = 'ThreadRootMessageId';
"""));
            Assert.Equal(
                1,
                await PostgreSqlMigrationTestDatabase.ScalarAsync<long>(database, """
SELECT COUNT(*) FROM messages WHERE "Id" = @messageId AND "ThreadRootMessageId" IS NULL;
""", ("messageId", legacyMessageId)));

            var indexDefinition = await PostgreSqlMigrationTestDatabase.ScalarAsync<string>(database, """
SELECT indexdef FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'messages' AND indexname = 'IX_messages_thread_replies';
""");
            Assert.Contains(
                "(\"TenantId\", \"ConversationId\", \"ThreadRootMessageId\", \"CreatedAt\", \"Id\")",
                indexDefinition,
                StringComparison.Ordinal);

            var checkDefinition = await PostgreSqlMigrationTestDatabase.ScalarAsync<string>(database, """
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'CK_messages_thread_root_not_self';
""");
            Assert.Contains("ThreadRootMessageId", checkDefinition, StringComparison.Ordinal);
            Assert.Contains("Id", checkDefinition, StringComparison.Ordinal);

            var foreignKeyDefinition = await PostgreSqlMigrationTestDatabase.ScalarAsync<string>(database, """
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'FK_messages_messages_ThreadRootMessageId';
""");
            Assert.Contains("FOREIGN KEY (\"ThreadRootMessageId\") REFERENCES messages(\"Id\")", foreignKeyDefinition, StringComparison.Ordinal);
            Assert.Contains("ON DELETE RESTRICT", foreignKeyDefinition, StringComparison.Ordinal);

            var selfReference = await Assert.ThrowsAsync<PostgresException>(() =>
                PostgreSqlMigrationTestDatabase.ExecuteAsync(database, """
INSERT INTO messages ("Id", "TenantId", "WorkspaceId", "ConversationId", "AuthorUserId", "Body", "Version", "CreatedAt", "ThreadRootMessageId")
VALUES (@id, @tenantId, @workspaceId, @conversationId, @userId, 'invalid self reply', 1, @now, @id);
""", ("id", Guid.NewGuid()), ("tenantId", graph.TenantId), ("workspaceId", graph.WorkspaceId),
                    ("conversationId", conversationId), ("userId", graph.UserId), ("now", now)));
            Assert.Equal(PostgresErrorCodes.CheckViolation, selfReference.SqlState);

            var missingRoot = await Assert.ThrowsAsync<PostgresException>(() =>
                PostgreSqlMigrationTestDatabase.ExecuteAsync(database, """
INSERT INTO messages ("Id", "TenantId", "WorkspaceId", "ConversationId", "AuthorUserId", "Body", "Version", "CreatedAt", "ThreadRootMessageId")
VALUES (@id, @tenantId, @workspaceId, @conversationId, @userId, 'missing root reply', 1, @now, @missingRootId);
""", ("id", Guid.NewGuid()), ("tenantId", graph.TenantId), ("workspaceId", graph.WorkspaceId),
                    ("conversationId", conversationId), ("userId", graph.UserId), ("now", now),
                    ("missingRootId", Guid.NewGuid())));
            Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, missingRoot.SqlState);

            await PostgreSqlMigrationTestDatabase.MigrateAsync(database, PreviousMigration);
            Assert.Equal(
                0,
                await PostgreSqlMigrationTestDatabase.ScalarAsync<long>(database, """
SELECT COUNT(*) FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'messages' AND column_name = 'ThreadRootMessageId';
"""));
            Assert.Equal(
                1,
                await PostgreSqlMigrationTestDatabase.ScalarAsync<long>(database, "SELECT COUNT(*) FROM messages WHERE \"Id\" = @id;", ("id", legacyMessageId)));

            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            Assert.Equal(
                1,
                await PostgreSqlMigrationTestDatabase.ScalarAsync<long>(database, """
SELECT COUNT(*) FROM messages WHERE "Id" = @messageId AND "ThreadRootMessageId" IS NULL;
""", ("messageId", legacyMessageId)));
        });
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task RepositoryScopesRepliesByTenantConversationAndRootAndKeepsTombstones()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();
        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var graphA = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(database, $"message-thread-a-{Guid.NewGuid():N}");
            var graphB = await TaskV1MigrationRawSqlSeed.CreateGraphAsync(database, $"message-thread-b-{Guid.NewGuid():N}");
            var conversationA = Guid.NewGuid();
            var conversationOther = Guid.NewGuid();
            var conversationB = Guid.NewGuid();
            var rootId = Guid.NewGuid();
            var canonicalReplyId = Guid.NewGuid();
            var now = new DateTimeOffset(2026, 8, 28, 1, 0, 0, TimeSpan.Zero);
            await PostgreSqlMigrationTestDatabase.ExecuteAsync(database, """
INSERT INTO conversations ("Id", "TenantId", "WorkspaceId", "Type", "Title", "IsArchived", "IsLocked", "CreatedByUserId", "CreatedAt") VALUES
(@conversationA, @tenantA, @workspaceA, 'DirectMessage', 'A', false, false, @userA, @now),
(@conversationOther, @tenantA, @workspaceA, 'DirectMessage', 'A other', false, false, @userA, @now),
(@conversationB, @tenantB, @workspaceB, 'DirectMessage', 'B', false, false, @userB, @now);
INSERT INTO messages ("Id", "TenantId", "WorkspaceId", "ConversationId", "AuthorUserId", "Body", "Version", "CreatedAt")
VALUES (@rootId, @tenantA, @workspaceA, @conversationA, @userA, 'authorized root', 1, @now);
INSERT INTO messages ("Id", "TenantId", "WorkspaceId", "ConversationId", "AuthorUserId", "Body", "Version", "CreatedAt", "ThreadRootMessageId", "DeletedAt", "DeletedByUserId", "DeleteReason") VALUES
(@canonicalReplyId, @tenantA, @workspaceA, @conversationA, @userA, '', 1, @replyAt, @rootId, @deletedAt, @userA, 'author_delete'),
(@crossConversationReplyId, @tenantA, @workspaceA, @conversationOther, @userA, 'cross conversation secret', 1, @replyAt, @rootId, NULL, NULL, NULL),
(@crossTenantReplyId, @tenantB, @workspaceB, @conversationB, @userB, 'cross tenant secret', 1, @replyAt, @rootId, NULL, NULL, NULL);
""",
                ("conversationA", conversationA), ("conversationOther", conversationOther), ("conversationB", conversationB),
                ("tenantA", graphA.TenantId), ("workspaceA", graphA.WorkspaceId), ("userA", graphA.UserId),
                ("tenantB", graphB.TenantId), ("workspaceB", graphB.WorkspaceId), ("userB", graphB.UserId),
                ("rootId", rootId), ("canonicalReplyId", canonicalReplyId),
                ("crossConversationReplyId", Guid.NewGuid()), ("crossTenantReplyId", Guid.NewGuid()),
                ("now", now), ("replyAt", now.AddMinutes(1)), ("deletedAt", now.AddMinutes(2)));

            var currentTenant = new CurrentTenantService();
            currentTenant.SetTenant(graphA.TenantId, $"message-thread-a-{Guid.NewGuid():N}");
            await using var context = new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(database).Options,
                currentTenant);
            Assert.Empty(await context.Database.GetPendingMigrationsAsync());
            var repository = new MessagingRepository(context);

            var replies = await repository.ListThreadRepliesAsync(conversationA, rootId, 100, before: null);
            var summary = await repository.GetThreadSummaryAsync(conversationA, rootId, participantLimit: 3);
            var timeline = await repository.ListMessagesAsync(conversationA, 100, before: null);

            var reply = Assert.Single(replies.Items);
            Assert.Equal(canonicalReplyId, reply.Id);
            Assert.NotNull(reply.DeletedAt);
            Assert.Equal(1, replies.TotalCount);
            Assert.Equal(1, summary.ReplyCount);
            Assert.Equal(now.AddMinutes(1), summary.LatestReplyAt);
            Assert.Equal(new[] { "Migration user" }, summary.ParticipantDisplayNames);
            Assert.Equal(rootId, Assert.Single(timeline.Items).Id);
            Assert.Equal(1, timeline.TotalCount);
        });
    }
}
