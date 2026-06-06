using AipPortal.Application.Common;

namespace AipPortal.Tests;

public sealed class SkeletonTests
{
    [Fact]
    public void ResultSuccessCreatesSuccessfulResult()
    {
        var result = Result.Success();

        Assert.True(result.IsSuccess);
        Assert.Null(result.Error);
    }
}
