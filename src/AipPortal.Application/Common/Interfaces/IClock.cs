namespace AipPortal.Application.Common.Interfaces;

public interface IClock
{
    DateTimeOffset UtcNow { get; }
}
