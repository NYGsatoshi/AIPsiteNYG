using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using AipPortal.Application;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Notifications;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Audit;
using AipPortal.Infrastructure.Files;
using AipPortal.Infrastructure.Persistence;
using AipPortal.Infrastructure.Security;
using AipPortal.Web.Controllers;
using AipPortal.Web.Extensions;
using AipPortal.Web.Middleware;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AipPortal.Tests.Tenancy;

public sealed class HttpTenantIsolationTests
{
    [Fact]
    public async Task AuthenticatedHttpRequestsStayTenantScopedAcrossCoreWorkflows()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, "/api/tenants/current", data.TenantA.Slug, data.TenantB.Slug);
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, "/api/workspaces", "WorkspaceA", "WorkspaceB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceA.Id}", "WorkspaceA", "WorkspaceB");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceB.Id}");

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceA.Id}/groups", "GroupA", "GroupB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/groups/{data.GroupA.Id}", "GroupA", "GroupB");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/groups/{data.GroupB.Id}");

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, "/api/projects?archived=false", "ProjectA", "ProjectB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/projects/{data.ProjectA.Id}", "ProjectA", "ProjectB");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/projects/{data.ProjectB.Id}");

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/projects/{data.ProjectA.Id}/tasks", "TaskA", "TaskB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id}", "TaskA", "TaskB");
        // Task commands use the canonical safe-not-found envelope so guessed cross-tenant IDs
        // do not reveal a resource outside the active tenant.
        await AssertStatusAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/tasks/{data.TaskB.Id}", HttpStatusCode.NotFound);

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, "/api/conversations", "ConversationA", "ConversationB");
        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}", "ConversationA", "ConversationB");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationB.Id}");

        await AssertOkContainsOnlyAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileA.Id}", data.FileA.OriginalFileName, data.FileB.OriginalFileName);
        await AssertStatusAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileA.Id}/download", HttpStatusCode.OK);
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileB.Id}");
        await AssertBadRequestAsync(app, data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileB.Id}/download");
    }

    [Fact]
    public async Task FileMetadataAndDeniedResponsesDoNotExposeStorageIdentifiers()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        var allowedMetadata = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileA.Id}");
        var allowedBody = await allowedMetadata.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, allowedMetadata.StatusCode);
        Assert.Contains(data.FileA.OriginalFileName, allowedBody, StringComparison.Ordinal);
        Assert.DoesNotContain("storageKey", allowedBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("storedFileName", allowedBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(data.FileA.StorageKey, allowedBody, StringComparison.Ordinal);

        var deniedMetadata = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileB.Id}");
        var deniedMetadataBody = await deniedMetadata.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedMetadata.StatusCode);
        Assert.DoesNotContain(data.FileB.OriginalFileName, deniedMetadataBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.FileB.StorageKey, deniedMetadataBody, StringComparison.Ordinal);

        var deniedDownload = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileB.Id}/download");
        var deniedDownloadBody = await deniedDownload.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedDownload.StatusCode);
        Assert.DoesNotContain(data.FileB.OriginalFileName, deniedDownloadBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.FileB.StorageKey, deniedDownloadBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FileDownloadResponsesUsePrivateCacheHeaders()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        var response = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/files/{data.FileA.Id}/download");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains(response.Headers.Pragma, value => string.Equals(value.Name, "no-cache", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task UploadSanitizesOriginalFileNameAndDoesNotReturnStorageIdentifiers()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var content = new MultipartFormDataContent
        {
            { new StringContent(AttachmentOwnerType.TaskItem.ToString()), "OwnerType" },
            { new StringContent(data.TaskB.Id.ToString("D")), "OwnerId" }
        };
        var file = new ByteArrayContent("hello"u8.ToArray());
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/plain");
        content.Add(file, "File", @"..\secret.txt");

        var response = await app.SendAsync(data.TenantBMember, data.TenantB.Slug, "/api/files", HttpMethod.Post, content);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("secret.txt", body, StringComparison.Ordinal);
        Assert.DoesNotContain("..", body, StringComparison.Ordinal);
        Assert.DoesNotContain("storageKey", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("storedFileName", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain($"tenants/{data.TenantB.Id:D}", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AuthenticatedHttpNotificationsStayUserAndTenantScoped()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        await AssertOkContainsOnlyAsync(app, data.TenantAMember, data.TenantA.Slug, "/api/notifications?page=1&pageSize=20", "TenantA notification", "TenantB notification");
        await AssertOkContainsOnlyAsync(app, data.TenantBMember, data.TenantB.Slug, "/api/notifications?page=1&pageSize=20", "TenantB notification", "TenantA notification");
        await AssertBadRequestAsync(app, data.TenantAMember, data.TenantA.Slug, $"/api/notifications/{data.NotificationB.Id}/read", HttpMethod.Patch);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07A")]
    public async Task TaskNotificationPreferencesUseCanonicalRoutesAndAcceptExactQuarterHours()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;
        var path = $"/api/me/workspaces/{data.WorkspaceA.Id:D}/task-notification-preferences";

        var routes = app.GetHttpRoutes();
        Assert.Contains("GET api/me/workspaces/{workspaceId:guid}/task-notification-preferences", routes);
        Assert.Contains("PATCH api/me/workspaces/{workspaceId:guid}/task-notification-preferences", routes);

        using (var initial = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path))
        using (var document = JsonDocument.Parse(await initial.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, initial.StatusCode);
            Assert.Equal("\"1\"", initial.Headers.ETag?.Tag);
            Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("deadlineDigestLocalTime").ValueKind);
            Assert.Equal("08:00", document.RootElement.GetProperty("effectiveDeadlineDigestLocalTime").GetString());
            Assert.Equal("UTC", document.RootElement.GetProperty("workspaceTimeZoneId").GetString());
            Assert.Equal(1L, document.RootElement.GetProperty("version").GetInt64());
        }

        var expectedVersion = 1L;
        foreach (var localTime in new[] { "00:00", "00:15", "23:45" })
        {
            using var content = JsonContent($$"""{"deadlineDigestLocalTime":"{{localTime}}","expectedVersion":{{expectedVersion}}}""");
            using var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, content);
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

            expectedVersion++;
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal($"\"{expectedVersion}\"", response.Headers.ETag?.Tag);
            Assert.Equal(localTime, document.RootElement.GetProperty("deadlineDigestLocalTime").GetString());
            Assert.Equal(localTime, document.RootElement.GetProperty("effectiveDeadlineDigestLocalTime").GetString());
            Assert.Equal(expectedVersion, document.RootElement.GetProperty("version").GetInt64());
        }

        using (var inherit = JsonContent($$"""{"deadlineDigestLocalTime":null,"expectedVersion":{{expectedVersion}}}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, inherit))
        using (var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("deadlineDigestLocalTime").ValueKind);
            Assert.Equal("08:00", document.RootElement.GetProperty("effectiveDeadlineDigestLocalTime").GetString());
            Assert.Equal(expectedVersion + 1, document.RootElement.GetProperty("version").GetInt64());
        }
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07A")]
    public async Task TaskNotificationPreferencesRejectInvalidTimesAndProvideSafeConcurrencyRetryMetadata()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;
        var path = $"/api/me/workspaces/{data.WorkspaceA.Id:D}/task-notification-preferences";

        foreach (var invalid in new[] { "00:01", "23:59", "24:00" })
        {
            using var content = JsonContent($$"""{"deadlineDigestLocalTime":"{{invalid}}","expectedVersion":1}""");
            using var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, content);
            await AssertTaskNotificationPreferenceErrorAsync(
                response,
                HttpStatusCode.BadRequest,
                "TASK_NOTIFICATION_PREFERENCE_INVALID_LOCAL_TIME");
        }

        using (var missingVersion = JsonContent("""{"deadlineDigestLocalTime":"00:00"}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, missingVersion))
        {
            await AssertTaskNotificationPreferenceErrorAsync(
                response,
                HttpStatusCode.Conflict,
                "TASK_NOTIFICATION_PREFERENCE_VERSION_CONFLICT",
                currentVersion: 1);
        }

        using (var winner = JsonContent("""{"deadlineDigestLocalTime":"00:15","expectedVersion":1}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, winner))
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("\"2\"", response.Headers.ETag?.Tag);
        }

        using (var stale = JsonContent("""{"deadlineDigestLocalTime":"23:45","expectedVersion":1}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, stale))
        {
            await AssertTaskNotificationPreferenceErrorAsync(
                response,
                HttpStatusCode.Conflict,
                "TASK_NOTIFICATION_PREFERENCE_VERSION_CONFLICT",
                currentVersion: 2);
        }

        using (var retry = JsonContent("""{"deadlineDigestLocalTime":"23:45","expectedVersion":2}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, retry))
        using (var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("23:45", document.RootElement.GetProperty("deadlineDigestLocalTime").GetString());
            Assert.Equal(3L, document.RootElement.GetProperty("version").GetInt64());
        }
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07A")]
    public async Task TaskNotificationPreferencesClassifyNumericVersionConflictsAndMalformedJsonSafelyWithoutMutation()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;
        var path = $"/api/me/workspaces/{data.WorkspaceA.Id:D}/task-notification-preferences";

        foreach (var requestJson in new[]
                 {
                     """{"deadlineDigestLocalTime":"00:00"}""",
                     """{"deadlineDigestLocalTime":"00:00","expectedVersion":0}""",
                     """{"deadlineDigestLocalTime":"00:00","expectedVersion":-1}"""
                 })
        {
            using var content = JsonContent(requestJson);
            using var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, content);
            await AssertTaskNotificationPreferenceErrorAsync(
                response,
                HttpStatusCode.Conflict,
                "TASK_NOTIFICATION_PREFERENCE_VERSION_CONFLICT",
                currentVersion: 1);
            await AssertTaskNotificationPreferenceStateAsync(app, data, path, null, 1);
        }

        using (var winner = JsonContent("""{"deadlineDigestLocalTime":"00:00","expectedVersion":1}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, winner))
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        using (var stale = JsonContent("""{"deadlineDigestLocalTime":"23:45","expectedVersion":1}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, stale))
        {
            await AssertTaskNotificationPreferenceErrorAsync(
                response,
                HttpStatusCode.Conflict,
                "TASK_NOTIFICATION_PREFERENCE_VERSION_CONFLICT",
                currentVersion: 2);
            await AssertTaskNotificationPreferenceStateAsync(app, data, path, "00:00", 2);
        }

        using (var incompatibleType = JsonContent("""{"deadlineDigestLocalTime":"23:45","expectedVersion":"abc"}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path, HttpMethod.Patch, incompatibleType))
        {
            await AssertSafeModelBindingErrorAsync(response, HttpStatusCode.BadRequest);
            await AssertTaskNotificationPreferenceStateAsync(app, data, path, "00:00", 2);
        }
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07A")]
    public async Task TaskNotificationPreferencesArePrivateTenantScopedAndFailClosedForRevokedMembership()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;
        var workspaceAPath = $"/api/me/workspaces/{data.WorkspaceA.Id:D}/task-notification-preferences";
        var workspaceBPath = $"/api/me/workspaces/{data.WorkspaceB.Id:D}/task-notification-preferences";

        using (var update = JsonContent("""{"deadlineDigestLocalTime":"23:45","expectedVersion":1}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, workspaceAPath, HttpMethod.Patch, update))
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        using (var anotherMember = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, workspaceAPath))
        using (var document = JsonDocument.Parse(await anotherMember.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, anotherMember.StatusCode);
            Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("deadlineDigestLocalTime").ValueKind);
            Assert.Equal(1L, document.RootElement.GetProperty("version").GetInt64());
        }

        using (var wrongWorkspace = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, workspaceBPath))
        {
            await AssertTaskNotificationPreferenceErrorAsync(
                wrongWorkspace,
                HttpStatusCode.NotFound,
                "TASK_NOTIFICATION_PREFERENCE_NOT_FOUND",
                redacted: true);
        }

        using (var wrongTenant = await app.SendAsync(data.TenantAMember, data.TenantB.Slug, workspaceBPath))
        {
            await AssertTaskNotificationPreferenceErrorAsync(
                wrongTenant,
                HttpStatusCode.NotFound,
                "TASK_NOTIFICATION_PREFERENCE_NOT_FOUND",
                redacted: true);
        }

        await app.SetWorkspaceAvailabilityAsync(
            data.TenantA.Id,
            data.TenantA.Slug,
            data.WorkspaceA.Id,
            WorkspaceStatus.Archived,
            softDeleted: true);
        using (var inactiveWorkspace = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, workspaceAPath))
        {
            await AssertTaskNotificationPreferenceErrorAsync(
                inactiveWorkspace,
                HttpStatusCode.NotFound,
                "TASK_NOTIFICATION_PREFERENCE_NOT_FOUND",
                redacted: true);
        }
        await app.SetWorkspaceAvailabilityAsync(
            data.TenantA.Id,
            data.TenantA.Slug,
            data.WorkspaceA.Id,
            WorkspaceStatus.Active,
            softDeleted: false);

        await app.SetWorkspaceMembershipStatusAsync(
            data.TenantA.Id,
            data.TenantA.Slug,
            data.WorkspaceA.Id,
            data.TenantAMember.Id,
            MembershipStatus.Suspended);

        using (var revokedGet = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, workspaceAPath))
        {
            await AssertTaskNotificationPreferenceErrorAsync(
                revokedGet,
                HttpStatusCode.NotFound,
                "TASK_NOTIFICATION_PREFERENCE_NOT_FOUND",
                redacted: true);
        }

        using (var revokedPatch = JsonContent("""{"deadlineDigestLocalTime":"00:00","expectedVersion":2}"""))
        using (var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, workspaceAPath, HttpMethod.Patch, revokedPatch))
        {
            await AssertTaskNotificationPreferenceErrorAsync(
                response,
                HttpStatusCode.NotFound,
                "TASK_NOTIFICATION_PREFERENCE_NOT_FOUND",
                redacted: true);
        }
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07A")]
    public async Task GeneralWorkspaceDtosDoNotDisclosePrivateTaskNotificationPreferences()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var members = await app.SendAsync(
            data.TenantAOwner,
            data.TenantA.Slug,
            $"/api/workspaces/{data.WorkspaceA.Id:D}/members");
        var membersBody = await members.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, members.StatusCode);
        Assert.DoesNotContain("taskDeadlineDigestLocalTime", membersBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("taskNotificationPreferenceVersion", membersBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(
            typeof(WorkspaceMemberResponse).GetProperties(),
            property => string.Equals(property.Name, "TaskDeadlineDigestLocalTime", StringComparison.Ordinal) ||
                        string.Equals(property.Name, "TaskNotificationPreferenceVersion", StringComparison.Ordinal));
    }

    [Fact]
    public async Task CommunicationBodiesStayParticipantScopedAndDeniedResponsesAreGeneric()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        var allowedMessages = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages");
        var allowedBody = await allowedMessages.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, allowedMessages.StatusCode);
        Assert.Contains(data.MessageA.Body, allowedBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.MessageB.Body, allowedBody, StringComparison.Ordinal);

        var deniedOutsider = await app.SendAsync(data.Outsider, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages");
        var deniedOutsiderBody = await deniedOutsider.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedOutsider.StatusCode);
        Assert.DoesNotContain(data.MessageA.Body, deniedOutsiderBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.TenantAMember.Email, deniedOutsiderBody, StringComparison.OrdinalIgnoreCase);

        var deniedCrossTenant = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationB.Id}/messages");
        var deniedCrossTenantBody = await deniedCrossTenant.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedCrossTenant.StatusCode);
        Assert.DoesNotContain(data.MessageB.Body, deniedCrossTenantBody, StringComparison.Ordinal);

        var auditLogs = await app.ListAuditLogsAsync(data.TenantA.Id, data.TenantA.Slug);
        var denialLogs = auditLogs.Where(log => log.Action == "ConversationAccessDenied").ToList();

        Assert.Contains(denialLogs, log => log.EntityId == data.ConversationA.Id);
        Assert.Contains(denialLogs, log => log.EntityId == data.ConversationB.Id);
        Assert.All(denialLogs, log =>
        {
            Assert.Equal("Conversation access denied.", log.Summary);
            Assert.DoesNotContain(data.MessageA.Body, log.MetadataJson ?? string.Empty, StringComparison.Ordinal);
            Assert.DoesNotContain(data.MessageB.Body, log.MetadataJson ?? string.Empty, StringComparison.Ordinal);
            Assert.DoesNotContain(data.TenantAMember.Email, log.MetadataJson ?? string.Empty, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(data.FileA.StorageKey, log.MetadataJson ?? string.Empty, StringComparison.Ordinal);
        });
    }

    [Fact]
    public async Task DmBodyAndMessageListStayParticipantOnlyEvenForElevatedTenantUsers()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        var deniedAdminMessages = await app.SendAsync(data.TenantAAdmin, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages");
        var deniedAdminMessagesBody = await deniedAdminMessages.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedAdminMessages.StatusCode);
        Assert.DoesNotContain(data.MessageA.Body, deniedAdminMessagesBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.TenantAMember.Email, deniedAdminMessagesBody, StringComparison.OrdinalIgnoreCase);

        var deniedAdminDetail = await app.SendAsync(data.TenantAAdmin, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}");
        var deniedAdminDetailBody = await deniedAdminDetail.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedAdminDetail.StatusCode);
        Assert.DoesNotContain(data.MessageA.Body, deniedAdminDetailBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.TenantAMember.Email, deniedAdminDetailBody, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ReadOnlyAndRemovedParticipantsCannotPostOrCreateThreads()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        await app.UpdateConversationMemberAsync(data.TenantA.Id, data.TenantA.Slug, data.ConversationA.Id, data.TenantAMember.Id, member =>
        {
            member.Role = ConversationMemberRole.ReadOnly;
            member.CanPost = false;
            member.CanCreateThread = false;
        });

        using var postContent = JsonContent("""{"body":"B-07 readonly post body","attachments":[]}""");
        var postResponse = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages", HttpMethod.Post, postContent);
        var postBody = await postResponse.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, postResponse.StatusCode);
        Assert.DoesNotContain("B-07 readonly post body", postBody, StringComparison.Ordinal);

        using var threadContent = JsonContent($$"""
            {"type":"Thread","workspaceId":"{{data.WorkspaceA.Id:D}}","parentConversationId":"{{data.ConversationA.Id:D}}","title":"B-07 readonly thread","memberUserIds":[]}
            """);
        var threadResponse = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, "/api/conversations", HttpMethod.Post, threadContent);
        var threadBody = await threadResponse.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, threadResponse.StatusCode);
        Assert.DoesNotContain("B-07 readonly thread", threadBody, StringComparison.Ordinal);

        await app.UpdateConversationMemberAsync(data.TenantA.Id, data.TenantA.Slug, data.ConversationA.Id, data.TenantAMember.Id, member =>
        {
            member.Role = ConversationMemberRole.Member;
            member.CanPost = true;
            member.CanCreateThread = true;
            member.LeftAt = DateTimeOffset.UtcNow;
            member.RemovedAt = DateTimeOffset.UtcNow;
            member.RemovedByUserId = data.CrossTenantUser.Id;
        });

        using var removedPostContent = JsonContent("""{"body":"B-07 removed post body","attachments":[]}""");
        var removedPostResponse = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages", HttpMethod.Post, removedPostContent);
        var removedPostBody = await removedPostResponse.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, removedPostResponse.StatusCode);
        Assert.DoesNotContain("B-07 removed post body", removedPostBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ThreadAccessRequiresParentConversationParticipantBoundary()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var threadContent = JsonContent($$"""
            {"type":"Thread","workspaceId":"{{data.WorkspaceA.Id:D}}","parentConversationId":"{{data.ConversationA.Id:D}}","title":"B-07 parent scoped thread","memberUserIds":[]}
            """);
        var threadResponse = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, "/api/conversations", HttpMethod.Post, threadContent);
        var threadBody = await threadResponse.Content.ReadAsStringAsync();
        var threadId = ReadResponseId(threadBody);

        Assert.Equal(HttpStatusCode.OK, threadResponse.StatusCode);

        using var threadMessageContent = JsonContent("""{"body":"B-07 thread private body","attachments":[]}""");
        var sendThreadMessage = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{threadId}/messages", HttpMethod.Post, threadMessageContent);
        Assert.Equal(HttpStatusCode.OK, sendThreadMessage.StatusCode);

        await app.UpdateConversationMemberAsync(data.TenantA.Id, data.TenantA.Slug, data.ConversationA.Id, data.CrossTenantUser.Id, member =>
        {
            member.LeftAt = DateTimeOffset.UtcNow;
            member.RemovedAt = DateTimeOffset.UtcNow;
            member.RemovedByUserId = data.TenantAMember.Id;
        });

        var deniedThreadRead = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{threadId}/messages");
        var deniedThreadReadBody = await deniedThreadRead.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedThreadRead.StatusCode);
        Assert.DoesNotContain("B-07 thread private body", deniedThreadReadBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.MessageA.Body, deniedThreadReadBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProjectChannelBodyStillRequiresConversationParticipantMembership()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var projectContent = JsonContent($$"""
            {"type":"ProjectChannel","workspaceId":"{{data.WorkspaceA.Id:D}}","projectId":"{{data.ProjectA.Id:D}}","title":"B-07 Project Channel","memberUserIds":[]}
            """);
        var projectResponse = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, "/api/conversations", HttpMethod.Post, projectContent);
        var projectBody = await projectResponse.Content.ReadAsStringAsync();
        var projectChannelId = ReadResponseId(projectBody);

        Assert.Equal(HttpStatusCode.OK, projectResponse.StatusCode);

        using var messageContent = JsonContent("""{"body":"B-07 project channel private body","attachments":[]}""");
        var sendResponse = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{projectChannelId}/messages", HttpMethod.Post, messageContent);
        Assert.Equal(HttpStatusCode.OK, sendResponse.StatusCode);

        var deniedProjectMember = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/conversations/{projectChannelId}/messages");
        var deniedProjectMemberBody = await deniedProjectMember.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedProjectMember.StatusCode);
        Assert.DoesNotContain("B-07 project channel private body", deniedProjectMemberBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ConversationCreateSupportsOnlyMvpTypesAndKeepsScopeFields()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var directContent = JsonContent($$"""
            {"type":"DirectMessage","workspaceId":"{{data.WorkspaceA.Id:D}}","title":"direct title must not be stored","memberUserIds":["{{data.TenantAMember.Id:D}}"]}
            """);
        var directResponse = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/conversations", HttpMethod.Post, directContent);
        var directBody = await directResponse.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, directResponse.StatusCode);
        Assert.Contains("DirectMessage", directBody, StringComparison.Ordinal);
        Assert.DoesNotContain("ProjectChannel", directBody, StringComparison.Ordinal);
        Assert.DoesNotContain("direct title must not be stored", directBody, StringComparison.Ordinal);

        using var projectContent = JsonContent($$"""
            {"type":"ProjectChannel","workspaceId":"{{data.WorkspaceA.Id:D}}","projectId":"{{data.ProjectA.Id:D}}","title":"Project Alpha","memberUserIds":[]}
            """);
        var projectResponse = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/conversations", HttpMethod.Post, projectContent);
        var projectBody = await projectResponse.Content.ReadAsStringAsync();
        var projectConversationId = ReadResponseId(projectBody);

        Assert.Equal(HttpStatusCode.OK, projectResponse.StatusCode);
        Assert.Contains("ProjectChannel", projectBody, StringComparison.Ordinal);
        Assert.Contains(data.ProjectA.Id.ToString("D"), projectBody, StringComparison.OrdinalIgnoreCase);

        var storedProjectChannel = await app.GetConversationAsync(data.TenantA.Id, data.TenantA.Slug, projectConversationId);
        Assert.NotNull(storedProjectChannel);
        Assert.Equal(ConversationType.ProjectChannel, storedProjectChannel.Type);
        Assert.Equal(data.WorkspaceA.Id, storedProjectChannel.WorkspaceId);
        Assert.Equal(data.ProjectA.Id, storedProjectChannel.ProjectId);
    }

    [Fact]
    public async Task DirectConversationMvpCanSearchCreateReuseSendAndPersistWithinTenant()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        var recipients = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/conversations/recipients?query=Staff");
        var recipientsBody = await recipients.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, recipients.StatusCode);
        Assert.Contains(data.TenantAStaff.DisplayName, recipientsBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.TenantAStaff.Email, recipientsBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(data.TenantBMember.DisplayName, recipientsBody, StringComparison.Ordinal);

        using var createContent = JsonContent($$"""{"recipientUserId":"{{data.TenantAStaff.Id:D}}"}""");
        var createResponse = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/conversations/direct", HttpMethod.Post, createContent);
        var createBody = await createResponse.Content.ReadAsStringAsync();
        var conversationId = ReadResponseId(createBody);

        Assert.Equal(HttpStatusCode.OK, createResponse.StatusCode);
        Assert.Contains(data.TenantAStaff.DisplayName, createBody, StringComparison.Ordinal);

        var storedConversation = await app.GetConversationAsync(data.TenantA.Id, data.TenantA.Slug, conversationId);
        Assert.NotNull(storedConversation);
        Assert.Equal(ConversationType.DirectMessage, storedConversation.Type);
        Assert.Equal(data.WorkspaceA.Id, storedConversation.WorkspaceId);
        Assert.Equal(
            new[] { data.TenantAOwner.Id, data.TenantAStaff.Id }.Order().ToArray(),
            storedConversation.Members.Select(member => member.UserId).Order().ToArray());

        using var duplicateContent = JsonContent($$"""{"recipientUserId":"{{data.TenantAStaff.Id:D}}"}""");
        var duplicateResponse = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/conversations/direct", HttpMethod.Post, duplicateContent);
        var duplicateBody = await duplicateResponse.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, duplicateResponse.StatusCode);
        Assert.Equal(conversationId, ReadResponseId(duplicateBody));

        using var messageContent = JsonContent("""{"body":"MVP direct message persisted","attachments":[]}""");
        var messageResponse = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, $"/api/conversations/{conversationId}/messages", HttpMethod.Post, messageContent);
        var messageBody = await messageResponse.Content.ReadAsStringAsync();
        var messageId = ReadResponseId(messageBody);

        Assert.Equal(HttpStatusCode.OK, messageResponse.StatusCode);
        Assert.Contains("MVP direct message persisted", messageBody, StringComparison.Ordinal);

        var storedMessage = await app.GetMessageAsync(data.TenantA.Id, data.TenantA.Slug, messageId);
        Assert.NotNull(storedMessage);
        Assert.Equal(conversationId, storedMessage.ConversationId);
        Assert.Equal(data.TenantAOwner.Id, storedMessage.AuthorUserId);
        Assert.Equal("MVP direct message persisted", storedMessage.Body);
    }

    [Fact]
    public async Task DirectConversationMvpRejectsSelfAndCrossTenantRecipients()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var selfContent = JsonContent($$"""{"recipientUserId":"{{data.TenantAOwner.Id:D}}"}""");
        var selfResponse = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/conversations/direct", HttpMethod.Post, selfContent);
        Assert.Equal(HttpStatusCode.BadRequest, selfResponse.StatusCode);

        using var crossTenantContent = JsonContent($$"""{"recipientUserId":"{{data.TenantBMember.Id:D}}"}""");
        var crossTenantResponse = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/conversations/direct", HttpMethod.Post, crossTenantContent);
        var crossTenantBody = await crossTenantResponse.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, crossTenantResponse.StatusCode);
        Assert.DoesNotContain(data.TenantBMember.DisplayName, crossTenantBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.TenantBMember.Email, crossTenantBody, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ConversationThreadCreationInheritsParentScopeAndMembers()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var content = JsonContent($$"""
            {"type":"Thread","workspaceId":"{{data.WorkspaceA.Id:D}}","parentConversationId":"{{data.ConversationA.Id:D}}","title":"Thread A","memberUserIds":[]}
            """);
        var response = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, "/api/conversations", HttpMethod.Post, content);
        var body = await response.Content.ReadAsStringAsync();
        var threadId = ReadResponseId(body);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("Thread", body, StringComparison.Ordinal);
        Assert.Contains(data.ConversationA.Id.ToString("D"), body, StringComparison.OrdinalIgnoreCase);

        var thread = await app.GetConversationAsync(data.TenantA.Id, data.TenantA.Slug, threadId);
        Assert.NotNull(thread);
        Assert.Equal(ConversationType.Thread, thread.Type);
        Assert.Equal(data.WorkspaceA.Id, thread.WorkspaceId);
        Assert.Null(thread.ProjectId);
        Assert.Equal(data.ConversationA.Id, thread.ParentConversationId);
        Assert.Equal(data.ConversationA.Id, thread.RootConversationId);
        Assert.Equal(
            new[] { data.CrossTenantUser.Id, data.TenantAMember.Id }.Order().ToArray(),
            thread.Members.Select(member => member.UserId).Order().ToArray());
    }

    [Fact]
    public async Task ConversationCreateRejectsDisabledTypesAndInvalidThreadBoundariesWithoutBodyLeak()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;
        var otherWorkspaceId = await app.AddWorkspaceAsync(data.TenantA.Id, data.TenantA.Slug, data.TenantAOwner.Id);

        foreach (var disabledType in new[] { "CommitteeChannel", "AnnouncementThread", "ExternalSharedChannel", "LegalHoldConversation" })
        {
            using var content = JsonContent($$"""
                {"type":"{{disabledType}}","workspaceId":"{{data.WorkspaceA.Id:D}}","projectId":"{{data.ProjectA.Id:D}}","title":"secret disabled title","memberUserIds":["{{data.TenantAMember.Id:D}}"]}
                """);
            var response = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/conversations", HttpMethod.Post, content);
            var body = await response.Content.ReadAsStringAsync();

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.DoesNotContain("secret disabled title", body, StringComparison.Ordinal);
        }

        await AssertConversationCreateRejectedWithoutLeakAsync(
            app,
            data,
            $$"""{"type":"Thread","workspaceId":"{{data.WorkspaceA.Id:D}}","title":"secret missing parent","memberUserIds":[]}""",
            "secret missing parent");
        await AssertConversationCreateRejectedWithoutLeakAsync(
            app,
            data,
            $$"""{"type":"Thread","workspaceId":"{{data.WorkspaceA.Id:D}}","parentConversationId":"{{Guid.NewGuid():D}}","title":"secret missing parent row","memberUserIds":[]}""",
            "secret missing parent row");
        await AssertConversationCreateRejectedWithoutLeakAsync(
            app,
            data,
            $$"""{"type":"Thread","workspaceId":"{{otherWorkspaceId:D}}","parentConversationId":"{{data.ConversationA.Id:D}}","title":"secret workspace mismatch","memberUserIds":[]}""",
            "secret workspace mismatch");
        await AssertConversationCreateRejectedWithoutLeakAsync(
            app,
            data,
            $$"""{"type":"Thread","workspaceId":"{{data.WorkspaceA.Id:D}}","projectId":"{{data.ProjectA.Id:D}}","parentConversationId":"{{data.ConversationA.Id:D}}","title":"secret project expansion","memberUserIds":[]}""",
            "secret project expansion");
        await AssertConversationCreateRejectedWithoutLeakAsync(
            app,
            data,
            $$"""{"type":"Thread","workspaceId":"{{data.WorkspaceA.Id:D}}","parentConversationId":"{{data.ConversationA.Id:D}}","title":"secret member expansion","memberUserIds":["{{data.Outsider.Id:D}}"]}""",
            "secret member expansion");
    }

    [Fact]
    public async Task RemovedConversationParticipantCannotReadEditOrDeleteExistingMessage()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        await AssertStatusAsync(app, data.TenantAMember, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/leave", HttpStatusCode.OK, HttpMethod.Post);

        var deniedRead = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages");
        var deniedReadBody = await deniedRead.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedRead.StatusCode);
        Assert.DoesNotContain(data.MessageA.Body, deniedReadBody, StringComparison.Ordinal);

        using var editContent = JsonContent("""{"body":"A-08 edited body should not be accepted"}""");
        var deniedEdit = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/messages/{data.MessageA.Id}", HttpMethod.Patch, editContent);
        var deniedEditBody = await deniedEdit.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedEdit.StatusCode);
        Assert.DoesNotContain(data.MessageA.Body, deniedEditBody, StringComparison.Ordinal);
        Assert.DoesNotContain("A-08 edited body should not be accepted", deniedEditBody, StringComparison.Ordinal);

        var deniedDelete = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/messages/{data.MessageA.Id}", HttpMethod.Delete);

        Assert.Equal(HttpStatusCode.BadRequest, deniedDelete.StatusCode);
    }

    [Fact]
    public async Task CommunicationSafetyBaselineEnforcesPostValidationSpamRateLimitAndClosedStates()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var activeContent = JsonContent("""{"body":"B-10 active participant post","attachments":[]}""");
        var activePost = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages", HttpMethod.Post, activeContent);
        Assert.Equal(HttpStatusCode.OK, activePost.StatusCode);

        using var emptyContent = JsonContent("""{"body":"   ","attachments":[]}""");
        var emptyPost = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages", HttpMethod.Post, emptyContent);
        Assert.Equal(HttpStatusCode.BadRequest, emptyPost.StatusCode);

        using var oversizedContent = JsonContent($$"""{"body":"{{new string('x', 121)}}","attachments":[]}""");
        var oversizedPost = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages", HttpMethod.Post, oversizedContent);
        Assert.Equal(HttpStatusCode.BadRequest, oversizedPost.StatusCode);

        await using var duplicateApp = await HttpTenantIsolationTestApp.CreateAsync();
        var duplicateData = duplicateApp.Data;
        using var duplicateOne = JsonContent("""{"body":"B-10 duplicate body","attachments":[]}""");
        var firstDuplicate = await duplicateApp.SendAsync(duplicateData.CrossTenantUser, duplicateData.TenantA.Slug, $"/api/conversations/{duplicateData.ConversationA.Id}/messages", HttpMethod.Post, duplicateOne);
        Assert.Equal(HttpStatusCode.OK, firstDuplicate.StatusCode);
        using var duplicateTwo = JsonContent("""{"body":"B-10 duplicate body","attachments":[]}""");
        var secondDuplicate = await duplicateApp.SendAsync(duplicateData.CrossTenantUser, duplicateData.TenantA.Slug, $"/api/conversations/{duplicateData.ConversationA.Id}/messages", HttpMethod.Post, duplicateTwo);
        var secondDuplicateBody = await secondDuplicate.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.BadRequest, secondDuplicate.StatusCode);
        Assert.DoesNotContain("B-10 duplicate body", secondDuplicateBody, StringComparison.Ordinal);

        await using var rateApp = await HttpTenantIsolationTestApp.CreateAsync();
        var rateData = rateApp.Data;
        for (var index = 0; index < 3; index++)
        {
            using var rateContent = JsonContent($$"""{"body":"B-10 rate {{index}}","attachments":[]}""");
            var response = await rateApp.SendAsync(rateData.CrossTenantUser, rateData.TenantA.Slug, $"/api/conversations/{rateData.ConversationA.Id}/messages", HttpMethod.Post, rateContent);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        using var limitedContent = JsonContent("""{"body":"B-10 rate limited body","attachments":[]}""");
        var limited = await rateApp.SendAsync(rateData.CrossTenantUser, rateData.TenantA.Slug, $"/api/conversations/{rateData.ConversationA.Id}/messages", HttpMethod.Post, limitedContent);
        var limitedBody = await limited.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.BadRequest, limited.StatusCode);
        Assert.DoesNotContain("B-10 rate limited body", limitedBody, StringComparison.Ordinal);

        await app.UpdateConversationAsync(data.TenantA.Id, data.TenantA.Slug, data.ConversationA.Id, conversation => conversation.IsLocked = true);
        using var lockedContent = JsonContent("""{"body":"B-10 locked body","attachments":[]}""");
        var lockedPost = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages", HttpMethod.Post, lockedContent);
        var lockedBody = await lockedPost.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.BadRequest, lockedPost.StatusCode);
        Assert.DoesNotContain("B-10 locked body", lockedBody, StringComparison.Ordinal);

        await app.UpdateConversationAsync(data.TenantA.Id, data.TenantA.Slug, data.ConversationA.Id, conversation =>
        {
            conversation.IsLocked = false;
            conversation.IsArchived = true;
        });
        using var archivedContent = JsonContent("""{"body":"B-10 archived body","attachments":[]}""");
        var archivedPost = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages", HttpMethod.Post, archivedContent);
        Assert.Equal(HttpStatusCode.BadRequest, archivedPost.StatusCode);

        await app.UpdateConversationAsync(data.TenantA.Id, data.TenantA.Slug, data.ConversationA.Id, conversation =>
        {
            conversation.IsArchived = false;
            conversation.Type = ConversationType.ExternalSharedChannel;
        });
        using var unsupportedContent = JsonContent("""{"body":"B-10 unsupported type body","attachments":[]}""");
        var unsupportedPost = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages", HttpMethod.Post, unsupportedContent);
        var unsupportedBody = await unsupportedPost.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.BadRequest, unsupportedPost.StatusCode);
        Assert.DoesNotContain("B-10 unsupported type body", unsupportedBody, StringComparison.Ordinal);

        var auditLogs = await app.ListAuditLogsAsync(data.TenantA.Id, data.TenantA.Slug);
        var auditJson = JsonSerializer.Serialize(auditLogs.Select(log => new { log.Action, log.Summary, log.MetadataJson }));
        Assert.Contains("communication.message_post_denied", auditJson, StringComparison.Ordinal);
        Assert.Contains("communication.rate_limited", JsonSerializer.Serialize(await rateApp.ListAuditLogsAsync(rateData.TenantA.Id, rateData.TenantA.Slug)), StringComparison.Ordinal);
        Assert.Contains("communication.spam_guard_triggered", JsonSerializer.Serialize(await duplicateApp.ListAuditLogsAsync(duplicateData.TenantA.Id, duplicateData.TenantA.Slug)), StringComparison.Ordinal);
        Assert.DoesNotContain("B-10 locked body", auditJson, StringComparison.Ordinal);
        Assert.DoesNotContain("B-10 unsupported type body", auditJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CommunicationEditDeleteReportAndLockStayParticipantBoundedAndMetadataOnly()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var editContent = JsonContent("""{"body":"B-10 edited body"}""");
        var edit = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/messages/{data.MessageA.Id}", HttpMethod.Patch, editContent);
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);

        using var deniedEditContent = JsonContent("""{"body":"B-10 non-author edit body"}""");
        var deniedEdit = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/messages/{data.MessageA.Id}", HttpMethod.Patch, deniedEditContent);
        var deniedEditBody = await deniedEdit.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.BadRequest, deniedEdit.StatusCode);
        Assert.DoesNotContain("B-10 edited body", deniedEditBody, StringComparison.Ordinal);
        Assert.DoesNotContain("B-10 non-author edit body", deniedEditBody, StringComparison.Ordinal);

        using var reportContent = JsonContent("""{"reasonCode":"abuse","reason":"raw report text token storage/path DM body"}""");
        var report = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/messages/{data.MessageA.Id}/report", HttpMethod.Post, reportContent);
        Assert.Equal(HttpStatusCode.OK, report.StatusCode);

        using var deniedReportContent = JsonContent("""{"reasonCode":"abuse","reason":"raw report text token storage/path DM body"}""");
        var deniedReport = await app.SendAsync(data.TenantAAdmin, data.TenantA.Slug, $"/api/messages/{data.MessageA.Id}/report", HttpMethod.Post, deniedReportContent);
        var deniedReportBody = await deniedReport.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.BadRequest, deniedReport.StatusCode);
        Assert.DoesNotContain(data.MessageA.Body, deniedReportBody, StringComparison.Ordinal);

        var deniedAdminLock = await app.SendAsync(data.TenantAAdmin, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/lock", HttpMethod.Post, JsonContent("""{"reasonCode":"admin-non-participant"}"""));
        var deniedAdminLockBody = await deniedAdminLock.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.BadRequest, deniedAdminLock.StatusCode);
        Assert.DoesNotContain(data.MessageA.Body, deniedAdminLockBody, StringComparison.Ordinal);

        await app.UpdateConversationMemberAsync(data.TenantA.Id, data.TenantA.Slug, data.ConversationA.Id, data.CrossTenantUser.Id, member =>
        {
            member.Role = ConversationMemberRole.Admin;
            member.CanManageMembers = true;
        });

        var lockResponse = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/lock", HttpMethod.Post, JsonContent("""{"reasonCode":"moderation_lock"}"""));
        Assert.Equal(HttpStatusCode.OK, lockResponse.StatusCode);

        using var lockedEditContent = JsonContent("""{"body":"B-10 locked edit body"}""");
        var lockedEdit = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/messages/{data.MessageA.Id}", HttpMethod.Patch, lockedEditContent);
        Assert.Equal(HttpStatusCode.BadRequest, lockedEdit.StatusCode);

        var unlockResponse = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/unlock", HttpMethod.Post, JsonContent("""{"reasonCode":"moderation_unlock"}"""));
        Assert.Equal(HttpStatusCode.OK, unlockResponse.StatusCode);

        var deleteResponse = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/messages/{data.MessageA.Id}", HttpMethod.Delete);
        Assert.Equal(HttpStatusCode.OK, deleteResponse.StatusCode);

        var deletedRead = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages");
        var deletedReadBody = await deletedRead.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, deletedRead.StatusCode);
        Assert.DoesNotContain("B-10 edited body", deletedReadBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.MessageA.Body, deletedReadBody, StringComparison.Ordinal);

        var storedMessage = await app.GetMessageAsync(data.TenantA.Id, data.TenantA.Slug, data.MessageA.Id);
        Assert.NotNull(storedMessage);
        Assert.NotNull(storedMessage.DeletedAt);
        Assert.Equal(data.CrossTenantUser.Id, storedMessage.DeletedByUserId);
        Assert.Equal(string.Empty, storedMessage.Body);

        var auditLogs = await app.ListAuditLogsAsync(data.TenantA.Id, data.TenantA.Slug);
        var auditJson = JsonSerializer.Serialize(auditLogs.Select(log => new { log.Action, log.Summary, log.MetadataJson }));
        Assert.Contains("communication.message_edited", auditJson, StringComparison.Ordinal);
        Assert.Contains("communication.message_edit_denied", auditJson, StringComparison.Ordinal);
        Assert.Contains("communication.message_reported", auditJson, StringComparison.Ordinal);
        Assert.Contains("communication.message_report_denied", auditJson, StringComparison.Ordinal);
        Assert.Contains("communication.conversation_locked", auditJson, StringComparison.Ordinal);
        Assert.Contains("communication.message_deleted", auditJson, StringComparison.Ordinal);
        Assert.DoesNotContain("B-10 edited body", auditJson, StringComparison.Ordinal);
        Assert.DoesNotContain("B-10 non-author edit body", auditJson, StringComparison.Ordinal);
        Assert.DoesNotContain("raw report text", auditJson, StringComparison.Ordinal);
        Assert.DoesNotContain(data.FileA.StorageKey, auditJson, StringComparison.Ordinal);
        Assert.DoesNotContain("StudentRecordRestricted", auditJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ConversationReadCursorMustReferenceMessageInSameConversation()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using var content = JsonContent($$"""{"lastReadMessageId":"{{data.MessageB.Id:D}}"}""");
        var response = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/read", HttpMethod.Post, content);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain(data.MessageB.Body, body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ParticipantStateIsOwnStateOnlyAndDoesNotExposeOtherParticipantMetadata()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        var ownState = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/state");
        var ownStateBody = await ownState.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, ownState.StatusCode);
        Assert.Contains($@"""userId"":""{data.CrossTenantUser.Id:D}""", ownStateBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(data.TenantAMember.Email, ownStateBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(data.MessageA.Body, ownStateBody, StringComparison.Ordinal);

        using var updateContent = JsonContent($$"""
            {"lastReadMessageId":"{{data.MessageA.Id:D}}","unreadCursorMessageId":"{{data.MessageA.Id:D}}","isMuted":true,"isArchived":true}
            """);
        var updateState = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/state", HttpMethod.Patch, updateContent);
        var updateStateBody = await updateState.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, updateState.StatusCode);
        Assert.Contains($@"""lastReadMessageId"":""{data.MessageA.Id:D}""", updateStateBody, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(@"""isMuted"":true", updateStateBody, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(@"""isArchived"":true", updateStateBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(data.TenantAMember.Email, updateStateBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(data.MessageA.Body, updateStateBody, StringComparison.Ordinal);

        var list = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, "/api/conversations");
        var listBody = await list.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.Contains(@"""isMuted"":true", listBody, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(@"""isArchived"":true", listBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(data.TenantAMember.Email, listBody, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ParticipantStateDeniesNonParticipantsRemovedParticipantsAndCrossConversationCursors()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        var deniedAdminState = await app.SendAsync(data.TenantAAdmin, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/state");
        var deniedAdminStateBody = await deniedAdminState.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedAdminState.StatusCode);
        Assert.DoesNotContain(data.MessageA.Body, deniedAdminStateBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.TenantAMember.Email, deniedAdminStateBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("isMuted", deniedAdminStateBody, StringComparison.OrdinalIgnoreCase);

        using var deniedAdminUpdateContent = JsonContent("""{"isMuted":true,"isArchived":true}""");
        var deniedAdminUpdate = await app.SendAsync(data.TenantAAdmin, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/state", HttpMethod.Patch, deniedAdminUpdateContent);
        var deniedAdminUpdateBody = await deniedAdminUpdate.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedAdminUpdate.StatusCode);
        Assert.DoesNotContain("isMuted", deniedAdminUpdateBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("isArchived", deniedAdminUpdateBody, StringComparison.OrdinalIgnoreCase);

        using var cursorMismatchContent = JsonContent($$"""{"unreadCursorMessageId":"{{data.MessageB.Id:D}}"}""");
        var cursorMismatch = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/state", HttpMethod.Patch, cursorMismatchContent);
        var cursorMismatchBody = await cursorMismatch.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, cursorMismatch.StatusCode);
        Assert.DoesNotContain(data.MessageB.Body, cursorMismatchBody, StringComparison.Ordinal);

        await app.UpdateConversationMemberAsync(data.TenantA.Id, data.TenantA.Slug, data.ConversationA.Id, data.CrossTenantUser.Id, member =>
        {
            member.LeftAt = DateTimeOffset.UtcNow;
            member.RemovedAt = DateTimeOffset.UtcNow;
            member.RemovedByUserId = data.TenantAMember.Id;
        });

        var deniedRemovedState = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/state");
        var deniedRemovedStateBody = await deniedRemovedState.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, deniedRemovedState.StatusCode);
        Assert.DoesNotContain(data.MessageA.Body, deniedRemovedStateBody, StringComparison.Ordinal);
        Assert.DoesNotContain("lastReadMessageId", deniedRemovedStateBody, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task MessageNotificationDoesNotEmbedPrivateMessageBody()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;
        const string privateMessageBody = "A-08 synthetic private notification body";

        using var sendContent = JsonContent($$"""{"body":"{{privateMessageBody}}","attachments":[]}""");
        var sendResponse = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}/messages", HttpMethod.Post, sendContent);

        Assert.Equal(HttpStatusCode.OK, sendResponse.StatusCode);

        var notifications = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, "/api/notifications?page=1&pageSize=20");
        var body = await notifications.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, notifications.StatusCode);
        Assert.Contains("New direct message", body, StringComparison.Ordinal);
        Assert.Contains("You have a new message.", body, StringComparison.Ordinal);
        Assert.DoesNotContain(privateMessageBody, body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TenantHeaderDoesNotGrantAccessWithoutResourceMembership()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        await AssertOkContainsOnlyAsync(app, data.Outsider, data.TenantA.Slug, "/api/workspaces", "", "WorkspaceA");
        await AssertBadRequestAsync(app, data.Outsider, data.TenantA.Slug, $"/api/workspaces/{data.WorkspaceA.Id}");
        await AssertBadRequestAsync(app, data.Outsider, data.TenantA.Slug, $"/api/projects/{data.ProjectA.Id}");
        await AssertBadRequestAsync(app, data.Outsider, data.TenantA.Slug, $"/api/conversations/{data.ConversationA.Id}");
        await AssertBadRequestAsync(app, data.Outsider, data.TenantA.Slug, $"/api/files/{data.FileA.Id}/download");
    }

    [Fact]
    public async Task MissingAuthenticationIsRejectedBeforeTenantDataIsReturned()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/workspaces");
        request.Headers.TryAddWithoutValidation("X-Tenant-Slug", app.Data.TenantA.Slug);
        var response = await app.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    [Trait("Scope", "TaskV1PR04")]
    public async Task MyTasksHttpContractUsesExplicitWorkspaceScopeSafeErrorsAndRevocation()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;

        using (var unauthenticated = new HttpRequestMessage(HttpMethod.Get, "/api/me/tasks?view=Created"))
        {
            unauthenticated.Headers.TryAddWithoutValidation("X-Tenant-Slug", data.TenantA.Slug);
            Assert.Equal(HttpStatusCode.Unauthorized, (await app.Client.SendAsync(unauthenticated)).StatusCode);
        }

        var sole = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/me/tasks?view=Created");
        Assert.Equal(HttpStatusCode.OK, sole.StatusCode);
        using (var document = JsonDocument.Parse(await sole.Content.ReadAsStringAsync()))
        {
            Assert.Equal(1, document.RootElement.GetProperty("totalCount").GetInt32());
            Assert.Equal(data.WorkspaceA.Id, document.RootElement.GetProperty("workspaceId").GetGuid());
            Assert.Equal("Created", document.RootElement.GetProperty("view").GetString());
            Assert.Equal("CurrentWorkspace", document.RootElement.GetProperty("scope").GetString());
            var item = Assert.Single(document.RootElement.GetProperty("items").EnumerateArray());
            Assert.Equal(data.TaskA.Id, item.GetProperty("taskId").GetGuid());
            Assert.Equal(JsonValueKind.String, item.GetProperty("kind").ValueKind);
            Assert.Equal(JsonValueKind.String, item.GetProperty("stageCategory").ValueKind);
            Assert.Equal(JsonValueKind.String, item.GetProperty("priority").ValueKind);
        }

        var soleCounts = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/me/tasks/counts?view=Created");
        Assert.Equal(HttpStatusCode.OK, soleCounts.StatusCode);
        using (var document = JsonDocument.Parse(await soleCounts.Content.ReadAsStringAsync()))
        {
            Assert.Equal(data.WorkspaceA.Id, document.RootElement.GetProperty("workspaceId").GetGuid());
            Assert.Equal(
                1,
                document.RootElement.GetProperty("views").EnumerateArray()
                    .Single(item => item.GetProperty("view").GetString() == "Created")
                    .GetProperty("count").GetInt32());
        }

        await AssertSafeModelBindingErrorAsync(
            await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/me/tasks?view=999"),
            HttpStatusCode.BadRequest);
        await AssertMyTasksErrorAsync(
            await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/me/tasks?view=Created&projectId={data.ProjectB.Id:D}"),
            HttpStatusCode.NotFound,
            "MY_TASKS_PROJECT_NOT_FOUND");
        await AssertMyTasksErrorAsync(
            await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/me/tasks?view=Created&workspaceId={data.WorkspaceB.Id:D}"),
            HttpStatusCode.Forbidden,
            "MY_TASKS_WORKSPACE_FORBIDDEN");

        var projectScopedPath = $"/api/me/tasks?view=Assigned&workspaceId={data.WorkspaceA.Id:D}&projectId={data.ProjectA.Id:D}";
        foreach (var visibleUser in new[] { data.TenantAOwner, data.TenantAAdmin, data.TenantAStaff, data.TenantAMember })
        {
            Assert.Equal(
                HttpStatusCode.OK,
                (await app.SendAsync(visibleUser, data.TenantA.Slug, projectScopedPath)).StatusCode);
        }

        await app.AddGroupMemberAsync(
            data.TenantA.Id,
            data.TenantA.Slug,
            data.GroupA.Id,
            data.TenantAGuest.Id);
        Assert.Equal(
            HttpStatusCode.OK,
            (await app.SendAsync(data.TenantAGuest, data.TenantA.Slug, projectScopedPath)).StatusCode);

        await app.AddWorkspaceAsync(data.TenantA.Id, data.TenantA.Slug, data.TenantAOwner.Id);
        await AssertMyTasksErrorAsync(
            await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, "/api/me/tasks?view=Created"),
            HttpStatusCode.BadRequest,
            "MY_TASKS_INVALID_WORKSPACE_SCOPE");

        var explicitWorkspace = await app.SendAsync(
            data.TenantAOwner,
            data.TenantA.Slug,
            $"/api/me/tasks?view=Created&workspaceId={data.WorkspaceA.Id:D}");
        Assert.Equal(HttpStatusCode.OK, explicitWorkspace.StatusCode);

        var allWorkspaces = await app.SendAsync(
            data.TenantAOwner,
            data.TenantA.Slug,
            "/api/me/tasks?view=Created&scope=AllWorkspaces");
        Assert.Equal(HttpStatusCode.OK, allWorkspaces.StatusCode);
        using (var document = JsonDocument.Parse(await allWorkspaces.Content.ReadAsStringAsync()))
        {
            Assert.Equal(1, document.RootElement.GetProperty("totalCount").GetInt32());
            Assert.Equal(2, document.RootElement.GetProperty("availableWorkspaceCount").GetInt32());
        }

        await app.SetWorkspaceMembershipStatusAsync(
            data.TenantA.Id,
            data.TenantA.Slug,
            data.WorkspaceA.Id,
            data.TenantAOwner.Id,
            MembershipStatus.Suspended);

        var afterRevocation = await app.SendAsync(
            data.TenantAOwner,
            data.TenantA.Slug,
            "/api/me/tasks?view=Created&scope=AllWorkspaces");
        Assert.Equal(HttpStatusCode.OK, afterRevocation.StatusCode);
        using (var document = JsonDocument.Parse(await afterRevocation.Content.ReadAsStringAsync()))
        {
            Assert.Equal(0, document.RootElement.GetProperty("totalCount").GetInt32());
            Assert.Empty(document.RootElement.GetProperty("items").EnumerateArray());
        }

        var countsAfterRevocation = await app.SendAsync(
            data.TenantAOwner,
            data.TenantA.Slug,
            "/api/me/tasks/counts?view=Created&scope=AllWorkspaces");
        Assert.Equal(HttpStatusCode.OK, countsAfterRevocation.StatusCode);
        using (var document = JsonDocument.Parse(await countsAfterRevocation.Content.ReadAsStringAsync()))
        {
            Assert.Equal(
                0,
                document.RootElement.GetProperty("views").EnumerateArray()
                    .Single(item => item.GetProperty("view").GetString() == "Created")
                    .GetProperty("count").GetInt32());
        }

        await AssertMyTasksErrorAsync(
            await app.SendAsync(
                data.TenantAOwner,
                data.TenantA.Slug,
                $"/api/me/tasks?view=Created&workspaceId={data.WorkspaceA.Id:D}"),
            HttpStatusCode.Forbidden,
            "MY_TASKS_WORKSPACE_FORBIDDEN");
    }

    [Fact]
    [Trait("Scope", "TaskV1PR07B")]
    public async Task TaskDeadlinePatchIsServerAuthoritativeAndSeparateFromPlannedSchedule()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;
        var taskPath = $"/api/tasks/{data.TaskA.Id:D}";

        using var initialResponse = await app.SendAsync(
            data.TenantAOwner,
            data.TenantA.Slug,
            taskPath);
        using var initialDocument = JsonDocument.Parse(
            await initialResponse.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, initialResponse.StatusCode);
        var version = initialDocument.RootElement
            .GetProperty("task")
            .GetProperty("version")
            .GetInt64();

        using (var reviewer = JsonContent(
                   $$"""{"userId":"{{data.TenantAMember.Id:D}}","expectedVersion":{{version}}}"""))
        using (var reviewerResponse = await app.SendAsync(
                   data.TenantAOwner,
                   data.TenantA.Slug,
                   $"{taskPath}/reviewer",
                   HttpMethod.Put,
                   reviewer))
        using (var reviewerDocument = JsonDocument.Parse(
                   await reviewerResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, reviewerResponse.StatusCode);
            version = reviewerDocument.RootElement
                .GetProperty("task")
                .GetProperty("version")
                .GetInt64();
        }

        const string deadlineText = "2026-08-03T00:15:00+09:00";
        var expectedDeadline = new DateTimeOffset(
            2026,
            8,
            3,
            0,
            15,
            0,
            TimeSpan.FromHours(9));
        using (var validDeadline = JsonContent(
                   $$"""{"title":"TaskA","description":null,"priority":1,"plannedStartDate":null,"plannedEndDate":null,"progressPercent":0,"expectedVersion":{{version}},"deadlineAt":"{{deadlineText}}"}"""))
        using (var validResponse = await app.SendAsync(
                   data.TenantAOwner,
                   data.TenantA.Slug,
                   taskPath,
                   HttpMethod.Patch,
                   validDeadline))
        using (var validDocument = JsonDocument.Parse(
                   await validResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, validResponse.StatusCode);
            var responseDeadline = validDocument.RootElement
                .GetProperty("deadlineAt")
                .GetDateTimeOffset();
            Assert.Equal(expectedDeadline.ToUniversalTime(), responseDeadline);
            Assert.Equal(TimeSpan.Zero, responseDeadline.Offset);
            version = validDocument.RootElement.GetProperty("version").GetInt64();
        }

        var afterValidDeadline = await app.GetTaskMutationStateAsync(
            data.TenantA.Id,
            data.TenantA.Slug,
            data.TaskA.Id);
        Assert.Equal(expectedDeadline.ToUniversalTime(), afterValidDeadline.DeadlineAt);
        Assert.Equal(TimeSpan.Zero, afterValidDeadline.DeadlineAt!.Value.Offset);
        Assert.Equal(version, afterValidDeadline.Version);
        // tasks.notificationsV1 remains disabled in this application's seeded tenant.
        Assert.Equal(0, afterValidDeadline.TaskNotificationCount);

        foreach (var clientHint in new[]
                 {
                     "\"isMajorDeadlineChange\":true",
                     "\"deadlineChangeClassification\":\"None\"",
                     "\"suppressDeadlineNotification\":true"
                 })
        {
            using var untrustedHint = JsonContent(
                $$"""{"title":"TaskA","description":null,"priority":1,"plannedStartDate":null,"plannedEndDate":null,"progressPercent":0,"expectedVersion":{{version}},"deadlineAt":"2026-08-05T00:15:00+09:00",{{clientHint}}}""");
            using var response = await app.SendAsync(
                data.TenantAOwner,
                data.TenantA.Slug,
                taskPath,
                HttpMethod.Patch,
                untrustedHint);

            await AssertSafeRejectedJsonContractAsync(response, HttpStatusCode.BadRequest);
            Assert.Equal(
                afterValidDeadline,
                await app.GetTaskMutationStateAsync(
                    data.TenantA.Id,
                    data.TenantA.Slug,
                    data.TaskA.Id));
        }

        var plannedEnd = new DateOnly(2026, 8, 6);
        using (var plannedEndOnly = JsonContent(
                   $$"""{"plannedStartDate":null,"plannedEndDate":"{{plannedEnd:yyyy-MM-dd}}","milestoneDate":null,"expectedVersion":{{version}}}"""))
        using (var scheduleResponse = await app.SendAsync(
                   data.TenantAOwner,
                   data.TenantA.Slug,
                   $"{taskPath}/schedule",
                   HttpMethod.Patch,
                   plannedEndOnly))
        using (var scheduleDocument = JsonDocument.Parse(
                   await scheduleResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, scheduleResponse.StatusCode);
            Assert.Equal(
                plannedEnd,
                DateOnly.FromDateTime(
                    scheduleDocument.RootElement.GetProperty("plannedEndDate").GetDateTime()));
            Assert.False(scheduleDocument.RootElement.TryGetProperty("deadlineAt", out _));
            version = scheduleDocument.RootElement.GetProperty("version").GetInt64();
        }

        var afterPlannedEnd = await app.GetTaskMutationStateAsync(
            data.TenantA.Id,
            data.TenantA.Slug,
            data.TaskA.Id);
        Assert.Equal(expectedDeadline, afterPlannedEnd.DeadlineAt);
        Assert.Equal(plannedEnd, afterPlannedEnd.PlannedEndDate);
        Assert.Equal(version, afterPlannedEnd.Version);
        Assert.Equal(
            afterValidDeadline.TaskNotificationCount,
            afterPlannedEnd.TaskNotificationCount);

        using var deadlineOnSchedule = JsonContent(
            $$"""{"plannedStartDate":null,"plannedEndDate":"2026-08-07","milestoneDate":null,"expectedVersion":{{version}},"deadlineAt":"2026-08-07T00:15:00+09:00"}""");
        using var rejectedSchedule = await app.SendAsync(
            data.TenantAOwner,
            data.TenantA.Slug,
            $"{taskPath}/schedule",
            HttpMethod.Patch,
            deadlineOnSchedule);
        await AssertSafeRejectedJsonContractAsync(
            rejectedSchedule,
            HttpStatusCode.BadRequest);
        Assert.Equal(
            afterPlannedEnd,
            await app.GetTaskMutationStateAsync(
                data.TenantA.Id,
                data.TenantA.Slug,
                data.TaskA.Id));
    }

    [Fact]
    [Trait("Scope", "TaskV1PR03C")]
    public async Task TaskDetailHttpContractUsesCanonicalRoutesSafeErrorsAndBoundedAggregate()
    {
        await using var app = await HttpTenantIsolationTestApp.CreateAsync();
        var data = app.Data;
        var expectedRoutes = new[]
        {
            "GET api/tasks/{taskItemId:guid}", "PATCH api/tasks/{taskItemId:guid}",
            "GET api/tasks/{taskItemId:guid}/subtasks", "POST api/tasks/{taskItemId:guid}/subtasks",
            "GET api/tasks/{taskItemId:guid}/checklist", "POST api/tasks/{taskItemId:guid}/checklist",
            "PATCH api/tasks/{taskItemId:guid}/checklist/{itemId:guid}", "DELETE api/tasks/{taskItemId:guid}/checklist/{itemId:guid}", "PUT api/tasks/{taskItemId:guid}/checklist/order",
            "GET api/tasks/{taskItemId:guid}/comments", "POST api/tasks/{taskItemId:guid}/comments",
            "PATCH api/task-comments/{commentId:guid}", "DELETE api/task-comments/{commentId:guid}",
            "GET api/tasks/{taskItemId:guid}/mention-candidates",
            "GET api/projects/{projectId:guid}/task-labels", "POST api/projects/{projectId:guid}/task-labels", "PATCH api/projects/{projectId:guid}/task-labels/{labelId:guid}",
            "POST api/projects/{projectId:guid}/task-labels/{labelId:guid}/archive", "POST api/projects/{projectId:guid}/task-labels/{labelId:guid}/restore",
            "PUT api/tasks/{taskItemId:guid}/labels/{labelId:guid}", "DELETE api/tasks/{taskItemId:guid}/labels/{labelId:guid}",
            "GET api/tasks/{taskItemId:guid}/watch-state", "PUT api/tasks/{taskItemId:guid}/watch", "DELETE api/tasks/{taskItemId:guid}/watch",
            "GET api/tasks/{taskItemId:guid}/files", "POST api/tasks/{taskItemId:guid}/files", "DELETE api/tasks/{taskItemId:guid}/files/{associationId:guid}",
            "POST api/attachments/{attachmentId:guid}/download-grants", "POST api/attachment-download-grants/{fileDownloadGrantId:guid}/download"
        };
        var routes = app.GetHttpRoutes();
        Assert.All(expectedRoutes, route => Assert.Contains(route, routes));

        using (var unauthenticated = new HttpRequestMessage(HttpMethod.Get, $"/api/tasks/{data.TaskA.Id:D}"))
        {
            unauthenticated.Headers.TryAddWithoutValidation("X-Tenant-Slug", data.TenantA.Slug);
            var response = await app.Client.SendAsync(unauthenticated);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        var detailResponse = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id:D}");
        var detailJson = await detailResponse.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, detailResponse.StatusCode);
        Assert.DoesNotContain("storageKey", detailJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("filePath", detailJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("tokenHash", detailJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("signedUrl", detailJson, StringComparison.OrdinalIgnoreCase);

        using var detail = JsonDocument.Parse(detailJson);
        var root = detail.RootElement;
        AssertDetailAggregateShape(root, data);
        var taskVersion = root.GetProperty("task").GetProperty("version").GetInt64();
        Assert.True(taskVersion > 0);

        using (var invalidUpdate = JsonContent("""{"title":"TaskA","description":null,"priority":1,"plannedStartDate":null,"plannedEndDate":null,"progressPercent":0}"""))
        {
            var response = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id:D}", HttpMethod.Patch, invalidUpdate);
            await AssertTaskErrorAsync(response, HttpStatusCode.BadRequest, "TASK_INVALID_EXPECTED_VERSION");
        }

        using (var invalidChecklistOrder = JsonContent("""{"orderedItemIds":[],"expectedTaskVersion":0}"""))
        {
            var response = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id:D}/checklist/order", HttpMethod.Put, invalidChecklistOrder);
            await AssertTaskErrorAsync(response, HttpStatusCode.BadRequest, "TASK_INVALID_EXPECTED_VERSION");
        }

        using (var invalidFileAssociation = JsonContent("""{"attachmentId":"00000000-0000-0000-0000-000000000001","expectedVersion":-1}"""))
        {
            var response = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id:D}/files", HttpMethod.Post, invalidFileAssociation);
            await AssertTaskErrorAsync(response, HttpStatusCode.BadRequest, "TASK_INVALID_EXPECTED_VERSION");
        }

        using (var staleUpdate = JsonContent("""{"title":"TaskA","description":null,"priority":1,"plannedStartDate":null,"plannedEndDate":null,"progressPercent":0,"expectedVersion":99999}"""))
        {
            var response = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id:D}", HttpMethod.Patch, staleUpdate);
            await AssertTaskErrorAsync(response, HttpStatusCode.Conflict, "TASK_STALE_VERSION");
        }

        using (var deniedUpdate = JsonContent($$"""{"title":"TaskA","description":null,"priority":1,"plannedStartDate":null,"plannedEndDate":null,"progressPercent":0,"expectedVersion":{{taskVersion}}}"""))
        {
            var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id:D}", HttpMethod.Patch, deniedUpdate);
            var body = await response.Content.ReadAsStringAsync();
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            Assert.DoesNotContain(data.TaskA.Title, body, StringComparison.Ordinal);
        }

        var crossTenant = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, $"/api/tasks/{data.TaskB.Id:D}");
        var crossTenantBody = await crossTenant.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.NotFound, crossTenant.StatusCode);
        Assert.DoesNotContain(data.TaskB.Title, crossTenantBody, StringComparison.Ordinal);
        Assert.DoesNotContain(data.FileB.StorageKey, crossTenantBody, StringComparison.Ordinal);

        for (var index = 0; index < 3; index++)
        {
            using var comment = JsonContent($$"""{"bodyPlainText":"contract-rate-{{index}}","isImportant":false}""");
            var response = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id:D}/comments", HttpMethod.Post, comment);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        using (var rateLimitedComment = JsonContent("""{"bodyPlainText":"contract-rate-limited","isImportant":false}"""))
        {
            var response = await app.SendAsync(data.TenantAOwner, data.TenantA.Slug, $"/api/tasks/{data.TaskA.Id:D}/comments", HttpMethod.Post, rateLimitedComment);
            var body = await response.Content.ReadAsStringAsync();
            Assert.Equal((HttpStatusCode)429, response.StatusCode);
            Assert.True(response.Headers.TryGetValues("Retry-After", out var retryAfter));
            Assert.True(int.TryParse(Assert.Single(retryAfter), out var retryAfterSeconds) && retryAfterSeconds > 0);
            using var problem = JsonDocument.Parse(body);
            Assert.Equal("TASK_COMMENT_RATE_LIMITED", problem.RootElement.GetProperty("code").GetString());
            Assert.True(problem.RootElement.GetProperty("retryAfterSeconds").GetInt32() > 0);
            Assert.DoesNotContain("StackTrace", body, StringComparison.OrdinalIgnoreCase);
        }
    }

    private static async Task AssertOkContainsOnlyAsync(
        HttpTenantIsolationTestApp app,
        User user,
        string tenantSlug,
        string path,
        string expected,
        string unexpected)
    {
        var response = await app.SendAsync(user, tenantSlug, path);
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(response.StatusCode == HttpStatusCode.OK, $"Expected OK from {path}, got {response.StatusCode}: {body}");
        if (!string.IsNullOrEmpty(expected))
        {
            Assert.Contains(expected, body, StringComparison.Ordinal);
        }

        Assert.DoesNotContain(unexpected, body, StringComparison.Ordinal);
    }

    private static Task AssertBadRequestAsync(
        HttpTenantIsolationTestApp app,
        User user,
        string tenantSlug,
        string path,
        HttpMethod? method = null)
    {
        return AssertStatusAsync(app, user, tenantSlug, path, HttpStatusCode.BadRequest, method);
    }

    private static StringContent JsonContent(string json) => new(json, Encoding.UTF8, "application/json");

    private static void AssertDetailAggregateShape(JsonElement root, TenantIsolationTestData data)
    {
        var task = root.GetProperty("task");
        foreach (var field in new[] { "id", "tenantId", "workspaceId", "projectId", "kind", "parentTaskId", "title", "description", "workflowStageId", "workflowStageName", "stageCategory", "priority", "plannedStartDate", "plannedEndDate", "deadlineAt", "progressPercent", "progressIsDerived", "version", "reviewStatus", "subresources" })
            Assert.True(task.TryGetProperty(field, out _), $"Missing canonical task field '{field}'.");
        Assert.Equal(data.TaskA.Id, task.GetProperty("id").GetGuid());
        Assert.Equal(data.TenantA.Id, task.GetProperty("tenantId").GetGuid());
        Assert.Equal(data.ProjectA.Id, task.GetProperty("projectId").GetGuid());
        Assert.Equal(JsonValueKind.String, task.GetProperty("priority").ValueKind);
        Assert.Equal(JsonValueKind.Number, task.GetProperty("stageCategory").ValueKind);
        Assert.Equal(JsonValueKind.Number, task.GetProperty("reviewStatus").ValueKind);

        foreach (var field in new[] { "relationships", "permissions", "checklist", "labels", "watchState", "subtasks", "comments", "files" })
            Assert.True(root.TryGetProperty(field, out _), $"Missing task detail aggregate field '{field}'.");
        foreach (var field in new[] { "canCreateSubtask", "canCreateChecklistItem", "canUpdateChecklistItems", "canDeleteChecklistItems", "canReorderChecklist", "canCreateComment", "canMarkCommentImportant", "canApplyLabels", "canManageLabelDefinitions", "canAssociateFiles", "canRemoveFiles", "canChangeWatch" })
            Assert.True(root.GetProperty("permissions").TryGetProperty(field, out _), $"Missing task detail permission '{field}'.");
        foreach (var pageName in new[] { "subtasks", "comments", "files" })
        {
            var page = root.GetProperty(pageName);
            foreach (var field in new[] { "items", "page", "pageSize", "totalCount", "hasMore" })
                Assert.True(page.TryGetProperty(field, out _), $"Missing {pageName} page field '{field}'.");
        }
        Assert.Equal(50, root.GetProperty("subtasks").GetProperty("pageSize").GetInt32());
        Assert.Equal(20, root.GetProperty("comments").GetProperty("pageSize").GetInt32());
        Assert.Equal(20, root.GetProperty("files").GetProperty("pageSize").GetInt32());
        Assert.Equal(JsonValueKind.Array, root.GetProperty("watchState").GetProperty("automaticSources").ValueKind);
    }

    private static async Task AssertTaskErrorAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(status, response.StatusCode);
        using var document = JsonDocument.Parse(body);
        Assert.Equal(code, document.RootElement.GetProperty("error").GetProperty("code").GetString());
        Assert.True(document.RootElement.TryGetProperty("requestId", out _));
    }

    private static async Task AssertTaskNotificationPreferenceErrorAsync(
        HttpResponseMessage response,
        HttpStatusCode status,
        string code,
        long? currentVersion = null,
        bool redacted = false)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(status, response.StatusCode);
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;
        Assert.Equal(code, root.GetProperty("error").GetProperty("code").GetString());
        Assert.Equal(redacted, root.GetProperty("error").GetProperty("redactionApplied").GetBoolean());
        Assert.True(root.TryGetProperty("requestId", out _));
        Assert.DoesNotContain("StackTrace", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SELECT ", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("INSERT INTO", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE ", body, StringComparison.OrdinalIgnoreCase);
        Assert.False(root.TryGetProperty("deadlineDigestLocalTime", out _));
        Assert.False(root.TryGetProperty("effectiveDeadlineDigestLocalTime", out _));

        if (currentVersion.HasValue)
        {
            Assert.Equal(currentVersion.Value, root.GetProperty("currentVersion").GetInt64());
            Assert.Equal($"\"{currentVersion.Value}\"", response.Headers.ETag?.Tag);
        }
    }

    private static async Task AssertTaskNotificationPreferenceStateAsync(
        HttpTenantIsolationTestApp app,
        TenantIsolationTestData data,
        string path,
        string? expectedLocalTime,
        long expectedVersion)
    {
        using var response = await app.SendAsync(data.TenantAMember, data.TenantA.Slug, path);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal($"\"{expectedVersion}\"", response.Headers.ETag?.Tag);
        Assert.Equal(expectedVersion, document.RootElement.GetProperty("version").GetInt64());
        if (expectedLocalTime is null)
        {
            Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("deadlineDigestLocalTime").ValueKind);
        }
        else
        {
            Assert.Equal(expectedLocalTime, document.RootElement.GetProperty("deadlineDigestLocalTime").GetString());
        }
    }

    private static async Task AssertMyTasksErrorAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(status, response.StatusCode);
        using var document = JsonDocument.Parse(body);
        Assert.Equal(code, document.RootElement.GetProperty("error").GetProperty("code").GetString());
        Assert.True(document.RootElement.TryGetProperty("requestId", out _));
        Assert.DoesNotContain("StackTrace", body, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task AssertSafeModelBindingErrorAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(status, response.StatusCode);
        using var document = JsonDocument.Parse(body);
        Assert.Equal((int)status, document.RootElement.GetProperty("status").GetInt32());
        Assert.True(document.RootElement.TryGetProperty("traceId", out _));
        Assert.DoesNotContain("StackTrace", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SELECT ", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("INSERT INTO", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE ", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("currentVersion", body, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task AssertSafeRejectedJsonContractAsync(
        HttpResponseMessage response,
        HttpStatusCode status)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(status, response.StatusCode);
        using var document = JsonDocument.Parse(body);
        if (document.RootElement.TryGetProperty("status", out var responseStatus))
        {
            Assert.Equal((int)status, responseStatus.GetInt32());
        }
        Assert.True(
            document.RootElement.TryGetProperty("traceId", out _) ||
            document.RootElement.TryGetProperty("requestId", out _));
        Assert.DoesNotContain("StackTrace", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SELECT ", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("INSERT INTO", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE ", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("currentVersion", body, StringComparison.OrdinalIgnoreCase);
    }

    private static Guid ReadResponseId(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.GetProperty("id").GetGuid();
    }

    private static async Task AssertConversationCreateRejectedWithoutLeakAsync(
        HttpTenantIsolationTestApp app,
        TenantIsolationTestData data,
        string json,
        string leakedValue)
    {
        using var content = JsonContent(json);
        var response = await app.SendAsync(data.CrossTenantUser, data.TenantA.Slug, "/api/conversations", HttpMethod.Post, content);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain(leakedValue, body, StringComparison.Ordinal);
        Assert.DoesNotContain(data.MessageA.Body, body, StringComparison.Ordinal);
        Assert.DoesNotContain(data.MessageB.Body, body, StringComparison.Ordinal);
    }

    private static async Task AssertStatusAsync(
        HttpTenantIsolationTestApp app,
        User user,
        string tenantSlug,
        string path,
        HttpStatusCode expectedStatus,
        HttpMethod? method = null)
    {
        var response = await app.SendAsync(user, tenantSlug, path, method);
        Assert.Equal(expectedStatus, response.StatusCode);
    }

    private sealed class HttpTenantIsolationTestApp : IAsyncDisposable
    {
        private HttpTenantIsolationTestApp(WebApplication app, HttpClient client, TenantIsolationTestData data)
        {
            App = app;
            Client = client;
            Data = data;
        }

        private WebApplication App { get; }
        public HttpClient Client { get; }
        public TenantIsolationTestData Data { get; }

        public static async Task<HttpTenantIsolationTestApp> CreateAsync()
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = Environments.Development
            });
            builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Tenancy:AppMode"] = "SaaS",
                ["Tenancy:TenantResolutionStrategy"] = "HeaderForDevelopmentOnly",
                ["Tenancy:AllowDevelopmentHeaderTenantResolution"] = "true",
                ["Tenancy:AllowDevelopmentHeaderInProduction"] = "false",
                ["Tenancy:DevelopmentTenantHeaderName"] = "X-Tenant-Slug",
                ["Security:CookieSecurePolicy"] = "SameAsRequest",
                ["Security:RequireHttps"] = "false",
                ["Security:EnableHsts"] = "false",
                ["Security:EnableCsrfProtection"] = "false",
                ["Security:EnableRateLimiting"] = "false",
                ["CommunicationSafety:MaxMessageLength"] = "120",
                ["CommunicationSafety:MaxAttachmentsPerMessage"] = "2",
                ["CommunicationSafety:MaxPostsPerMinutePerUser"] = "3",
                ["CommunicationSafety:MaxPostsPerMinutePerConversation"] = "30",
                ["CommunicationSafety:MaxThreadCreatesPerMinutePerUser"] = "3",
                ["CommunicationSafety:MaxReportsPerHourPerUser"] = "3",
                ["CommunicationSafety:DuplicatePostWindowSeconds"] = "60",
                ["FileStorage:Provider"] = "LocalFileSystem",
                ["FileStorage:RootPath"] = Path.Combine(Path.GetTempPath(), "aip-http-tenant-tests", Guid.NewGuid().ToString("N")),
                ["FileStorage:MaxFileSizeBytes"] = "10485760",
                ["FileStorage:AllowedExtensions:0"] = ".txt",
                ["FileStorage:AllowedContentTypes:0"] = "text/plain"
            });

            builder.Services
                .AddApplication()
                .AddWebServices(builder.Configuration);
            builder.Services.AddControllers().AddApplicationPart(typeof(WorkspacesController).Assembly);
            builder.Services
                .AddAuthentication(TestAuthHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { });
            builder.Services.AddAuthorization();
            var databaseName = Guid.NewGuid().ToString("N");
            builder.Services.AddDbContext<AppDbContext>(options =>
                options.UseInMemoryDatabase(databaseName));
            AddInfrastructureLikeServices(builder.Services, builder.Configuration);

            var app = builder.Build();
            app.UseMiddleware<TenantResolutionMiddleware>();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();

            await app.StartAsync();

            TenantIsolationTestData data;
            await using (var scope = app.Services.CreateAsyncScope())
            {
                var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
                data = await TenantIsolationTestData.SeedAsync(dbContext, currentTenant);
            }

            var addresses = app.Services.GetRequiredService<IServer>()
                .Features.Get<IServerAddressesFeature>()?.Addresses;
            var address = addresses?.Single() ?? throw new InvalidOperationException("Test server address was not available.");
            return new HttpTenantIsolationTestApp(app, new HttpClient { BaseAddress = new Uri(address) }, data);
        }

        public Task<HttpResponseMessage> SendAsync(User user, string tenantSlug, string path, HttpMethod? method = null, HttpContent? content = null)
        {
            var request = new HttpRequestMessage(method ?? HttpMethod.Get, path);
            request.Headers.TryAddWithoutValidation("X-Test-User-Id", user.Id.ToString("D"));
            request.Headers.TryAddWithoutValidation("X-Test-Email", user.Email);
            request.Headers.TryAddWithoutValidation("X-Test-System-Role", user.SystemRole.ToString());
            request.Headers.TryAddWithoutValidation("X-Tenant-Slug", tenantSlug);
            request.Content = content;
            return Client.SendAsync(request);
        }

        public IReadOnlySet<string> GetHttpRoutes() => App.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? [])
                .Select(method => $"{method} {endpoint.RoutePattern.RawText}"))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        public async Task<IReadOnlyList<AuditLog>> ListAuditLogsAsync(Guid tenantId, string tenantSlug)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await dbContext.AuditLogs.AsNoTracking().ToListAsync();
        }

        public async Task<Conversation?> GetConversationAsync(Guid tenantId, string tenantSlug, Guid conversationId)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await dbContext.Conversations
                .AsNoTracking()
                .Include(conversation => conversation.Members)
                .FirstOrDefaultAsync(conversation => conversation.Id == conversationId);
        }

        public async Task<Message?> GetMessageAsync(Guid tenantId, string tenantSlug, Guid messageId)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await dbContext.Messages
                .AsNoTracking()
                .FirstOrDefaultAsync(message => message.Id == messageId);
        }

        public async Task<(
            DateTimeOffset? DeadlineAt,
            DateOnly? PlannedEndDate,
            long Version,
            int TaskNotificationCount,
            int TaskOutboxCount)> GetTaskMutationStateAsync(
                Guid tenantId,
                string tenantSlug,
                Guid taskId)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var task = await dbContext.TaskItems
                .AsNoTracking()
                .SingleAsync(item => item.Id == taskId);
            var notificationCount = await dbContext.Notifications
                .AsNoTracking()
                .CountAsync(item =>
                    item.RelatedEntityType == "TaskItem" &&
                    item.RelatedEntityId == taskId);
            var outboxCount = await dbContext.OutboxEvents
                .AsNoTracking()
                .CountAsync(item =>
                    item.AggregateType == "Task" &&
                    item.AggregateId == taskId);
            return (
                task.DeadlineAt,
                task.PlannedEndDate,
                task.VersionNo,
                notificationCount,
                outboxCount);
        }

        public async Task<Guid> AddWorkspaceAsync(Guid tenantId, string tenantSlug, Guid userId)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var workspace = new Workspace
            {
                TenantId = tenantId,
                Name = "WorkspaceA-ThreadMismatch",
                Slug = $"workspace-a-thread-mismatch-{Guid.NewGuid():N}",
                CreatedByUserId = userId,
                Status = WorkspaceStatus.Active
            };
            dbContext.Workspaces.Add(workspace);
            dbContext.WorkspaceMembers.Add(new WorkspaceMember
            {
                TenantId = tenantId,
                WorkspaceId = workspace.Id,
                UserId = userId,
                Role = WorkspaceRole.Owner,
                Status = MembershipStatus.Active,
                JoinedAt = DateTimeOffset.UtcNow
            });
            await dbContext.SaveChangesAsync();
            return workspace.Id;
        }

        public async Task SetWorkspaceMembershipStatusAsync(
            Guid tenantId,
            string tenantSlug,
            Guid workspaceId,
            Guid userId,
            MembershipStatus status)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var member = await dbContext.WorkspaceMembers
                .FirstAsync(item => item.WorkspaceId == workspaceId && item.UserId == userId);
            member.Status = status;
            await dbContext.SaveChangesAsync();
        }

        public async Task SetWorkspaceAvailabilityAsync(
            Guid tenantId,
            string tenantSlug,
            Guid workspaceId,
            WorkspaceStatus status,
            bool softDeleted)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var workspace = await dbContext.Workspaces.FirstAsync(item => item.Id == workspaceId);
            workspace.Status = status;
            if (softDeleted)
            {
                workspace.MarkDeleted(DateTimeOffset.UtcNow);
            }
            else
            {
                workspace.Restore();
            }

            await dbContext.SaveChangesAsync();
        }

        public async Task AddGroupMemberAsync(Guid tenantId, string tenantSlug, Guid groupId, Guid userId)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            if (!await dbContext.GroupMembers.AnyAsync(item => item.GroupId == groupId && item.UserId == userId))
            {
                dbContext.GroupMembers.Add(new GroupMember
                {
                    TenantId = tenantId,
                    GroupId = groupId,
                    UserId = userId,
                    Role = GroupRole.Member,
                    JoinedAt = DateTimeOffset.UtcNow
                });
                await dbContext.SaveChangesAsync();
            }
        }

        public async Task UpdateConversationMemberAsync(Guid tenantId, string tenantSlug, Guid conversationId, Guid userId, Action<ConversationMember> update)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var member = await dbContext.ConversationMembers.FirstAsync(item => item.ConversationId == conversationId && item.UserId == userId);
            update(member);
            await dbContext.SaveChangesAsync();
        }

        public async Task UpdateConversationAsync(Guid tenantId, string tenantSlug, Guid conversationId, Action<Conversation> update)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var currentTenant = scope.ServiceProvider.GetRequiredService<CurrentTenantService>();
            currentTenant.SetTenant(tenantId, tenantSlug);
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conversation = await dbContext.Conversations.FirstAsync(item => item.Id == conversationId);
            update(conversation);
            await dbContext.SaveChangesAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await App.DisposeAsync();
        }

        private static void AddInfrastructureLikeServices(IServiceCollection services, IConfiguration configuration)
        {
            services.Configure<FileStorageOptions>(configuration.GetSection("FileStorage"));
            services.AddScoped<IUserRepository, UserRepository>();
            services.AddScoped<ITenantRepository, TenantRepository>();
            services.AddScoped<ITenantExportRepository, TenantExportRepository>();
            services.AddScoped<IIntegrationRepository, IntegrationRepository>();
            services.AddScoped<AipPortal.Application.Admin.IAdminRepository, AdminRepository>();
            services.AddScoped<IInviteRepository, InviteRepository>();
            services.AddScoped<ISessionRepository, SessionRepository>();
            services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
            services.AddScoped<ITaskNotificationPreferenceRepository, TaskNotificationPreferenceRepository>();
            services.AddScoped<IGroupRepository, GroupRepository>();
            services.AddScoped<IChannelRepository, ChannelRepository>();
            services.AddScoped<IMessagingRepository, MessagingRepository>();
            services.AddScoped<IProjectRepository, ProjectRepository>();
            services.AddScoped<IEventRepository, EventRepository>();
            services.AddScoped<IFormRepository, FormRepository>();
            services.AddScoped<IFileRepository, FileRepository>();
            services.AddScoped<IFileDownloadGrantRepository, FileDownloadGrantRepository>();
            services.AddScoped<IStudentRecordExportGrantRepository, StudentRecordExportGrantRepository>();
            services.AddScoped<ITenantPlanRepository, TenantPlanRepository>();
            services.AddScoped<IArtifactRepository, ArtifactRepository>();
            services.AddScoped<IPlanningRepository, PlanningRepository>();
            services.AddScoped<IUiShellRepository, UiShellRepository>();
            services.AddScoped<IAnnouncementRepository, AnnouncementRepository>();
            services.AddScoped<AipPortal.Application.Realtime.IOutboxEventRepository, OutboxEventRepository>();
            services.AddScoped<AipPortal.Application.Realtime.ITransactionalOutbox, AipPortal.Application.Realtime.TransactionalOutbox>();
            services.AddScoped<IUnitOfWork, EfUnitOfWork>();
            services.AddScoped<IFileUploadPolicy, ConfiguredFileUploadPolicy>();
            services.AddScoped<IFileStorageService, InMemoryFileStorageService>();
            services.AddScoped<IPasswordHasher, Pbkdf2PasswordHasher>();
            services.AddScoped<ITokenHasher, Sha256TokenHasher>();
            services.AddScoped<IAuditLogger, DbAuditLogger>();
            services.AddScoped<INotificationService, DbNotificationService>();
            services.AddScoped<AipPortal.Application.Search.ISearchService, DbSearchService>();
            services.AddScoped<AipPortal.Application.Audit.IAuditQueryService, DbAuditQueryService>();
            services.AddSingleton<IClock, AipPortal.Infrastructure.Security.SystemClock>();
            services.AddScoped<IStudentRecordRepository, StudentRecordRepository>();
        }
    }

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string SchemeName = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-User-Id", out var userId) ||
                !Guid.TryParse(userId.ToString(), out var parsedUserId))
            {
                return Task.FromResult(AuthenticateResult.NoResult());
            }

            var email = Request.Headers.TryGetValue("X-Test-Email", out var emailHeader)
                ? emailHeader.ToString()
                : "test@example.test";
            var systemRole = Request.Headers.TryGetValue("X-Test-System-Role", out var roleHeader)
                ? roleHeader.ToString()
                : SystemRole.User.ToString();

            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, parsedUserId.ToString("D")),
                new(ClaimTypes.Email, email),
                new("system_role", systemRole),
                new(ClaimTypes.Role, systemRole)
            };
            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }

    private sealed class InMemoryFileStorageService : IFileStorageService
    {
        private readonly Dictionary<string, byte[]> files = new(StringComparer.Ordinal);

        public async Task<Result> SaveAsync(string storageKey, Stream stream, string contentType, CancellationToken cancellationToken = default)
        {
            using var memory = new MemoryStream();
            await stream.CopyToAsync(memory, cancellationToken);
            files[storageKey] = memory.ToArray();
            return Result.Success();
        }

        public Task<Stream> OpenReadAsync(string storageKey, CancellationToken cancellationToken = default)
        {
            files.TryGetValue(storageKey, out var bytes);
            return Task.FromResult<Stream>(new MemoryStream(bytes ?? "test file"u8.ToArray()));
        }

        public Task DeleteAsync(string storageKey, CancellationToken cancellationToken = default)
        {
            files.Remove(storageKey);
            return Task.CompletedTask;
        }

        public Task<bool> ExistsAsync(string storageKey, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(true);
        }

        public Task<string?> CreateSignedReadUrlAsync(string storageKey, TimeSpan expiresIn, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<string?>(null);
        }
    }
}
