using AipPortal.Application.Projects;
using AipPortal.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AipPortal.Infrastructure.Persistence;

/// <summary>
/// Production WPC-DEC-033 configured-source adapter.
/// Workspace selection has precedence over Tenant selection. A configured
/// identity that cannot be resolved is returned as an incompatible sentinel so
/// activation fails closed instead of silently falling through to a lower source.
/// </summary>
public sealed class ConfiguredProjectTaskWorkflowSource(AppDbContext dbContext)
    : IConfiguredProjectTaskWorkflowSource
{
    public async Task<ProjectActivationTaskWorkflow?> FindWorkspaceTemplateAsync(
        Project project,
        CancellationToken cancellationToken = default)
    {
        if (project.TenantId == Guid.Empty || project.WorkspaceId == Guid.Empty)
        {
            return Invalid("WorkspaceConfigured", Guid.Empty);
        }

        var templateId = await dbContext.Workspaces
            .AsNoTracking()
            .Where(workspace =>
                workspace.Id == project.WorkspaceId &&
                workspace.TenantId == project.TenantId)
            .Select(workspace => workspace.DefaultTaskWorkflowTemplateId)
            .SingleOrDefaultAsync(cancellationToken);

        return templateId.HasValue
            ? await LoadTemplateAsync(
                project.TenantId,
                templateId.Value,
                "WorkspaceConfigured",
                cancellationToken)
            : null;
    }

    public async Task<ProjectActivationTaskWorkflow?> FindTenantDefaultAsync(
        Project project,
        CancellationToken cancellationToken = default)
    {
        if (project.TenantId == Guid.Empty)
        {
            return Invalid("TenantDefault", Guid.Empty);
        }

        var templateId = await dbContext.TenantSettings
            .AsNoTracking()
            .Where(settings => settings.TenantId == project.TenantId)
            .Select(settings => settings.DefaultTaskWorkflowTemplateId)
            .SingleOrDefaultAsync(cancellationToken);

        return templateId.HasValue
            ? await LoadTemplateAsync(
                project.TenantId,
                templateId.Value,
                "TenantDefault",
                cancellationToken)
            : null;
    }

    private async Task<ProjectActivationTaskWorkflow> LoadTemplateAsync(
        Guid tenantId,
        Guid templateId,
        string sourceKind,
        CancellationToken cancellationToken)
    {
        var template = await dbContext.Set<TaskWorkflowTemplate>()
            .AsNoTracking()
            .Include(item => item.Stages)
            .SingleOrDefaultAsync(
                item => item.Id == templateId && item.TenantId == tenantId,
                cancellationToken);

        if (template is null)
        {
            return Invalid(sourceKind, templateId);
        }

        return new ProjectActivationTaskWorkflow(
            $"TaskWorkflowTemplate/{template.Id:D}/v{template.VersionNo}",
            template.Name,
            template.ReviewEnforcementEnabled,
            template.Stages
                .OrderBy(stage => stage.SortKey)
                .ThenBy(stage => stage.Id)
                .Select(stage => new ProjectActivationTaskWorkflowStage(
                    stage.Name,
                    stage.InternalCategory,
                    stage.SortKey,
                    stage.WipWarningLimit,
                    stage.IsInitialStage,
                    stage.IsTerminalStage))
                .ToArray());
    }

    private static ProjectActivationTaskWorkflow Invalid(string sourceKind, Guid templateId) =>
        new(
            $"TaskWorkflowTemplate/{templateId:D}/invalid",
            sourceKind,
            ReviewEnforcementEnabled: true,
            Array.Empty<ProjectActivationTaskWorkflowStage>());
}
