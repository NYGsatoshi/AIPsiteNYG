using AipPortal.Application.Audit;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.Audit;

public sealed class AuditFindingsServiceTests
{
    [Fact]
    public async Task ListPrioritizesUnresolvedThenSeverityThenConfidence()
    {
        await using var fixture = await Fixture.CreateAsync();
        var resolvedCritical = fixture.AddFinding(AuditFindingTriageStatus.Resolved, AuditFindingSeverity.Critical, 100, 1);
        var openMedium = fixture.AddFinding(AuditFindingTriageStatus.Open, AuditFindingSeverity.Medium, 95, 2);
        var openCritical = fixture.AddFinding(AuditFindingTriageStatus.Open, AuditFindingSeverity.Critical, 40, 3);
        var reviewingHigh = fixture.AddFinding(AuditFindingTriageStatus.Reviewing, AuditFindingSeverity.High, 99, 4);
        await fixture.Context.SaveChangesAsync();

        var result = await fixture.Service.ListAsync(new AuditFindingsQuery(fixture.ArtifactVersionId));

        Assert.True(result.IsSuccess, result.Error ?? result.ErrorDetail?.Message);
        Assert.Equal(
            new[] { openCritical.Id, reviewingHigh.Id, openMedium.Id, resolvedCritical.Id },
            result.Value!.Findings.Select(item => item.FindingId));
        Assert.Equal("Critical", result.Value.Findings[0].Severity);
        Assert.Equal(40, result.Value.Findings[0].ConfidencePercent);
        Assert.True(result.Value.CanReview);
    }

    [Fact]
    public async Task ListProjectsOnlyAuthorizedEvidenceTraceAndOwnerDisplay()
    {
        await using var fixture = await Fixture.CreateAsync();
        var eventId = Guid.NewGuid();
        var evidenceId = Guid.NewGuid();
        var finding = fixture.AddFinding(AuditFindingTriageStatus.Open, AuditFindingSeverity.High, 88, 1);
        finding.OwnerUserId = fixture.UserId;
        fixture.Claims.SetEvidence(finding.ArtifactClaimId, evidenceId, eventId);
        await fixture.Context.SaveChangesAsync();

        var result = await fixture.Service.ListAsync(new AuditFindingsQuery(fixture.ArtifactVersionId));

        Assert.True(result.IsSuccess, result.Error ?? result.ErrorDetail?.Message);
        var item = Assert.Single(result.Value!.Findings);
        Assert.Equal(evidenceId, item.RelatedEvidenceId);
        Assert.Equal(eventId, item.RelatedEventId);
        Assert.Equal("Audit Reviewer", item.OwnerDisplayName);
        Assert.Equal("detector.test", item.DetectorKey);
        Assert.Equal("policy-2026.09", item.PolicyVersion);
    }

    [Theory]
    [InlineData("AcceptedRisk")]
    [InlineData("FalsePositive")]
    public async Task RiskAcceptanceAndFalsePositiveRequireReason(string nextStatus)
    {
        await using var fixture = await Fixture.CreateAsync();
        var finding = fixture.AddFinding(AuditFindingTriageStatus.Open, AuditFindingSeverity.High, 80, 1);
        await fixture.Context.SaveChangesAsync();

        var result = await fixture.Service.UpdateTriageAsync(
            finding.Id,
            new UpdateAuditFindingTriageRequest(nextStatus, null));

        Assert.False(result.IsSuccess);
        Assert.Equal("ReasonRequired", result.ErrorDetail?.Code);
        Assert.Equal(AuditFindingTriageStatus.Open, finding.Status);
        Assert.Empty(fixture.Context.Set<AuditFindingHistory>());
        Assert.Empty(fixture.Audit.Entries);
    }

    [Fact]
    public async Task FalsePositiveAssignsOwnerAndAppendsHistoryWithoutCopyingReasonToAuditLog()
    {
        await using var fixture = await Fixture.CreateAsync();
        var finding = fixture.AddFinding(AuditFindingTriageStatus.Open, AuditFindingSeverity.Medium, 62, 1);
        await fixture.Context.SaveChangesAsync();

        var result = await fixture.Service.UpdateTriageAsync(
            finding.Id,
            new UpdateAuditFindingTriageRequest("FalsePositive", "Detector matched a quoted example."));

        Assert.True(result.IsSuccess, result.Error ?? result.ErrorDetail?.Message);
        Assert.Equal(AuditFindingTriageStatus.FalsePositive, finding.Status);
        Assert.Equal(fixture.UserId, finding.OwnerUserId);
        Assert.Equal("Detector matched a quoted example.", finding.ResolutionReason);
        var history = Assert.Single(fixture.Context.Set<AuditFindingHistory>());
        Assert.Equal(AuditFindingTriageStatus.Open, history.FromStatus);
        Assert.Equal(AuditFindingTriageStatus.FalsePositive, history.ToStatus);
        Assert.Equal(fixture.UserId, history.ChangedByUserId);
        Assert.Equal("Detector matched a quoted example.", history.Reason);

        var audit = Assert.Single(fixture.Audit.Entries);
        Assert.Equal("AuditFindingTriageChanged", audit.Action);
        Assert.NotNull(audit.Metadata);
        Assert.False(audit.Metadata!.ContainsKey("reason"));
        Assert.DoesNotContain(
            "Detector matched a quoted example.",
            System.Text.Json.JsonSerializer.Serialize(audit),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task AuditReviewPermissionIsRequiredBeforeFindingMutation()
    {
        await using var fixture = await Fixture.CreateAsync(canReview: false);
        var finding = fixture.AddFinding(AuditFindingTriageStatus.Open, AuditFindingSeverity.Low, 25, 1);
        await fixture.Context.SaveChangesAsync();

        var result = await fixture.Service.UpdateTriageAsync(
            finding.Id,
            new UpdateAuditFindingTriageRequest("Reviewing"));

        Assert.False(result.IsSuccess);
        Assert.Equal("CapabilityDenied", result.ErrorDetail?.Code);
        Assert.Equal(AuditFindingTriageStatus.Open, finding.Status);
        Assert.Empty(fixture.Context.Set<AuditFindingHistory>());
        Assert.Equal(1, fixture.Authorization.AuthorizeCalls);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private int claimOrdinal;

        private Fixture(
            Guid tenantId,
            Guid userId,
            Guid artifactVersionId,
            AppDbContext context,
            StubClaimsEvidenceService claims,
            StubAuditAuthorization authorization,
            StubAuditLogger audit,
            DbAuditFindingsService service)
        {
            TenantId = tenantId;
            UserId = userId;
            ArtifactVersionId = artifactVersionId;
            Context = context;
            Claims = claims;
            Authorization = authorization;
            Audit = audit;
            Service = service;
        }

        public Guid TenantId { get; }
        public Guid UserId { get; }
        public Guid ArtifactVersionId { get; }
        public AppDbContext Context { get; }
        public StubClaimsEvidenceService Claims { get; }
        public StubAuditAuthorization Authorization { get; }
        public StubAuditLogger Audit { get; }
        public DbAuditFindingsService Service { get; }

        public static async Task<Fixture> CreateAsync(bool canReview = true)
        {
            var tenantId = Guid.NewGuid();
            var userId = Guid.NewGuid();
            var artifactVersionId = Guid.NewGuid();
            var currentTenant = new StubCurrentTenant(tenantId);
            var context = new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>()
                    .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
                    .Options,
                currentTenant);

            var tenant = new Tenant(tenantId)
            {
                Name = "Audit tenant",
                Slug = "audit-tenant",
                DisplayName = "Audit tenant",
                Status = TenantStatus.Active,
            };
            var user = new User
            {
                Id = userId,
                DisplayName = "Audit Reviewer",
                Email = "reviewer@example.invalid",
                NormalizedEmail = "REVIEWER@EXAMPLE.INVALID",
                PasswordHash = "test",
                Status = UserStatus.Active,
            };
            context.Tenants.Add(tenant);
            context.Users.Add(user);
            context.TenantUsers.Add(new TenantUser
            {
                TenantId = tenantId,
                UserId = userId,
                Role = TenantUserRole.Member,
                Status = TenantUserStatus.Active,
                JoinedAt = DateTimeOffset.UtcNow,
                Tenant = tenant,
                User = user,
            });
            await context.SaveChangesAsync();

            var claims = new StubClaimsEvidenceService(artifactVersionId);
            var authorization = new StubAuditAuthorization(canReview);
            var audit = new StubAuditLogger();
            var service = new DbAuditFindingsService(
                context,
                claims,
                authorization,
                new StubCurrentUser(userId),
                audit,
                new ContextUnitOfWork(context));
            return new Fixture(
                tenantId,
                userId,
                artifactVersionId,
                context,
                claims,
                authorization,
                audit,
                service);
        }

        public ArtifactFinding AddFinding(
            AuditFindingTriageStatus status,
            AuditFindingSeverity severity,
            int confidence,
            int ordinal)
        {
            claimOrdinal = Math.Max(claimOrdinal, ordinal);
            var claim = new ArtifactClaim
            {
                TenantId = TenantId,
                ArtifactVersionId = ArtifactVersionId,
                Ordinal = ordinal,
                Text = $"Claim {ordinal}",
                CitationPresent = true,
                SupportStatus = ArtifactClaimSupportStatus.Unverified,
                ReviewStatus = ArtifactClaimReviewStatus.Unreviewed,
            };
            var finding = new ArtifactFinding
            {
                TenantId = TenantId,
                ArtifactClaimId = claim.Id,
                ArtifactClaim = claim,
                Severity = severity,
                ConfidencePercent = confidence,
                DetectorKey = "detector.test",
                PolicyVersion = "policy-2026.09",
                Status = status,
            };
            claim.Finding = finding;
            Context.Set<ArtifactClaim>().Add(claim);
            Context.Set<ArtifactFinding>().Add(finding);
            Claims.AddClaim(claim);
            return finding;
        }

        public ValueTask DisposeAsync() => Context.DisposeAsync();
    }

    private sealed class StubClaimsEvidenceService(Guid artifactVersionId) : IAuditClaimsEvidenceService
    {
        private readonly Dictionary<Guid, AuditClaimEvidenceResponse> claims = new();

        public void AddClaim(ArtifactClaim claim)
        {
            claims[claim.Id] = new AuditClaimEvidenceResponse(
                claim.Id,
                claim.Ordinal,
                claim.Text,
                claim.CitationPresent,
                claim.SupportStatus.ToString(),
                claim.ReviewStatus.ToString(),
                Array.Empty<AuditEvidenceResponse>());
        }

        public void SetEvidence(Guid claimId, Guid evidenceId, Guid eventId)
        {
            var claim = claims[claimId];
            claims[claimId] = claim with
            {
                Evidence = new[]
                {
                    new AuditEvidenceResponse(
                        evidenceId,
                        1,
                        "WebSnapshot",
                        "https://example.invalid/source",
                        "Authorized source",
                        "Authorized passage",
                        "Section 1",
                        eventId)
                }
            };
        }

        public Task<Result<AuditClaimsEvidenceResponse>> GetAsync(
            Guid requestedVersionId,
            CancellationToken cancellationToken = default)
        {
            if (requestedVersionId != artifactVersionId)
            {
                return Task.FromResult(Result<AuditClaimsEvidenceResponse>.Failure(
                    new ApplicationErrorDetail("ArtifactVersionNotFound", "The artifact version is not available.")));
            }

            return Task.FromResult(Result<AuditClaimsEvidenceResponse>.Success(new AuditClaimsEvidenceResponse(
                Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                artifactVersionId,
                1,
                "Audit report",
                claims.Values.OrderBy(claim => claim.Ordinal).ToArray())));
        }
    }

    private sealed class StubAuditAuthorization(bool canReview) : IAuditAuthorizationService
    {
        public int AuthorizeCalls { get; private set; }

        public Task<AuditCapabilityResponse> GetCapabilitiesAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new AuditCapabilityResponse(true, canReview, false, false, false));

        public Task<bool> HasCapabilityAsync(
            string capabilityKey,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(capabilityKey == AipPortal.Application.Tenancy.CapabilityKeys.AuditView ||
                            (capabilityKey == AipPortal.Application.Tenancy.CapabilityKeys.AuditReview && canReview));

        public Task<Result> AuthorizeAsync(
            string capabilityKey,
            string operation,
            CancellationToken cancellationToken = default)
        {
            AuthorizeCalls++;
            return Task.FromResult(
                capabilityKey == AipPortal.Application.Tenancy.CapabilityKeys.AuditReview && canReview
                    ? Result.Success()
                    : Result.Failure(new ApplicationErrorDetail("CapabilityDenied", "Audit operation denied.")));
        }
    }

    private sealed class StubCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId { get; } = userId;
        public Guid? SessionId => null;
        public string? Email => "reviewer@example.invalid";
        public SystemRole? SystemRole => AipPortal.Domain.Enums.SystemRole.User;
        public bool IsAuthenticated => true;
    }

    private sealed class StubCurrentTenant(Guid tenantId) : ICurrentTenant
    {
        public Guid TenantId { get; } = tenantId;
        public bool IsAvailable => true;
        public string? TenantSlug => "audit-tenant";
        public bool IsPlatformScope => false;
    }

    private sealed class StubAuditLogger : IAuditLogger
    {
        public List<AuditLogEntry> Entries { get; } = new();

        public Task LogAsync(AuditLogEntry entry, CancellationToken cancellationToken = default)
        {
            Entries.Add(entry);
            return Task.CompletedTask;
        }
    }

    private sealed class ContextUnitOfWork(AppDbContext context) : IUnitOfWork
    {
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) =>
            context.SaveChangesAsync(cancellationToken);
    }
}
