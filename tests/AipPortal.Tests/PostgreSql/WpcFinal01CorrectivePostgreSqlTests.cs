namespace AipPortal.Tests.PostgreSql;

/// <summary>
/// Compatibility names retained in the worker manifests that were introduced
/// during the first Final01 corrective pass. The authoritative cross-worker
/// evidence now lives in WpcFinal01CanonicalCompletionPostgreSqlTests.
/// </summary>
public sealed class WpcFinal01CorrectivePostgreSqlTests
{
    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02A")]
    public Task LegacyUnknownVisibilityClassificationIsAuthorizedAuditedAndConcurrencyControlled() =>
        new WpcFinal01CanonicalCompletionPostgreSqlTests()
            .LegacyUnknownVisibilityCanBeExplicitlyClassifiedThenActivated();

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02A")]
    public async Task NonDefaultVisibilityMutationRequiresWorkspaceGovernanceOrVisibilityCapability()
    {
        await new Wpc02CCanonicalProjectCreatePostgreSqlTests()
            .DelegatedProjectCreateDoesNotImplyVisibilityManagement();
        await new WpcFinal01CanonicalCompletionPostgreSqlTests()
            .ProjectCreateGrantDoesNotAuthorizeVisibilityChange();
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02A")]
    public Task ArchivedProjectMembershipMutationFailsClosedWithoutCommit() =>
        new WpcFinal01CanonicalCompletionPostgreSqlTests()
            .ArchivedProjectRejectsAddUpdateAndRemoveMemberWithoutSideEffects();

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02D")]
    public async Task ProjectGeneralMembershipTracksRoleAndRemovalWithoutStalePostingRights()
    {
        await new WpcFinal01CanonicalCompletionPostgreSqlTests()
            .ProjectMemberViewerDowngradeRemovesProjectGeneralPostRights();
        await new WpcFinal01CanonicalCompletionPostgreSqlTests()
            .WorkspaceVisibleProjectMemberRemovalKeepsBroadReadButRevokesParticipantRights();
    }

    [PostgreSqlFact]
    [Trait("Category", "PostgreSQLIntegration")]
    [Trait("Scope", "WPC02F")]
    public async Task TaskNotificationAndRealtimeUseCanonicalProjectVisibilityAuthorization()
    {
        await new WpcFinal01CanonicalCompletionPostgreSqlTests()
            .MembersOnlyProjectMemberRemovalRevokesConversationAndTaskNotificationAccess();
        await new WpcFinal01CanonicalCompletionPostgreSqlTests()
            .ProjectRealtimeResolverUsesCanonicalVisibilityScope();
    }
}
