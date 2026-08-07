using System.Text.Json;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Notifications;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.PostgreSql;

[Collection("PostgreSqlTaskV1")]
[Trait("Category", "PostgreSQLIntegration")]
[Trait("Scope", "TaskV1PR07D")]
public sealed class TaskV1Pr07DAuthorizedDeliveryPostgreSqlTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 6, 12, 0, 0, TimeSpan.Zero);

    [PostgreSqlFact]
    public async Task OpenTaskNotificationCommitsReadStateAndRecipientOnlyOutboxAtomically()
    {
        var connectionString = PostgreSqlTestEnvironment.RequireConnectionString();

        await PostgreSqlMigrationTestDatabase.WithTemporaryDatabaseAsync(connectionString, async database =>
        {
            await PostgreSqlMigrationTestDatabase.MigrateAsync(database);
            var suffix = Guid.NewGuid().ToString("N");
            var tenant = new Tenant
            {
                Name = $"PR07-D tenant {suffix}",
                DisplayName = "PR07-D tenant",
                Slug = $"pr07d-{suffix}",
                Status = TenantStatus.Active
            };
            var recipient = new User
            {
                DisplayName = "PR07-D recipient",
                Email = $"pr07d-{suffix}@example.invalid",
                NormalizedEmail = $"PR07D-{suffix}@EXAMPLE.INVALID",
                PasswordHash = "hash",
                Status = UserStatus.Active
            };

            await using (var platform = PostgreSqlMigrationTestDatabase.CreatePlatformContext(database))
            {
                platform.AddRange(tenant, recipient);
                await platform.SaveChangesAsync();
            }

            var workspace = new Workspace
            {
                TenantId = tenant.Id,
                Name = "Workspace",
                Slug = $"workspace-{suffix}",
                Status = WorkspaceStatus.Active,
                CreatedByUserId = recipient.Id
            };
            var project = new Project
            {
                TenantId = tenant.Id,
                WorkspaceId = workspace.Id,
                Name = "Project",
                Slug = $"project-{suffix}",
                Status = ProjectStatus.Active,
                OwnerUserId = recipient.Id,
                CreatedByUserId = recipient.Id
            };
            var task = new TaskItem
            {
                TenantId = tenant.Id,
                WorkspaceId = workspace.Id,
                ProjectId = project.Id,
                CreatedByUserId = recipient.Id,
                Title = "Restricted task",
                VersionNo = 4
            };
            var notification = new Notification
            {
                TenantId = tenant.Id,
                UserId = recipient.Id,
                NotificationType = NotificationType.TaskDueSoon,
                Title = "Task deadline changed",
                RelatedEntityType = "TaskItem",
                RelatedEntityId = task.Id,
                CreatedAt = Now,
                StateVersion = 4
            };

            await using (var seed = CreateTenantContext(database, tenant))
            {
                seed.AddRange(
                    new TenantUser { TenantId = tenant.Id, UserId = recipient.Id, Status = TenantUserStatus.Active, JoinedAt = Now },
                    workspace,
                    new WorkspaceMember { TenantId = tenant.Id, WorkspaceId = workspace.Id, UserId = recipient.Id, Status = MembershipStatus.Active, Role = WorkspaceRole.Member },
                    project,
                    task,
                    notification,
                    new NotificationUserState { TenantId = tenant.Id, UserId = recipient.Id, Version = 4, UpdatedAt = Now });
                await seed.SaveChangesAsync();
            }

            var currentTenant = TenantScope(tenant);
            await using (var openContext = CreateTenantContext(database, tenant))
            {
                var resolver = new CurrentAuthorizationTargetResolver(openContext, currentTenant);
                var outbox = new TransactionalOutbox(new OutboxEventRepository(openContext), currentTenant, new FixedClock());
                var service = new NotificationOpenService(openContext, currentTenant, new FixedClock(), outbox, resolver);

                var result = await service.OpenAsync(tenant.Id, recipient.Id, notification.Id);

                Assert.True(result.IsOwned);
                Assert.True(result.IsAvailable);
                Assert.Equal($"/projects/{project.Id}/tasks/{task.Id}", result.Route);
                Assert.Equal(5, result.StateVersion);
            }

            await using var verify = CreateTenantContext(database, tenant);
            var persisted = await verify.Notifications.SingleAsync();
            Assert.True(persisted.IsRead);
            Assert.Equal(5, persisted.StateVersion);
            Assert.Equal(5, (await verify.NotificationUserStates.SingleAsync()).Version);
            var signal = Assert.Single(await verify.OutboxEvents.Where(item => item.EventType == "Notifications.NotificationReadStateChanged.v1").ToListAsync());
            using var envelope = JsonDocument.Parse(signal.PayloadJson);
            var payload = envelope.RootElement.GetProperty("payload");
            Assert.Equal(
                ["change", "notificationId", "stateVersion", "unreadCount", "updatedAt"],
                payload.EnumerateObject().Select(property => property.Name).Order().ToArray());
            Assert.Equal(notification.Id, payload.GetProperty("notificationId").GetGuid());
            Assert.DoesNotContain("Restricted task", signal.PayloadJson, StringComparison.Ordinal);
            Assert.DoesNotContain("route", signal.PayloadJson, StringComparison.OrdinalIgnoreCase);
            var routes = JsonSerializer.Deserialize<List<RealtimeRoutingTarget>>(signal.RoutingJson, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            var route = Assert.Single(routes!);
            Assert.Equal(RealtimeSubscriptionType.User, route.SubscriptionType);
            Assert.Equal(recipient.Id, route.ResourceId);
        });
    }

    private static AppDbContext CreateTenantContext(string connectionString, Tenant tenant) =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString).Options, TenantScope(tenant));

    private static CurrentTenantService TenantScope(Tenant tenant)
    {
        var currentTenant = new CurrentTenantService();
        currentTenant.SetTenant(tenant.Id, tenant.Slug);
        return currentTenant;
    }

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => Now;
    }
}
