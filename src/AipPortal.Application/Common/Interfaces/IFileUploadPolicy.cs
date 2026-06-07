namespace AipPortal.Application.Common.Interfaces;

public interface IFileUploadPolicy
{
    long MaxFileSizeBytes { get; }

    IReadOnlyCollection<string> AllowedExtensions { get; }

    IReadOnlyCollection<string> AllowedContentTypes { get; }
}
