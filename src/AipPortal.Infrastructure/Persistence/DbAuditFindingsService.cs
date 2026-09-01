using AipPortal.Application.Audit;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Tenancy;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

public sealed class DbAuditFindingsService(
    AppDbContext dbContext,
    IAuditClaimsEvidenceService claimsEvidence,
    IAuditAuthorizationService auditAuthorization,
    ICurrentUser currentUser,
    IAuditLogger auditLogger,
    IUnitOfWork unitOfWork) : IAuditFindingsService
{
    private const int MaxFindings = 200;
    private const int MaxHistoryPerFinding = 50;
    private const int MaxEligibleOwners = 500;
    private const int MaxReasonLength = 1000;

    public async Task<Result<AuditFindingsResponse>> ListAsync(
        AuditFindingsQuery query,
        CancellationToken cancellationToken = default)
    {
        if (query.ArtifactVersionId == Guid.Empty)
        {
            return Failure<AuditFindingsResponse>("ValidationFailed", "Artifact version ID is required.");
        }

        if (!TryOptionalEnum(query.Status, out AuditFindingTriageStatus? status))
        {
            return Failure<AuditFindingsResponse>("ValidationFailed", "Finding status is invalid.");
        }

        if (!TryOptionalEnum(query.Severity, out AuditFindingSeverity? severity))
        {
            return Failure<AuditFindingsResponse>("ValidationFailed", "Finding severity is invalid.");
        }

        var claimsResult = await claimsEvidence.GetAsync(query.ArtifactVersionId, cancellationToken);
        if (!claimsResult.IsSuccess || claimsResult.Value is null)
        {
            return ForwardFailure<AuditClaimsEvidenceResponse, AuditFindingsResponse>(claimsResult);
        }

        var capabilities = await auditAuthorization.GetCapabilitiesAsync(cancellationToken);
        var claimMap = claimsResult.Value.Claims.ToDictionary(claim => claim.ClaimId);
        if (claimMap.Count == 0)
        {
            return Result<AuditFindingsResponse>.Success(new AuditFindingsResponse(
                claimsResult.Value.ArtifactId,
                claimsResult.Value.ArtifactVersionId,
                claimsResult.Value.ArtifactVersionNumber,
                claimsResult.Value.ArtifactTitle,
                capabilities.CanReview,
                Array.Empty<AuditFindingOwnerResponse>(),
                Array.Empty<AuditFindingResponse>()));
        }

        var claimIds = claimMap.Keys.ToArray();
        IQueryable<ArtifactFinding> findingsQuery = dbContext.Set<ArtifactFinding>()
            .AsNoTracking()
            .Include(finding => finding.History)
            .Where(finding =>
                claimIds.Contains(finding.ArtifactClaimId) &&
                dbContext.Set<ArtifactClaim>().Any(claim =>
                    claim.Id == finding.ArtifactClaimId &&
                    claim.TenantId == finding.TenantId));

        if (status.HasValue)
        {
            findingsQuery = findingsQuery.Where(finding => finding.Status == status.Value);
        }
        if (severity.HasValue)
        {
            findingsQuery = findingsQuery.Where(finding => finding.Severity == severity.Value);
        }
        if (query.OpenOnly)
        {
            findingsQuery = findingsQuery.Where(finding =>
                finding.Status == AuditFindingTriageStatus.Open ||
                finding.Status == AuditFindingTriageStatus.Reviewing);
        }

        var findings = await findingsQuery
            .OrderBy(finding =>
                finding.Status == AuditFindingTriageStatus.Open || finding.Status == AuditFindingTriageStatus.Reviewing
                    ? 0
                    : 1)
            .ThenBy(finding =>
                finding.Severity == AuditFindingSeverity.Critical ? 0 :
                finding.Severity == AuditFindingSeverity.High ? 1 :
                finding.Severity == AuditFindingSeverity.Medium ? 2 : 3)
            .ThenByDescending(finding => finding.ConfidencePercent)
            .ThenBy(finding => finding.CreatedAt)
            .Take(MaxFindings)
            .ToListAsync(cancellationToken);

        var ownerNames = await LoadOwnerNamesAsync(findings, cancellationToken);
        var eligibleOwners = capabilities.CanReview
            ? await LoadEligibleOwnersAsync(findings, cancellationToken)
            : Array.Empty<AuditFindingOwnerResponse>();
        var response = findings.Select(finding =>
        {
            var claim = claimMap[finding.ArtifactClaimId];
            var firstEvidence = claim.Evidence.OrderBy(item => item.Ordinal).FirstOrDefault();
            return new AuditFindingResponse(
                finding.Id,
                finding.ArtifactClaimId,
                claim.Ordinal,
                claim.Text,
                finding.Severity.ToString(),
                finding.ConfidencePercent,
                finding.DetectorKey,
                finding.PolicyVersion,
                finding.Status.ToString(),
                finding.OwnerUserId,
                finding.OwnerUserId.HasValue && ownerNames.TryGetValue(finding.OwnerUserId.Value, out var ownerName)
                    ? ownerName
                    : null,
                finding.ResolutionReason,
                finding.CreatedAt,
                finding.UpdatedAt,
                firstEvidence?.EvidenceId,
                firstEvidence?.SourceEventAuditId,
                finding.History
                    .OrderByDescending(item => item.CreatedAt)
                    .Take(MaxHistoryPerFinding)
                    .Select(item => new AuditFindingHistoryResponse(
                        item.FromStatus?.ToString(),
                        item.ToStatus.ToString(),
                        item.Reason,
                        item.CreatedAt))
                    .ToList());
        }).ToList();

        return Result<AuditFindingsResponse>.Success(new AuditFindingsResponse(
            claimsResult.Value.ArtifactId,
            claimsResult.Value.ArtifactVersionId,
            claimsResult.Value.ArtifactVersionNumber,
            claimsResult.Value.ArtifactTitle,
            capabilities.CanReview,
            eligibleOwners,
            response));
    }

    public async Task<Result> UpdateTriageAsync(
        Guid findingId,
        UpdateAuditFindingTriageRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!currentUser.IsAuthenticated || !currentUser.UserId.HasValue)
        {
            return Result.Failure(new ApplicationErrorDetail("AuthenticationRequired", "Authentication is required."));
        }

        var reviewAuthorization = await auditAuthorization.AuthorizeAsync(
            CapabilityKeys.AuditReview,
            "audit.findings.triage",
            cancellationToken);
        if (!reviewAuthorization.IsSuccess)
        {
            return reviewAuthorization;
        }

        if (findingId == Guid.Empty ||
            !Enum.TryParse<AuditFindingTriageStatus>(request.Status?.Trim(), ignoreCase: true, out var nextStatus) ||
            !Enum.IsDefined(nextStatus))
        {
            return Result.Failure(new ApplicationErrorDetail("ValidationFailed", "Finding status is invalid."));
        }

        var finding = await dbContext.Set<ArtifactFinding>()
            .Include(item => item.ArtifactClaim)
            .SingleOrDefaultAsync(item => item.Id == findingId, cancellationToken);
        if (finding?.ArtifactClaim is null || finding.ArtifactClaim.TenantId != finding.TenantId)
        {
            return FindingNotFound();
        }

        var claimsResult = await claimsEvidence.GetAsync(finding.ArtifactClaim.ArtifactVersionId, cancellationToken);
        if (!claimsResult.IsSuccess || claimsResult.Value is null ||
            !claimsResult.Value.Claims.Any(claim => claim.ClaimId == finding.ArtifactClaimId))
        {
            if (claimsResult.ErrorDetail?.Code is "AuthenticationRequired" or "CapabilityDenied" or "TenantMembershipRequired")
            {
                return claimsResult.ErrorDetail is not null
                    ? Result.Failure(claimsResult.ErrorDetail)
                    : Result.Failure(claimsResult.Error ?? "Audit view is not permitted.");
            }
            return FindingNotFound();
        }

        var normalizedReason = NormalizeOptional(request.Reason);
        if (normalizedReason?.Length > MaxReasonLength)
        {
            return Result.Failure(new ApplicationErrorDetail(
                "ValidationFailed",
                $"Finding reason must be at most {MaxReasonLength} characters."));
        }

        var statusChanged = finding.Status != nextStatus;
        var requiresReason = statusChanged &&
            nextStatus is AuditFindingTriageStatus.AcceptedRisk or AuditFindingTriageStatus.FalsePositive;
        if (requiresReason && normalizedReason is null)
        {
            return Result.Failure(new ApplicationErrorDetail(
                "ReasonRequired",
                "Accepted Risk and False Positive transitions require a reason."));
        }

        var nextOwner = finding.OwnerUserId;
        if (request.AssignOwner)
        {
            if (request.OwnerUserId.HasValue &&
                !await IsEligibleOwnerAsync(finding.TenantId, request.OwnerUserId.Value, cancellationToken))
            {
                return Result.Failure(new ApplicationErrorDetail(
                    "OwnerNotEligible",
                    "The selected finding owner is not available in the current tenant."));
            }
            nextOwner = request.OwnerUserId;
        }

        var nextReason = statusChanged
            ? nextStatus is AuditFindingTriageStatus.Open or AuditFindingTriageStatus.Reviewing
                ? null
                : normalizedReason
            : finding.ResolutionReason;
        var ownerChanged = nextOwner != finding.OwnerUserId;

        if (!statusChanged && !ownerChanged)
        {
            return Result.Success();
        }

        var userId = currentUser.UserId.Value;
        var previousStatus = finding.Status;
        finding.Status = nextStatus;
        finding.OwnerUserId = nextOwner;
        finding.ResolutionReason = nextReason;
        dbContext.Set<AuditFindingHistory>().Add(new AuditFindingHistory
        {
            TenantId = finding.TenantId,
            ArtifactFindingId = finding.Id,
            FromStatus = previousStatus,
            ToStatus = nextStatus,
            OwnerUserId = nextOwner,
            Reason = statusChanged ? normalizedReason : null,
            ChangedByUserId = userId,
            Finding = finding
        });

        await auditLogger.LogAsync(new AuditLogEntry(
            userId,
            "AuditFindingTriageChanged",
            "ArtifactFinding",
            finding.Id,
            "Audit finding triage state changed.",
            TenantId: finding.TenantId,
            Metadata: new Dictionary<string, object?>
            {
                ["fromStatus"] = previousStatus.ToString(),
                ["toStatus"] = nextStatus.ToString(),
                ["ownerChanged"] = ownerChanged,
                ["ownerAssigned"] = nextOwner.HasValue
            }), cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task<Dictionary<Guid, string>> LoadOwnerNamesAsync(
        IReadOnlyList<ArtifactFinding> findings,
        CancellationToken cancellationToken)
    {
        var ownerIds = findings
            .Where(finding => finding.OwnerUserId.HasValue)
            .Select(finding => finding.OwnerUserId!.Value)
            .Distinct()
            .ToArray();
        if (ownerIds.Length == 0 || findings.Count == 0)
        {
            return new Dictionary<Guid, string>();
        }

        var tenantId = findings[0].TenantId;
        var tenantOwnerIds = await dbContext.TenantUsers
            .AsNoTracking()
            .Where(link =>
                link.TenantId == tenantId &&
                link.Status == TenantUserStatus.Active &&
                ownerIds.Contains(link.UserId))
            .Select(link => link.UserId)
            .Distinct()
            .ToListAsync(cancellationToken);
        if (tenantOwnerIds.Count == 0)
        {
            return new Dictionary<Guid, string>();
        }

        return await dbContext.Users
            .AsNoTracking()
            .Where(user => tenantOwnerIds.Contains(user.Id))
            .Select(user => new { user.Id, user.DisplayName })
            .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);
    }

    private async Task<IReadOnlyList<AuditFindingOwnerResponse>> LoadEligibleOwnersAsync(
        IReadOnlyList<ArtifactFinding> findings,
        CancellationToken cancellationToken)
    {
        if (findings.Count == 0)
        {
            return Array.Empty<AuditFindingOwnerResponse>();
        }

        var tenantId = findings[0].TenantId;
        return await dbContext.TenantUsers
            .AsNoTracking()
            .Where(link => link.TenantId == tenantId && link.Status == TenantUserStatus.Active)
            .Join(
                dbContext.Users.AsNoTracking().Where(user => user.Status == UserStatus.Active && user.DeletedAt == null),
                link => link.UserId,
                user => user.Id,
                (link, user) => new AuditFindingOwnerResponse(user.Id, user.DisplayName))
            .Distinct()
            .OrderBy(owner => owner.DisplayName)
            .ThenBy(owner => owner.UserId)
            .Take(MaxEligibleOwners)
            .ToListAsync(cancellationToken);
    }

    private async Task<bool> IsEligibleOwnerAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken) =>
        await dbContext.TenantUsers
            .AsNoTracking()
            .AnyAsync(link =>
                link.TenantId == tenantId &&
                link.UserId == userId &&
                link.Status == TenantUserStatus.Active &&
                dbContext.Users.Any(user =>
                    user.Id == link.UserId &&
                    user.Status == UserStatus.Active &&
                    user.DeletedAt == null),
                cancellationToken);

    private static bool TryOptionalEnum<TEnum>(string? value, out TEnum? parsed)
        where TEnum : struct, Enum
    {
        parsed = null;
        if (string.IsNullOrWhiteSpace(value))
        {
            return true;
        }

        if (!Enum.TryParse<TEnum>(value.Trim(), ignoreCase: true, out var candidate) || !Enum.IsDefined(candidate))
        {
            return false;
        }

        parsed = candidate;
        return true;
    }

    private static string? NormalizeOptional(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private static Result FindingNotFound() =>
        Result.Failure(new ApplicationErrorDetail("FindingNotFound", "The finding is not available."));

    private static Result<T> Failure<T>(string code, string message) =>
        Result<T>.Failure(new ApplicationErrorDetail(code, message));

    private static Result<TOut> ForwardFailure<TIn, TOut>(Result<TIn> result) =>
        result.ErrorDetail is not null
            ? Result<TOut>.Failure(result.ErrorDetail)
            : Result<TOut>.Failure(result.Error ?? "The requested Audit operation failed.");
}
