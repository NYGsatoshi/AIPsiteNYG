using AipPortal.Application.Common;

namespace AipPortal.Application.Announcements;

public interface IAnnouncementAudienceService
{
    Task<Result<IReadOnlyList<AnnouncementAudienceOptionResponse>>> ListAsync(CancellationToken cancellationToken = default);

    Task<Result<bool>> IsAuthorizedAsync(
        Guid? workspaceId,
        Guid? groupId,
        Guid? channelId,
        CancellationToken cancellationToken = default);
}
