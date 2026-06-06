using AipPortal.Application.Common.Interfaces;

namespace AipPortal.Infrastructure.Security;

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
