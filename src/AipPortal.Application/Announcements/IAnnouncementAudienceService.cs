using AipPortal.Application.Common;

namespace AipPortal.Application.Announcements;

public interface IAnnouncementAudienceService
{
    Task<Result<IReadOnlyList<AnnouncementAudienceOptionResponse>>> ListAsync(CancellationToken cancellationToken = default);
}
