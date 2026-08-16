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
                    if (current == ProjectStatus.Suspended)
                    {
                        project.SuspendedFromStatus = previous;
                    }

                    if (current == ProjectStatus.Archived)
                    {
                        project.ArchivedFromStatus = previous;
                    }

                    // First activation is owned by the explicit activation
                    // command. A generic Planning -> Active write is valid only
                    // when that same unit of work has already established the
                    // canonical Activated provenance.
                    if (previous == ProjectStatus.Planning &&
                        current == ProjectStatus.Active &&
                        !HasActivatedProvenance(project))
                    {
                        throw new InvalidOperationException(
                            "Planning to Active requires canonical activation provenance.");
                    }

                    // Unknown historical provenance can never be converted into
                    // a resume/restore decision by guessing a prior state.
                    if (project.ActivationState == ProjectActivationState.LegacyUnknown &&
                        ((previous == ProjectStatus.Suspended && current != ProjectStatus.Archived) ||
                         previous == ProjectStatus.Archived))
                    {
                        throw new InvalidOperationException(
                            "LegacyUnknown Project provenance cannot be resumed or restored implicitly.");
                    }
                }
            }

            ValidateActivationProvenance(project);
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
