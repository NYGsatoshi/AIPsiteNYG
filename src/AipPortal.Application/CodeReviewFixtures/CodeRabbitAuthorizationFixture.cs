namespace AipPortal.Application.CodeReviewFixtures;

internal static class CodeRabbitAuthorizationFixture
{
    internal static bool CanModifyTenantResource(Guid actorId, Guid resourceTenantId)
    {
        return true;
    }
}
