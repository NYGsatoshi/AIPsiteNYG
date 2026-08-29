using AipPortal.Application.Artifacts;
using AipPortal.Application.Audit;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Files;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Tests.Audit;

public sealed class AuditClaimsEvidenceServiceTests
{
    [Fact]
    public async Task AuthorizedArtifactReturnsClaimAndBoundedEvidenceWithAuthorizedEventTrace()
    {
        await using var fixture = await Fixture.CreateAsync();
        var eventId = Guid.NewGuid();
        var claim = fixture.AddClaim(
            citationPresent: true,
            supportStatus: ArtifactClaimSupportStatus.Contradicted,
            new ArtifactEvidence
            {
                TenantId = fixture.TenantId,
                Ordinal = 1,
                SourceKind = ArtifactEvidenceSourceKind.WebSnapshot,
                SourceReference = "https://example.invalid/source",
                SourceTitleSnapshot = "Authorized source",
                PassageSnapshot = "A bounded passage that contradicts the claim.",
                LocationSnapshot = "Section 2",
                SourceEventAuditId = eventId,
            });
        fixture.Context.AuditLogs.Add(new AuditLog
        {
            Id = eventId,
            TenantId = fixture.TenantId,
            Action = "SourceCaptured",
            EntityType = "ArtifactVersion",
            EntityId = fixture.Version.Id,
            Summary = "Source captured.",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await fixture.Context.SaveChangesAsync();

        var result = await fixture.Service.GetAsync(fixture.Version.Id);

        Assert.True(result.IsSuccess);
        Assert.Equal(fixture.Version.Id, result.Value!.ArtifactVersionId);
        var projectedClaim = Assert.Single(result.Value.Claims);
        Assert.Equal(claim.Id, projectedClaim.ClaimId);
        Assert.True(projectedClaim.CitationPresent);
        Assert.Equal("Contradicted", projectedClaim.SupportStatus);
        var evidence = Assert.Single(projectedClaim.Evidence);
        Assert.Equal("Authorized source", evidence.SourceTitle);
        Assert.Equal("A bounded passage that contradicts the claim.", evidence.Passage);
        Assert.Equal(eventId, evidence.SourceEventAuditId);
    }

    [Fact]
    public async Task UnauthorizedEvidenceIsOmittedWithoutSourceTitleReferenceOrPassageLeakage()
    {
        await using var fixture = await Fixture.CreateAsync();
        var deniedAttachmentId = Guid.NewGuid();
        fixture.AddClaim(
            citationPresent: true,
            supportStatus: ArtifactClaimSupportStatus.Insufficient,
            new ArtifactEvidence
            {
                TenantId = fixture.TenantId,
                Ordinal = 1,
                SourceKind = ArtifactEvidenceSourceKind.WebSnapshot,
                SourceReference = "web-ref",
                SourceTitleSnapshot = "Visible web source",
                PassageSnapshot = "Visible passage",
            },
            new ArtifactEvidence
            {
                TenantId = fixture.TenantId,
                Ordinal = 2,
                SourceKind = ArtifactEvidenceSourceKind.FileAttachment,
                SourceReference = deniedAttachmentId.ToString("D"),
                SourceTitleSnapshot = "PROTECTED-SOURCE-TITLE",
                PassageSnapshot = "PROTECTED-SOURCE-PASSAGE",
                LocationSnapshot = "PROTECTED-SOURCE-LOCATION",
            });
        await fixture.Context.SaveChangesAsync();

        var result = await fixture.Service.GetAsync(fixture.Version.Id);

        Assert.True(result.IsSuccess);
        var claim = Assert.Single(result.Value!.Claims);
        var evidence = Assert.Single(claim.Evidence);
        Assert.Equal("Visible web source", evidence.SourceTitle);
        var serialized = System.Text.Json.JsonSerializer.Serialize(result.Value);
        Assert.DoesNotContain("PROTECTED-SOURCE", serialized, StringComparison.Ordinal);
        Assert.DoesNotContain(deniedAttachmentId.ToString("D"), serialized, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task MissingOrUnauthorizedEventIdIsNotProjected()
    {
        await using var fixture = await Fixture.CreateAsync();
        var unavailableEventId = Guid.NewGuid();
        fixture.AddClaim(
            citationPresent: true,
            supportStatus: ArtifactClaimSupportStatus.Supported,
            new ArtifactEvidence
            {
                TenantId = fixture.TenantId,
                Ordinal = 1,
                SourceKind = ArtifactEvidenceSourceKind.WebSnapshot,
                SourceReference = "web-ref",
                SourceTitleSnapshot = "Source",
                PassageSnapshot = "Passage",
                SourceEventAuditId = unavailableEventId,
            });
        await fixture.Context.SaveChangesAsync();

        var result = await fixture.Service.GetAsync(fixture.Version.Id);

        Assert.True(result.IsSuccess);
        Assert.Null(Assert.Single(Assert.Single(result.Value!.Claims).Evidence).SourceEventAuditId);
    }

    [Fact]
    public async Task AuditViewCapabilityIsRequiredBeforeArtifactLookup()
    {
        await using var fixture = await Fixture.CreateAsync(canViewAudit: false);

        var result = await fixture.Service.GetAsync(fixture.Version.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal("CapabilityDenied", result.ErrorDetail?.Code);
        Assert.Equal(1, fixture.AuditAuthorization.AuthorizeCalls);
        Assert.Equal(0, fixture.ArtifactAuthorization.ViewCalls);
    }

    [Fact]
    public async Task ArtifactAuthorizationFailureUsesGenericVersionNotFoundBoundary()
    {
        await using var fixture = await Fixture.CreateAsync(canViewArtifact: false);
        fixture.AddClaim(
            citationPresent: false,
            supportStatus: ArtifactClaimSupportStatus.Unverified);
        await fixture.Context.SaveChangesAsync();

        var result = await fixture.Service.GetAsync(fixture.Version.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal("ArtifactVersionNotFound", result.ErrorDetail?.Code);
        Assert.DoesNotContain("artifact", result.ErrorDetail!.Message, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(
            Guid tenantId,
            Guid userId,
            AppDbContext context,
            Artifact artifact,
            ArtifactVersion version,
            StubArtifactAuthorization artifactAuthorization,
            StubAuditAuthorization auditAuthorization,
            DbAuditClaimsEvidenceService service)
        {
            TenantId = tenantId;
            UserId = userId;
            Context = context;
            Artifact = artifact;
            Version = version;
            ArtifactAuthorization = artifactAuthorization;
            AuditAuthorization = auditAuthorization;
            Service = service;
        }

        public Guid TenantId { get; }
        public Guid UserId { get; }
        public AppDbContext Context { get; }
        public Artifact Artifact { get; }
        public ArtifactVersion Version { get; }
        public StubArtifactAuthorization ArtifactAuthorization { get; }
        public StubAuditAuthorization AuditAuthorization { get; }
        public DbAuditClaimsEvidenceService Service { get; }

        public static async Task<Fixture> CreateAsync(
            bool canViewAudit = true,
            bool canViewArtifact = true)
        {
            var tenantId = Guid.NewGuid();
            var userId = Guid.NewGuid();
            var currentTenant = new StubCurrentTenant(tenantId);
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
                .Options;
            var context = new AppDbContext(options, currentTenant);
            context.Tenants.Add(new Tenant(tenantId)
            {
                Name = "Audit test tenant",
                Slug = "audit-test",
                DisplayName = "Audit test tenant",
                Status = TenantStatus.Active,
            });
            await context.SaveChangesAsync();

            var artifact = new Artifact
            {
                TenantId = tenantId,
                ProjectId = Guid.NewGuid(),
                Name = "Research report",
                ArtifactType = ArtifactType.Report,
                Status = ArtifactStatus.Draft,
                CreatedByUserId = userId,
            };
            var version = new ArtifactVersion
            {
                TenantId = tenantId,
                ArtifactId = artifact.Id,
                Artifact = artifact,
                VersionNumber = 1,
                AttachmentId = Guid.NewGuid(),
                CreatedByUserId = userId,
            };
            context.Artifacts.Add(artifact);
            context.ArtifactVersions.Add(version);
            await context.SaveChangesAsync();

            var artifactAuthorization = new StubArtifactAuthorization(canViewArtifact);
            var auditAuthorization = new StubAuditAuthorization(canViewAudit);
            var service = new DbAuditClaimsEvidenceService(
                context,
                new ArtifactRepository(context),
                new ArtifactEvidenceRepository(context),
                artifactAuthorization,
                new StubFileRepository(),
                new StubFileAuthorization(),
                auditAuthorization,
                new StubCurrentUser(userId));

            return new Fixture(
                tenantId,
                userId,
                context,
                artifact,
                version,
                artifactAuthorization,
                auditAuthorization,
                service);
        }

        public ArtifactClaim AddClaim(
            bool citationPresent,
            ArtifactClaimSupportStatus supportStatus,
            params ArtifactEvidence[] evidence)
        {
            var claim = new ArtifactClaim
            {
                TenantId = TenantId,
                ArtifactVersionId = Version.Id,
                ArtifactVersion = Version,
                Ordinal = 1,
                Text = "The audited claim.",
                CitationPresent = citationPresent,
                SupportStatus = supportStatus,
                ReviewStatus = ArtifactClaimReviewStatus.Reviewed,
            };
            foreach (var item in evidence)
            {
                item.ArtifactClaimId = claim.Id;
                item.ArtifactClaim = claim;
                claim.Evidence.Add(item);
            }
            Context.Set<ArtifactClaim>().Add(claim);
            return claim;
        }

        public ValueTask DisposeAsync() => Context.DisposeAsync();
    }

    private sealed class StubCurrentTenant(Guid tenantId) : ICurrentTenant
    {
        public Guid TenantId { get; } = tenantId;
        public bool IsAvailable => true;
        public string? TenantSlug => "audit-test";
        public bool IsPlatformScope => false;
    }

    private sealed class StubCurrentUser(Guid userId) : ICurrentUser
    {
        public Guid? UserId { get; } = userId;
        public Guid? SessionId => null;
        public string? Email => "audit@example.invalid";
        public SystemRole? SystemRole => Domain.Enums.SystemRole.User;
        public bool IsAuthenticated => true;
    }

    private sealed class StubAuditAuthorization(bool canView) : IAuditAuthorizationService
    {
        public int AuthorizeCalls { get; private set; }

        public Task<AuditCapabilityResponse> GetCapabilitiesAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new AuditCapabilityResponse(canView, false, false, false, false));

        public Task<bool> HasCapabilityAsync(string capabilityKey, CancellationToken cancellationToken = default) =>
            Task.FromResult(canView);

        public Task<Result> AuthorizeAsync(
            string capabilityKey,
            string operation,
            CancellationToken cancellationToken = default)
        {
            AuthorizeCalls++;
            return Task.FromResult(canView
                ? Result.Success()
                : Result.Failure(new ApplicationErrorDetail("CapabilityDenied", "Audit operation denied.")));
        }
    }

    private sealed class StubArtifactAuthorization(bool canView) : IArtifactAuthorizationService
    {
        public int ViewCalls { get; private set; }

        public Task<bool> CanViewArtifact(Guid userId, Guid artifactId, CancellationToken cancellationToken = default)
        {
            ViewCalls++;
            return Task.FromResult(canView);
        }

        public Task<bool> CanUploadArtifact(Guid userId, Guid projectId, CancellationToken cancellationToken = default) =>
            Task.FromResult(false);

        public Task<bool> CanUpdateArtifact(Guid userId, Guid artifactId, CancellationToken cancellationToken = default) =>
            Task.FromResult(false);

        public Task<bool> CanDownloadArtifactVersion(Guid userId, Guid versionId, CancellationToken cancellationToken = default) =>
            Task.FromResult(canView);
    }

    private sealed class StubFileAuthorization : IFileAuthorizationService
    {
        public Task<bool> CanUploadAttachment(Guid userId, AttachmentOwnerType ownerType, Guid ownerId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanViewWorkspaceFiles(Guid userId, Guid workspaceId, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanViewAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> CanDownloadAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<IReadOnlySet<Guid>> GetDeletableWorkspaceAttachmentIdsAsync(Guid userId, Guid workspaceId, IReadOnlyCollection<Attachment> attachments, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlySet<Guid>>(new HashSet<Guid>());
        public Task<bool> CanDeleteAttachment(Guid userId, Attachment attachment, CancellationToken cancellationToken = default) => Task.FromResult(false);
    }

    private sealed class StubFileRepository : IFileRepository
    {
        public Task<FileObject?> GetFileObjectAsync(Guid fileObjectId, CancellationToken cancellationToken = default) => Task.FromResult<FileObject?>(null);
        public Task<PagedResponse<Attachment>> ListWorkspaceFileObjectsAsync(Guid workspaceId, int page, int pageSize, CancellationToken cancellationToken = default) => Task.FromResult(new PagedResponse<Attachment>([], page, pageSize, 0));
        public Task AddFileObjectAsync(FileObject fileObject, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<Attachment?> GetAttachmentAsync(Guid attachmentId, CancellationToken cancellationToken = default) => Task.FromResult<Attachment?>(null);
        public Task<Attachment?> GetAttachmentByFileObjectAsync(Guid fileObjectId, CancellationToken cancellationToken = default) => Task.FromResult<Attachment?>(null);
        public Task AddAttachmentAsync(Attachment attachment, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<IReadOnlyList<Attachment>> ListTaskAttachmentsAsync(Guid taskItemId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Attachment>>([]);
        public Task<PagedResponse<Attachment>> ListTaskAttachmentsPageAsync(Guid taskItemId, int page, int pageSize, CancellationToken cancellationToken = default) => Task.FromResult(new PagedResponse<Attachment>([], page, pageSize, 0));
        public void RemoveAttachment(Attachment attachment) { }
        public Task<FileOwnerContext?> ResolveOwnerAsync(AttachmentOwnerType ownerType, Guid ownerId, CancellationToken cancellationToken = default) => Task.FromResult<FileOwnerContext?>(null);
    }
}
