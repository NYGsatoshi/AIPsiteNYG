using System.Text.Json;
using AipPortal.Application.Audit;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using AipPortal.Application.Security.Redaction;
using AipPortal.Application.Tenancy;
using AipPortal.Domain.Enums;
using AipPortal.Web.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace AipPortal.Tests.Audit;

public sealed class AuditControllerTests
{
    [Fact]
    public async Task AdminAuditGrid_UsesGridDefaultWhenPageSizeIsOmitted()
    {
        var audit = new CapturingAuditQueryService();
        var controller = CreateController(audit);

        var result = await controller.AdminAuditGrid(new AuditLogQuery(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        var capturedQuery = Assert.IsType<AuditLogQuery>(audit.LastGridQuery);
        Assert.Equal(100, capturedQuery.PageSize);
        Assert.Equal(1, capturedQuery.Page);
    }

    [Fact]
    public async Task AdminAuditGrid_PreservesExplicitPageSize()
    {
        var audit = new CapturingAuditQueryService();
        var controller = CreateController(audit, "?page=2&pageSize=50");

        var result = await controller.AdminAuditGrid(
            new AuditLogQuery(Page: 2, PageSize: 50),
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        var capturedQuery = Assert.IsType<AuditLogQuery>(audit.LastGridQuery);
        Assert.Equal(50, capturedQuery.PageSize);
        Assert.Equal(2, capturedQuery.Page);
    }

    [Fact]
    public async Task SecurityEvents_ResponseBoundaryRedactsRestrictedFieldsWithoutSensitiveCapability()
    {
        const string ipAddress = "203.0.113.42";
        const string userAgent = "audit-sensitive-agent";
        const string summary = "Visible audit summary";
        var audit = new CapturingAuditQueryService(
            securityEvents:
            [
                new SecurityEventListItemResponse(
                    Guid.NewGuid(),
                    SecurityEventType.AccessDenied,
                    null,
                    null,
                    ipAddress,
                    userAgent,
                    SecurityEventSeverity.Warning,
                    summary,
                    null,
                    DateTimeOffset.UtcNow)
            ]);
        var controller = CreateController(
            audit,
            capabilities: new AuditCapabilityResponse(
                CanView: true,
                CanReview: true,
                CanApprove: false,
                CanExport: false,
                CanViewSensitiveMetadata: false));

        var result = await controller.SecurityEvents(new SecurityEventQuery(), CancellationToken.None);

        var payload = SerializeOk(result);
        Assert.Contains(summary, payload, StringComparison.Ordinal);
        Assert.DoesNotContain(ipAddress, payload, StringComparison.Ordinal);
        Assert.DoesNotContain(userAgent, payload, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SecurityEvents_ResponseBoundaryPreservesRestrictedFieldsWithSensitiveCapability()
    {
        const string ipAddress = "203.0.113.43";
        const string userAgent = "audit-authorized-sensitive-agent";
        var audit = new CapturingAuditQueryService(
            securityEvents:
            [
                new SecurityEventListItemResponse(
                    Guid.NewGuid(),
                    SecurityEventType.AccessDenied,
                    null,
                    null,
                    ipAddress,
                    userAgent,
                    SecurityEventSeverity.Warning,
                    "Visible audit summary",
                    null,
                    DateTimeOffset.UtcNow)
            ]);
        var controller = CreateController(
            audit,
            capabilities: new AuditCapabilityResponse(
                CanView: true,
                CanReview: true,
                CanApprove: false,
                CanExport: false,
                CanViewSensitiveMetadata: true));

        var result = await controller.SecurityEvents(new SecurityEventQuery(), CancellationToken.None);

        var payload = SerializeOk(result);
        Assert.Contains(ipAddress, payload, StringComparison.Ordinal);
        Assert.Contains(userAgent, payload, StringComparison.Ordinal);
    }

    private static string SerializeOk(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        return JsonSerializer.Serialize(ok.Value);
    }

    private static AuditController CreateController(
        CapturingAuditQueryService audit,
        string? queryString = null,
        AuditCapabilityResponse? capabilities = null)
    {
        var tenant = new CurrentTenantService();
        tenant.SetTenant(Guid.NewGuid(), "audit-test");
        var services = new ServiceCollection()
            .AddSingleton<IRedactionService, CanonicalRedactionService>()
            .AddSingleton<ICurrentUser>(new TestCurrentUser(Guid.NewGuid()))
            .AddSingleton<ICurrentTenant>(tenant)
            .BuildServiceProvider();
        var controller = new AuditController(
            audit,
            capabilities is null ? null : new StubAuditAuthorizationService(capabilities))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    RequestServices = services
                }
            }
        };

        if (!string.IsNullOrWhiteSpace(queryString))
        {
            controller.Request.QueryString = new QueryString(queryString);
        }

        return controller;
    }

    private sealed class TestCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId => userId;
        public Guid? SessionId => Guid.NewGuid();
        public string? Email => "audit-test@example.invalid";
        public SystemRole? SystemRole => AipPortal.Domain.Enums.SystemRole.NormalUser;
        public bool IsAuthenticated => true;
    }

    private sealed class StubAuditAuthorizationService(AuditCapabilityResponse capabilities)
        : IAuditAuthorizationService
    {
        public Task<AuditCapabilityResponse> GetCapabilitiesAsync(
            CancellationToken cancellationToken = default) => Task.FromResult(capabilities);

        public Task<bool> HasCapabilityAsync(
            string capabilityKey,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(IsGranted(capabilityKey));

        public Task<Result> AuthorizeAsync(
            string capabilityKey,
            string operation,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(IsGranted(capabilityKey)
                ? Result.Success()
                : Result.Failure(new ApplicationErrorDetail(
                    "CapabilityDenied",
                    "The requested Audit operation is not permitted.")));

        private bool IsGranted(string capabilityKey) => capabilityKey switch
        {
            CapabilityKeys.AuditView => capabilities.CanView,
            CapabilityKeys.AuditReview => capabilities.CanReview,
            CapabilityKeys.AuditApprove => capabilities.CanApprove,
            CapabilityKeys.AuditExport => capabilities.CanExport,
            CapabilityKeys.AuditSensitiveMetadataView => capabilities.CanViewSensitiveMetadata,
            _ => false
        };
    }

    private sealed class CapturingAuditQueryService(
        IReadOnlyList<SecurityEventListItemResponse>? securityEvents = null) : IAuditQueryService
    {
        private readonly IReadOnlyList<SecurityEventListItemResponse> securityEvents = securityEvents ?? [];

        public AuditLogQuery? LastGridQuery { get; private set; }

        public Task<Result<PagedResponse<AuditLogListItemResponse>>> ListAuditLogsAsync(
            AuditLogQuery query,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result<PagedResponse<AuditLogListItemResponse>>.Success(
                new PagedResponse<AuditLogListItemResponse>(
                    Array.Empty<AuditLogListItemResponse>(),
                    query.Page,
                    query.PageSize,
                    0)));
        }

        public Task<Result<PagedResponse<AuditGridRowResponse>>> ListAuditGridAsync(
            AuditLogQuery query,
            CancellationToken cancellationToken = default)
        {
            LastGridQuery = query;
            return Task.FromResult(Result<PagedResponse<AuditGridRowResponse>>.Success(
                new PagedResponse<AuditGridRowResponse>(
                    Array.Empty<AuditGridRowResponse>(),
                    query.Page,
                    query.PageSize,
                    0)));
        }

        public Task<Result<PagedResponse<SecurityEventListItemResponse>>> ListSecurityEventsAsync(
            SecurityEventQuery query,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result<PagedResponse<SecurityEventListItemResponse>>.Success(
                new PagedResponse<SecurityEventListItemResponse>(
                    securityEvents,
                    query.Page,
                    query.PageSize,
                    securityEvents.Count)));
        }
    }
}
