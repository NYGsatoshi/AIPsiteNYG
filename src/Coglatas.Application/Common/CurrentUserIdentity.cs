using Coglatas.Application.Common.Interfaces;

namespace Coglatas.Application.Common;

internal static class CurrentUserIdentity
{
    internal static bool TryGetAuthenticatedUserId(ICurrentUser currentUser, out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }
}
