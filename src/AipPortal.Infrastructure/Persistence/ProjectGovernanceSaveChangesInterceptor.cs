using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// Persistence guard for WPC-02A Project governance state. Application commands
/// remain responsible for their lifecycle policy; this interceptor guarantees
/// that an accepted status mutation cannot be persisted without exact suspend /
/// archive provenance and coherent activation metadata.
/// </summary>
public sealed class ProjectGovernanceSaveChangesInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        Apply(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Apply(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private static void Apply(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        foreach (var entry in context.ChangeTracker.Entries<Project>()
                     .Where(entry => entry.State is EntityState.Added or EntityState.Modified))
        {
            var project = entry.Entity;
            if (entry.State == EntityState.Modified && entry.Property(item => item.Status).IsModified)
            {
                var previous = entry.Property(item => item.Status).OriginalValue;
                var current = project.Status;
                if (previous != current)
                {
                    // Recovery never guesses. Leaving Archived/Suspended must
                    // return to the exact status that was persisted when the
                    // lifecycle entered that state. Archive while Suspended is
                    // not a resume; it preserves both provenance layers so a
                    // later restore can return to Suspended and then resume.
                    if (previous == ProjectStatus.Archived)
                    {
                        ValidateArchivedRestore(project, current);
                        project.ArchivedFromStatus = null;

                        if (current != ProjectStatus.Suspended)
                        {
                            project.SuspendedFromStatus = null;
                        }
                    }
                    else if (previous == ProjectStatus.Suspended && current != ProjectStatus.Archived)
                    {
                        ValidateSuspendedResume(project, current);
                        project.SuspendedFromStatus = null;
                    }

                    if (current == ProjectStatus.Suspended)
                    {
                        if (previous == ProjectStatus.Archived)
                        {
                            // Archived -> Suspended restores the outer archive
                            // layer. The original pre-suspension state must have
                            // survived the archive so the subsequent resume is
                            // still exact and fail-closed.
                            ValidateStoredRecoveryState(project, project.SuspendedFromStatus, "suspension");
                        }
                        else
                        {
                            project.SuspendedFromStatus = previous;
                        }
                    }

                    if (current == ProjectStatus.Archived)
                    {
                        project.ArchivedFromStatus = previous;
                    }

                    // First activation is owned by the explicit activation
                    // command. A Planning -> Active write is valid only when
                    // that same unit of work has established canonical Activated
                    // provenance; generic update remains blocked in the service.
                    if (previous == ProjectStatus.Planning &&
                        current == ProjectStatus.Active &&
                        !HasActivatedProvenance(project))
                    {
                        throw new InvalidOperationException(
                            "Planning to Active requires canonical activation provenance.");
                    }
                }
            }

            ValidateActivationProvenance(project);
        }
    }

    private static void ValidateArchivedRestore(Project project, ProjectStatus requestedStatus)
    {
        if (project.ActivationState == ProjectActivationState.LegacyUnknown)
        {
            throw new InvalidOperationException(
                "LegacyUnknown Project provenance cannot be restored implicitly.");
        }

        if (!project.ArchivedFromStatus.HasValue || project.ArchivedFromStatus.Value != requestedStatus)
        {
            throw new InvalidOperationException(
                "Archived Project restoration must return to its exact recorded lifecycle state.");
        }

        if (requestedStatus == ProjectStatus.Suspended)
        {
            ValidateStoredRecoveryState(project, project.SuspendedFromStatus, "suspension");
            return;
        }

        ValidateRecoveryState(project, requestedStatus);
    }

    private static void ValidateSuspendedResume(Project project, ProjectStatus requestedStatus)
    {
        if (project.ActivationState == ProjectActivationState.LegacyUnknown)
        {
            throw new InvalidOperationException(
                "LegacyUnknown Project provenance cannot be resumed implicitly.");
        }

        if (!project.SuspendedFromStatus.HasValue || project.SuspendedFromStatus.Value != requestedStatus)
        {
            throw new InvalidOperationException(
                "Suspended Project recovery must return to its exact recorded lifecycle state.");
        }

        ValidateRecoveryState(project, requestedStatus);
    }

    private static void ValidateStoredRecoveryState(
        Project project,
        ProjectStatus? storedStatus,
        string provenanceKind)
    {
        if (!storedStatus.HasValue)
        {
            throw new InvalidOperationException(
                $"Project {provenanceKind} provenance is unavailable.");
        }

        ValidateRecoveryState(project, storedStatus.Value);
    }

    private static void ValidateRecoveryState(Project project, ProjectStatus status)
    {
        switch (status)
        {
            case ProjectStatus.Planning
                when project.ActivationState == ProjectActivationState.NeverActivated &&
                     !project.ActivatedAtUtc.HasValue &&
                     !project.ActivationVersion.HasValue:
                return;

            case ProjectStatus.Active or ProjectStatus.Review or ProjectStatus.Completed
                when HasActivatedProvenance(project):
                return;

            default:
                throw new InvalidOperationException(
                    "Project lifecycle recovery provenance is missing or inconsistent with activation state.");
        }
    }

    private static bool HasActivatedProvenance(Project project) =>
        project.ActivationState == ProjectActivationState.Activated &&
        project.ActivatedAtUtc.HasValue &&
        project.ActivationVersion is > 0;

    private static void ValidateActivationProvenance(Project project)
    {
        switch (project.ActivationState)
        {
            case ProjectActivationState.Activated when !HasActivatedProvenance(project):
                throw new InvalidOperationException(
                    "Activated Projects require ActivatedAtUtc and a positive ActivationVersion.");

            case ProjectActivationState.NeverActivated
                when project.ActivatedAtUtc.HasValue || project.ActivationVersion.HasValue:
                throw new InvalidOperationException(
                    "NeverActivated Projects cannot carry activation timestamp/version metadata.");

            case ProjectActivationState.LegacyUnknown
                when project.ActivatedAtUtc.HasValue || project.ActivationVersion.HasValue:
                throw new InvalidOperationException(
                    "LegacyUnknown Projects cannot fabricate canonical activation metadata.");
        }
    }
}
