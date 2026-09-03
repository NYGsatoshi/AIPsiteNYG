using AipPortal.Application.Common;

namespace AipPortal.Application.Audit;

public interface IAuditFindingReviewerMentionsService
{
    Task<Result> MentionAsync(
        Guid findingId,
        MentionAuditFindingReviewerRequest request,
        CancellationToken cancellationToken = default);
}
