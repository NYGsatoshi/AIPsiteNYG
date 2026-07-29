using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Realtime;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Projects;

public sealed class ProjectService(
    IProjectRepository projects,
    IWorkspaceRepository workspaces,
    IGroupRepository groups,
    IUserRepository users,
    IProjectAuthorizationService projectAuthorization,
    ITaskAuthorizationService taskAuthorization,
    ICommentAuthorizationService commentAuthorization,
    ICurrentUser currentUser,
    IClock clock,
    IAuditLogger auditLogger,
    INotificationService notifications,
    IBusinessInvalidationPublisher invalidations,
    IAuthorizationStateChangePublisher authorizationChanges,
    IUnitOfWork unitOfWork,
    ITaskCommandUnitOfWork taskUnitOfWork,
    IFeatureFlagService? featureFlags = null,
    ITaskWorkspaceTimeZoneResolver? timeZones = null) : IProjectService
{
    private Task<bool>? taskDomainV1Enabled;
    public async Task<Result<PagedResponse<ProjectResponse>>> ListAsync(ProjectListQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId))
        {
            return Result<PagedResponse<ProjectResponse>>.Failure("Authentication is required.");
        }

        var items = await projects.ListVisibleAsync(userId, cancellationToken);
        var filtered = items
            .Where(project => !project.DeletedAt.HasValue)
            .Where(project => query.Archived ? project.Status == ProjectStatus.Archived : project.Status is not ProjectStatus.Archived and not ProjectStatus.Deleted)
            .Where(project => !query.Status.HasValue || project.Status == query.Status.Value)
            .Where(project => MatchesSearch(project.Name, project.Description, query.Search))
            .ToList();

        var responses = new List<ProjectResponse>(filtered.Count);
        foreach (var project in filtered)
        {
            responses.Add(await ToProjectAsync(project, userId, cancellationToken));
        }

        return Result<PagedResponse<ProjectResponse>>.Success(ToPagedResponse(responses, query.SafePage, query.SafePageSize));
    }

    public async Task<Result<ProjectResponse>> CreateAsync(CreateProjectRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) ||
            !await projectAuthorization.CanCreateProject(userId, request.WorkspaceId, request.GroupId, cancellationToken))
        {
            return Result<ProjectResponse>.Failure("You are not allowed to create projects.");
        }

        var validation = await ValidateProjectParentAsync(request.WorkspaceId, request.GroupId, cancellationToken);
        if (!validation.IsSuccess)
        {
            return Result<ProjectResponse>.Failure(validation.Error!);
        }

        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return Result<ProjectResponse>.Failure("Project title is required.");
        }

        if (HasInvalidDateRange(request.StartDate, request.EndDate))
        {
            return Result<ProjectResponse>.Failure("Project end date cannot be before the start date.");
        }

        var project = new Project
        {
            WorkspaceId = request.WorkspaceId,
            GroupId = request.GroupId,
            OwnerUserId = userId,
            CreatedByUserId = userId,
            Name = request.Title.Trim(),
            Slug = SlugGenerator.FromName(request.Title),
            Description = request.Description?.Trim(),
            Status = ProjectStatus.Planning,
            StartDate = request.StartDate,
            DueDate = request.EndDate
        };

        await projects.AddProjectAsync(project, cancellationToken);
        await projects.AddMemberAsync(new ProjectMember
        {
            ProjectId = project.Id,
            UserId = userId,
            Role = ProjectRole.Owner,
            JoinedAt = clock.UtcNow
        }, cancellationToken);
        await AuditAsync(userId, "ProjectCreated", "Project", project.Id, cancellationToken);
        await invalidations.ProjectChangedAsync(project, userId, "created", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ProjectResponse>.Success(await ToProjectAsync(project, userId, cancellationToken));
    }

    public async Task<Result<ProjectResponse>> GetAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, projectId, cancellationToken))
        {
            return Result<ProjectResponse>.Failure("Project not found.");
        }

        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        return project is null || project.DeletedAt.HasValue
            ? Result<ProjectResponse>.Failure("Project not found.")
            : Result<ProjectResponse>.Success(await ToProjectAsync(project, userId, cancellationToken));
    }

    public async Task<Result<ProjectResponse>> UpdateAsync(Guid projectId, UpdateProjectRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanManageProject(userId, projectId, cancellationToken))
        {
            return Result<ProjectResponse>.Failure("You are not allowed to manage this project.");
        }

        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is null || project.DeletedAt.HasValue)
        {
            return Result<ProjectResponse>.Failure("Project not found.");
        }

        var startDate = request.StartDate ?? project.StartDate;
        var endDate = request.EndDate ?? project.DueDate;
        if (HasInvalidDateRange(startDate, endDate))
        {
            return Result<ProjectResponse>.Failure("Project end date cannot be before the start date.");
        }

        if (request.Title is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Result<ProjectResponse>.Failure("Project title is required.");
            }

            project.Name = request.Title.Trim();
            project.Slug = SlugGenerator.FromName(project.Name);
        }

        var previousStatus = project.Status;
        var nextStatus = request.Status ?? project.Status;
        if (!IsValidProjectStatusTransition(previousStatus, nextStatus))
        {
            return Result<ProjectResponse>.Failure($"Project status cannot transition from {previousStatus} to {nextStatus}.");
        }

        project.Description = request.Description?.Trim() ?? project.Description;
        project.Status = nextStatus;
        project.StartDate = request.StartDate ?? project.StartDate;
        project.DueDate = request.EndDate ?? project.DueDate;
        await AuditAsync(userId, project.Status == previousStatus ? "ProjectUpdated" : "ProjectStatusChanged", "Project", project.Id, cancellationToken);
        await invalidations.ProjectChangedAsync(project, userId, "updated", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ProjectResponse>.Success(await ToProjectAsync(project, userId, cancellationToken));
    }

    public async Task<Result> ArchiveAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanManageProject(userId, projectId, cancellationToken))
        {
            return Result.Failure("You are not allowed to manage this project.");
        }

        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is null)
        {
            return Result.Failure("Project not found.");
        }

        project.Status = ProjectStatus.Archived;
        await AuditAsync(userId, "ProjectArchived", "Project", project.Id, cancellationToken);
        await invalidations.ProjectChangedAsync(project, userId, "archived", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> RestoreAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanManageProject(userId, projectId, cancellationToken))
        {
            return Result.Failure("You are not allowed to manage this project.");
        }

        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is null)
        {
            return Result.Failure("Project not found.");
        }

        project.Restore();
        if (project.Status is ProjectStatus.Archived or ProjectStatus.Deleted)
        {
            project.Status = ProjectStatus.Active;
        }

        await AuditAsync(userId, "ProjectRestored", "Project", project.Id, cancellationToken);
        await invalidations.ProjectChangedAsync(project, userId, "restored", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<ProjectMemberResponse>>> ListMembersAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, projectId, cancellationToken))
        {
            return Result<IReadOnlyList<ProjectMemberResponse>>.Failure("Project not found.");
        }

        var members = await projects.ListMembersAsync(projectId, cancellationToken);
        return Result<IReadOnlyList<ProjectMemberResponse>>.Success(members.Select(ToProjectMember).ToList());
    }

    public async Task<Result<ProjectMemberResponse>> AddMemberAsync(Guid projectId, AddProjectMemberRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var actorUserId) || !await projectAuthorization.CanManageProject(actorUserId, projectId, cancellationToken))
        {
            return Result<ProjectMemberResponse>.Failure("You are not allowed to manage project members.");
        }

        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        var user = await users.GetByIdAsync(request.UserId, cancellationToken);
        if (project is null || user is null)
        {
            return Result<ProjectMemberResponse>.Failure("Project or user not found.");
        }

        var access = await ValidateParentAccessAsync(project, request.UserId, cancellationToken);
        if (!access.IsSuccess)
        {
            return Result<ProjectMemberResponse>.Failure(access.Error!);
        }

        if (await projects.GetMemberAsync(projectId, request.UserId, cancellationToken) is not null)
        {
            return Result<ProjectMemberResponse>.Failure("User is already a project member.");
        }

        var member = new ProjectMember
        {
            ProjectId = projectId,
            UserId = request.UserId,
            User = user,
            Role = request.Role,
            JoinedAt = clock.UtcNow
        };

        await projects.AddMemberAsync(member, cancellationToken);
        await AuditAsync(actorUserId, "ProjectMemberAdded", "Project", projectId, cancellationToken);
        await invalidations.ProjectChangedAsync(project, actorUserId, "memberChanged", cancellationToken);
        await authorizationChanges.PublishAsync(project.TenantId, request.UserId, "project", project.Id, "membershipChanged", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ProjectMemberResponse>.Success(ToProjectMember(member));
    }

    public async Task<Result<ProjectMemberResponse>> UpdateMemberAsync(Guid projectId, Guid userId, UpdateProjectMemberRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var actorUserId) || !await projectAuthorization.CanManageProject(actorUserId, projectId, cancellationToken))
        {
            return Result<ProjectMemberResponse>.Failure("You are not allowed to manage project members.");
        }

        var member = await projects.GetMemberAsync(projectId, userId, cancellationToken);
        if (member is null)
        {
            return Result<ProjectMemberResponse>.Failure("Project member not found.");
        }

        member.Role = request.Role;
        await AuditAsync(actorUserId, "ProjectMemberUpdated", "Project", projectId, cancellationToken);
        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is not null)
        {
            await invalidations.ProjectChangedAsync(project, actorUserId, "memberChanged", cancellationToken);
            await authorizationChanges.PublishAsync(project.TenantId, userId, "project", project.Id, "membershipChanged", cancellationToken);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<ProjectMemberResponse>.Success(ToProjectMember(member));
    }

    public async Task<Result> RemoveMemberAsync(Guid projectId, Guid userId, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var actorUserId) || !await projectAuthorization.CanManageProject(actorUserId, projectId, cancellationToken))
        {
            return Result.Failure("You are not allowed to manage project members.");
        }

        var member = await projects.GetMemberAsync(projectId, userId, cancellationToken);
        if (member is null)
        {
            return Result.Failure("Project member not found.");
        }

        projects.RemoveMember(member);
        await AuditAsync(actorUserId, "ProjectMemberRemoved", "Project", projectId, cancellationToken);
        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is not null)
        {
            await invalidations.ProjectChangedAsync(project, actorUserId, "memberChanged", cancellationToken);
            await authorizationChanges.PublishAsync(project.TenantId, userId, "project", project.Id, "revoked", cancellationToken);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<PagedResponse<MilestoneResponse>>> ListMilestonesAsync(Guid projectId, ProjectChildListQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, projectId, cancellationToken))
        {
            return Result<PagedResponse<MilestoneResponse>>.Failure("Project not found.");
        }

        var milestones = await projects.ListMilestonesAsync(projectId, cancellationToken);
        var filtered = milestones
            .Where(m => !m.DeletedAt.HasValue)
            .Where(m => MatchesSearch(m.Name, m.Description, query.Search))
            .Select(ToMilestone)
            .ToList();
        return Result<PagedResponse<MilestoneResponse>>.Success(ToPagedResponse(filtered, query.SafePage, query.SafePageSize));
    }

    public async Task<Result<MilestoneResponse>> GetMilestoneAsync(Guid milestoneId, CancellationToken cancellationToken = default)
    {
        var milestone = await projects.GetMilestoneAsync(milestoneId, cancellationToken);
        if (milestone is null || milestone.DeletedAt.HasValue || !TryCurrentUser(out var userId) ||
            !await projectAuthorization.CanViewProject(userId, milestone.ProjectId, cancellationToken))
        {
            return Result<MilestoneResponse>.Failure("Milestone not found.");
        }

        return Result<MilestoneResponse>.Success(ToMilestone(milestone));
    }

    public async Task<Result<MilestoneResponse>> CreateMilestoneAsync(Guid projectId, CreateMilestoneRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanManageProject(userId, projectId, cancellationToken))
        {
            return Result<MilestoneResponse>.Failure("You are not allowed to manage this project.");
        }

        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return Result<MilestoneResponse>.Failure("Milestone title is required.");
        }

        if (await projects.GetProjectAsync(projectId, cancellationToken) is null)
        {
            return Result<MilestoneResponse>.Failure("Project not found.");
        }

        var milestone = new Milestone
        {
            ProjectId = projectId,
            Name = request.Title.Trim(),
            Description = request.Description?.Trim(),
            DueDate = request.DueDate,
            SortOrder = request.DisplayOrder
        };

        await projects.AddMilestoneAsync(milestone, cancellationToken);
        await AuditAsync(userId, "MilestoneCreated", "Milestone", milestone.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<MilestoneResponse>.Success(ToMilestone(milestone));
    }

    public async Task<Result<MilestoneResponse>> UpdateMilestoneAsync(Guid milestoneId, UpdateMilestoneRequest request, CancellationToken cancellationToken = default)
    {
        var milestone = await projects.GetMilestoneAsync(milestoneId, cancellationToken);
        if (milestone is null || milestone.DeletedAt.HasValue)
        {
            return Result<MilestoneResponse>.Failure("Milestone not found.");
        }

        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanManageProject(userId, milestone.ProjectId, cancellationToken))
        {
            return Result<MilestoneResponse>.Failure("You are not allowed to manage this project.");
        }

        if (request.Title is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Result<MilestoneResponse>.Failure("Milestone title is required.");
            }

            milestone.Name = request.Title.Trim();
        }

        if (request.Status.HasValue && request.Status.Value is not (MilestoneStatus.NotStarted or MilestoneStatus.InProgress or MilestoneStatus.Completed))
        {
            return Result<MilestoneResponse>.Failure("Milestone status must be NotStarted, InProgress, or Completed.");
        }

        milestone.Description = request.Description?.Trim() ?? milestone.Description;
        milestone.DueDate = request.DueDate ?? milestone.DueDate;
        milestone.Status = request.Status ?? milestone.Status;
        milestone.SortOrder = request.DisplayOrder ?? milestone.SortOrder;
        await AuditAsync(userId, "MilestoneUpdated", "Milestone", milestone.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<MilestoneResponse>.Success(ToMilestone(milestone));
    }

    public async Task<Result> DeleteMilestoneAsync(Guid milestoneId, CancellationToken cancellationToken = default)
    {
        var milestone = await projects.GetMilestoneAsync(milestoneId, cancellationToken);
        if (milestone is null)
        {
            return Result.Failure("Milestone not found.");
        }

        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanManageProject(userId, milestone.ProjectId, cancellationToken))
        {
            return Result.Failure("You are not allowed to manage this project.");
        }

        milestone.MarkDeleted(clock.UtcNow);
        await AuditAsync(userId, "MilestoneDeleted", "Milestone", milestone.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<PagedResponse<TaskItemResponse>>> ListTasksAsync(Guid projectId, TaskListQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, projectId, cancellationToken))
        {
            return Result<PagedResponse<TaskItemResponse>>.Failure("Project not found.");
        }

        var tasks = await projects.ListTasksAsync(projectId, cancellationToken);
        // Do not run concurrent operations over the scoped DbContext.  This
        // compatibility filter is intentionally sequential until it is moved
        // to the repository's SQL projection.
        HashSet<Guid>? taskIdsForAssignee = null;
        if (query.AssignedUserId.HasValue)
        {
            taskIdsForAssignee = [];
            foreach (var task in tasks)
                if ((await projects.ListAssignmentsAsync(task.Id, cancellationToken)).Any(assignment => assignment.UserId == query.AssignedUserId.Value))
                    taskIdsForAssignee.Add(task.Id);
        }

        var filtered = tasks
            .Where(task => !task.DeletedAt.HasValue)
            .Where(task => MatchesSearch(task.Title, task.Description, query.Search))
            .Where(task => !query.Status.HasValue || task.Status == query.Status.Value)
            .Where(task => !query.Priority.HasValue || task.Priority == query.Priority.Value)
            .Where(task => !query.MilestoneId.HasValue || task.MilestoneId == query.MilestoneId.Value)
            .Where(task => taskIdsForAssignee is null || taskIdsForAssignee.Contains(task.Id))
            .ToList();
        // Build each direct-child collection once.  Passing the complete Project
        // set to every row makes parent derivation quadratic for large lists.
        var childrenByParent = tasks
            .Where(task => task.ParentTaskItemId.HasValue)
            .GroupBy(task => task.ParentTaskItemId!.Value)
            .ToDictionary(group => group.Key, group => (IEnumerable<TaskItem>)group.ToArray());
        var derivedValues = tasks.ToDictionary(
            task => task.Id,
            task => ParentTaskDerivedValuesCalculator.Calculate(task, childrenByParent.GetValueOrDefault(task.Id, []), CategoryOf));
        var workspaceId = tasks.FirstOrDefault()?.WorkspaceId;
        var timeZone = workspaceId.HasValue && timeZones is not null
            ? await timeZones.ResolveAsync(tasks[0].TenantId, workspaceId.Value, cancellationToken)
            : TimeZoneInfo.Utc;
        var responses = new List<TaskItemResponse>(filtered.Count);
        foreach (var task in filtered)
            responses.Add(await ToTaskAsync(task, userId, cancellationToken, derivedValues[task.Id], timeZone));
        return Result<PagedResponse<TaskItemResponse>>.Success(ToPagedResponse(responses, query.SafePage, query.SafePageSize));
    }

    public async Task<Result<TaskItemResponse>> CreateTaskAsync(Guid projectId, CreateTaskItemRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await taskAuthorization.CanCreateTask(userId, projectId, cancellationToken))
        {
            return Result<TaskItemResponse>.Failure("You are not allowed to create tasks.");
        }

        var validation = await ValidateTaskRequestAsync(projectId, request.MilestoneId, request.Title, request.StartDate, request.DueDate, null, cancellationToken);
        if (!validation.IsSuccess)
        {
            return Result<TaskItemResponse>.Failure(validation.Error!);
        }

        var project = await projects.GetProjectAsync(projectId, cancellationToken);
        if (project is null)
        {
            return Result<TaskItemResponse>.Failure("Project not found.");
        }

        var task = new TaskItem
        {
            ProjectId = projectId,
            WorkspaceId = project.WorkspaceId,
            MilestoneId = request.MilestoneId,
            Title = request.Title.Trim(),
            Description = request.Description?.Trim(),
            Priority = request.Priority,
            StartDate = request.StartDate,
            DueDate = request.DueDate,
            PlannedStartDate = request.StartDate,
            PlannedEndDate = request.DueDate,
            CreatedByUserId = userId
        };

        await projects.AddTaskAsync(task, cancellationToken);
        await projects.AddWatchStateAsync(TaskWatchStateInitializer.ForCreator(task, userId, clock.UtcNow), cancellationToken);
        await AuditAsync(userId, "TaskCreated", "TaskItem", task.Id, cancellationToken);
        await invalidations.TaskChangedAsync(task, userId, "created", cancellationToken: cancellationToken);
        if (await taskUnitOfWork.SaveTaskCommandAsync(cancellationToken) != TaskCommandSaveResult.Saved)
            return TaskConflict<TaskItemResponse>();
        return Result<TaskItemResponse>.Success(await ToTaskAsync(task, userId, cancellationToken));
    }

    public async Task<Result<TaskItemResponse>> GetTaskAsync(Guid taskItemId, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        if (task is null || task.DeletedAt.HasValue || !TryCurrentUser(out var userId) ||
            !await projectAuthorization.CanViewProject(userId, task.ProjectId, cancellationToken))
        {
            return Result<TaskItemResponse>.Failure("Task not found.");
        }

        return Result<TaskItemResponse>.Success(await ToTaskAsync(task, userId, cancellationToken));
    }

    public async Task<Result<TaskItemResponse>> UpdateTaskAsync(Guid taskItemId, UpdateTaskItemRequest request, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        if (task is null || task.DeletedAt.HasValue)
        {
            return Result<TaskItemResponse>.Failure("Task not found.");
        }

        if (!TryCurrentUser(out var userId) || !await taskAuthorization.CanUpdateTask(userId, taskItemId, cancellationToken))
        {
            return Result<TaskItemResponse>.Failure("You are not allowed to update this task.");
        }

        var startDate = request.StartDate ?? task.StartDate;
        var dueDate = request.DueDate ?? task.DueDate;
        var progress = request.ProgressPercent ?? task.ProgressPercent;
        var validation = await ValidateTaskRequestAsync(task.ProjectId, request.MilestoneId ?? task.MilestoneId, request.Title ?? task.Title, startDate, dueDate, progress, cancellationToken);
        if (!validation.IsSuccess)
        {
            return Result<TaskItemResponse>.Failure(validation.Error!);
        }

        if (request.Title is not null)
        {
            task.Title = request.Title.Trim();
        }

        var previousStatus = task.Status;
        var previousDueDate = task.DueDate;
        task.MilestoneId = request.MilestoneId ?? task.MilestoneId;
        task.Description = request.Description?.Trim() ?? task.Description;
        task.Status = request.Status ?? task.Status;
        task.Priority = request.Priority ?? task.Priority;
        task.StartDate = request.StartDate ?? task.StartDate;
        task.DueDate = request.DueDate ?? task.DueDate;
        task.ProgressPercent = task.Status == TaskItemStatus.Completed ? 100 : progress;

        await NotifyTaskChangesAsync(task, previousStatus, previousDueDate, cancellationToken);
        task.VersionNo++;
        await AuditAsync(userId, "TaskUpdated", "TaskItem", task.Id, cancellationToken);
        var changedFields = ChangedTaskFields(request, previousStatus);
        var affectedUsers = (await projects.ListAssignmentsAsync(task.Id, cancellationToken)).Select(assignment => assignment.UserId);
        await invalidations.TaskChangedAsync(task, userId, previousStatus == task.Status ? "updated" : "statusChanged", changedFields, affectedUsers, cancellationToken);
        if (await taskUnitOfWork.SaveTaskCommandAsync(cancellationToken) != TaskCommandSaveResult.Saved)
            return TaskConflict<TaskItemResponse>();
        return Result<TaskItemResponse>.Success(await ToTaskAsync(task, userId, cancellationToken));
    }

    public async Task<Result> DeleteTaskAsync(Guid taskItemId, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        if (task is null)
        {
            return Result.Failure("Task not found.");
        }

        if (!TryCurrentUser(out var userId) || !await taskAuthorization.CanUpdateTask(userId, taskItemId, cancellationToken))
        {
            return Result.Failure("You are not allowed to update this task.");
        }

        task.MarkDeleted(clock.UtcNow);
        task.VersionNo++;
        await AuditAsync(userId, "TaskArchived", "TaskItem", task.Id, cancellationToken);
        var deletedTaskUsers = (await projects.ListAssignmentsAsync(task.Id, cancellationToken)).Select(assignment => assignment.UserId);
        await invalidations.TaskChangedAsync(task, userId, "deleted", affectedUserIds: deletedTaskUsers, cancellationToken: cancellationToken);
        if (await taskUnitOfWork.SaveTaskCommandAsync(cancellationToken) != TaskCommandSaveResult.Saved)
            return TaskConflict();
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<TaskAssignmentResponse>>> ListAssignmentsAsync(Guid taskItemId, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        if (task is null || !TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, task.ProjectId, cancellationToken))
        {
            return Result<IReadOnlyList<TaskAssignmentResponse>>.Failure("Task not found.");
        }

        var assignments = await projects.ListAssignmentsAsync(taskItemId, cancellationToken);
        return Result<IReadOnlyList<TaskAssignmentResponse>>.Success(assignments.Select(ToAssignment).ToList());
    }

    public async Task<Result<TaskAssignmentResponse>> AddAssignmentAsync(Guid taskItemId, AddTaskAssignmentRequest request, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        if (task is null)
        {
            return Result<TaskAssignmentResponse>.Failure("Task not found.");
        }

        if (!TryCurrentUser(out var actorUserId) || !await taskAuthorization.CanAssignTask(actorUserId, taskItemId, cancellationToken))
        {
            return Result<TaskAssignmentResponse>.Failure("You are not allowed to assign this task.");
        }

        if (request.EstimatedHours is < 0)
        {
            return Result<TaskAssignmentResponse>.Failure("Estimated hours cannot be negative.");
        }

        var projectMember = await projects.GetMemberAsync(task.ProjectId, request.UserId, cancellationToken);
        var user = await users.GetByIdAsync(request.UserId, cancellationToken);
        if (projectMember is null || user is null)
        {
            return Result<TaskAssignmentResponse>.Failure("User must be a project member before assignment.");
        }

        var existing = await projects.ListAssignmentsAsync(taskItemId, cancellationToken);
        if (existing.Any(assignment => assignment.UserId == request.UserId && assignment.Role == request.Role))
        {
            return Result<TaskAssignmentResponse>.Failure("User already has this assignment role.");
        }

        var assignment = new TaskAssignment
        {
            TaskItemId = taskItemId,
            UserId = request.UserId,
            User = user,
            Role = request.Role,
            EstimatedHours = request.EstimatedHours,
            AssignedByUserId = actorUserId,
            AssignedAt = clock.UtcNow
        };

        await projects.AddAssignmentAsync(assignment, cancellationToken);
        await notifications.NotifyAsync(request.UserId, "Task assigned", task.Title, "TaskItem", task.Id, cancellationToken);
        task.VersionNo++;
        await AuditAsync(actorUserId, "TaskAssigned", "TaskItem", task.Id, cancellationToken);
        var assignmentUsers = (await projects.ListAssignmentsAsync(task.Id, cancellationToken)).Select(item => item.UserId).Append(request.UserId);
        await invalidations.TaskChangedAsync(task, actorUserId, "assignmentChanged", ["assignments"], assignmentUsers, cancellationToken);
        var save = await taskUnitOfWork.SaveTaskCommandAsync(cancellationToken);
        if (save != TaskCommandSaveResult.Saved)
            return save.Result == TaskCommandSaveResult.UniqueConflict
                ? (IsAssignmentIdentityConstraint(save.ConstraintName)
                    ? AssignmentConflict<TaskAssignmentResponse>()
                    : GeneralTaskConflict<TaskAssignmentResponse>())
                : TaskConflict<TaskAssignmentResponse>();
        return Result<TaskAssignmentResponse>.Success(ToAssignment(assignment));
    }

    public async Task<Result<TaskAssignmentResponse>> UpdateAssignmentAsync(Guid assignmentId, UpdateTaskAssignmentRequest request, CancellationToken cancellationToken = default)
    {
        var assignment = await projects.GetAssignmentAsync(assignmentId, cancellationToken);
        if (assignment?.TaskItem is null)
        {
            return Result<TaskAssignmentResponse>.Failure("Assignment not found.");
        }

        if (!TryCurrentUser(out var userId) || !await taskAuthorization.CanAssignTask(userId, assignment.TaskItemId, cancellationToken))
        {
            return Result<TaskAssignmentResponse>.Failure("You are not allowed to assign this task.");
        }

        if (request.EstimatedHours is < 0 || request.ActualHours is < 0)
        {
            return Result<TaskAssignmentResponse>.Failure("Hours cannot be negative.");
        }

        var existing = await projects.ListAssignmentsAsync(assignment.TaskItemId, cancellationToken);
        if (existing.Any(item => item.Id != assignment.Id && item.UserId == assignment.UserId && item.Role == request.Role))
        {
            return Result<TaskAssignmentResponse>.Failure("User already has this assignment role.");
        }

        assignment.Role = request.Role;
        assignment.EstimatedHours = request.EstimatedHours;
        assignment.ActualHours = request.ActualHours;
        await notifications.NotifyAsync(assignment.UserId, "Task assignment updated", assignment.TaskItem.Title, "TaskItem", assignment.TaskItemId, cancellationToken);
        assignment.TaskItem.VersionNo++;
        await AuditAsync(userId, "TaskAssignmentUpdated", "TaskItem", assignment.TaskItemId, cancellationToken);
        await invalidations.TaskChangedAsync(assignment.TaskItem, userId, "assignmentChanged", ["assignments"], [assignment.UserId], cancellationToken);
        var save = await taskUnitOfWork.SaveTaskCommandAsync(cancellationToken);
        if (save != TaskCommandSaveResult.Saved)
            return save.Result == TaskCommandSaveResult.UniqueConflict
                ? (IsAssignmentIdentityConstraint(save.ConstraintName)
                    ? AssignmentConflict<TaskAssignmentResponse>()
                    : GeneralTaskConflict<TaskAssignmentResponse>())
                : TaskConflict<TaskAssignmentResponse>();
        return Result<TaskAssignmentResponse>.Success(ToAssignment(assignment));
    }

    public async Task<Result> DeleteAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken = default)
    {
        var assignment = await projects.GetAssignmentAsync(assignmentId, cancellationToken);
        if (assignment is null)
        {
            return Result.Failure("Assignment not found.");
        }

        if (!TryCurrentUser(out var userId) || !await taskAuthorization.CanAssignTask(userId, assignment.TaskItemId, cancellationToken))
        {
            return Result.Failure("You are not allowed to assign this task.");
        }

        var task = assignment.TaskItem;
        if (task is null)
        {
            return Result.Failure("Task not found.");
        }
        projects.RemoveAssignment(assignment);
        await notifications.NotifyAsync(assignment.UserId, "Task assignment removed", assignment.TaskItem?.Title, "TaskItem", assignment.TaskItemId, cancellationToken);
        task.VersionNo++;
        await AuditAsync(userId, "TaskAssignmentRemoved", "TaskItem", assignment.TaskItemId, cancellationToken);
        await invalidations.TaskChangedAsync(task, userId, "assignmentChanged", ["assignments"], [assignment.UserId], cancellationToken);
        if (await taskUnitOfWork.SaveTaskCommandAsync(cancellationToken) != TaskCommandSaveResult.Saved)
            return TaskConflict();
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<TaskDependencyResponse>>> ListDependenciesAsync(Guid taskItemId, CancellationToken cancellationToken = default)
    {
        var task = await projects.GetTaskAsync(taskItemId, cancellationToken);
        if (task is null || !TryCurrentUser(out var userId) || !await projectAuthorization.CanViewProject(userId, task.ProjectId, cancellationToken))
        {
            return Result<IReadOnlyList<TaskDependencyResponse>>.Failure("Task not found.");
        }

        var dependencies = await projects.ListDependenciesAsync(taskItemId, cancellationToken);
        return Result<IReadOnlyList<TaskDependencyResponse>>.Success(dependencies.Select(ToDependency).ToList());
    }

    public async Task<Result<TaskDependencyResponse>> AddDependencyAsync(Guid taskItemId, AddTaskDependencyRequest request, CancellationToken cancellationToken = default)
    {
        var successor = await projects.GetTaskAsync(taskItemId, cancellationToken);
        var predecessor = await projects.GetTaskAsync(request.PredecessorTaskId, cancellationToken);
        if (successor is null || predecessor is null)
        {
            return Result<TaskDependencyResponse>.Failure("Task not found.");
        }

        if (!TryCurrentUser(out var userId) || !await taskAuthorization.CanUpdateTask(userId, taskItemId, cancellationToken))
        {
            return Result<TaskDependencyResponse>.Failure("You are not allowed to update this task.");
        }

        if (request.DependencyType != TaskDependencyType.FinishToStart)
        {
            await AuditAsync(userId, "TaskDependencyRejected", "TaskItem", taskItemId, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return Result<TaskDependencyResponse>.Failure("TASK_DEPENDENCY_TYPE_DEFERRED|Only Finish-to-Start dependencies can be authored.");
        }

        if (successor.Id == predecessor.Id)
        {
            return Result<TaskDependencyResponse>.Failure("A task cannot depend on itself.");
        }

        if (successor.ProjectId != predecessor.ProjectId)
        {
            return Result<TaskDependencyResponse>.Failure("Dependent tasks must belong to the same project.");
        }

        if (await projects.DependencyExistsAsync(predecessor.Id, successor.Id, cancellationToken))
        {
            return Result<TaskDependencyResponse>.Failure("Task dependency already exists.");
        }

        if (await WouldCreateCycleAsync(predecessor.Id, successor.Id, successor.ProjectId, cancellationToken))
        {
            return Result<TaskDependencyResponse>.Failure("Task dependency would create a cycle.");
        }

        var dependency = new TaskDependency
        {
            ProjectId = successor.ProjectId,
            PredecessorTaskItemId = predecessor.Id,
            SuccessorTaskItemId = successor.Id,
            DependencyType = request.DependencyType
        };

        await projects.AddDependencyAsync(dependency, cancellationToken);
        await AuditAsync(userId, "TaskDependencyAdded", "TaskItem", successor.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<TaskDependencyResponse>.Success(ToDependency(dependency));
    }

    public async Task<Result> DeleteDependencyAsync(Guid dependencyId, CancellationToken cancellationToken = default)
    {
        var dependency = await projects.GetDependencyAsync(dependencyId, cancellationToken);
        if (dependency is null)
        {
            return Result.Failure("Dependency not found.");
        }

        if (!TryCurrentUser(out var userId) || !await taskAuthorization.CanUpdateTask(userId, dependency.SuccessorTaskItemId, cancellationToken))
        {
            return Result.Failure("You are not allowed to update this task.");
        }

        projects.RemoveDependency(dependency);
        await AuditAsync(userId, "TaskDependencyRemoved", "TaskItem", dependency.SuccessorTaskItemId, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<PagedResponse<CommentResponse>>> ListCommentsAsync(CommentTargetType targetType, Guid targetId, ProjectChildListQuery query, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await commentAuthorization.CanCommentOnTarget(userId, targetType, targetId, cancellationToken))
        {
            return Result<PagedResponse<CommentResponse>>.Failure("Comment target not found.");
        }

        var comments = await projects.ListCommentsAsync(targetType, targetId, cancellationToken);
        var filtered = comments
            .Where(comment => !comment.DeletedAt.HasValue)
            .Where(comment => MatchesSearch(comment.Body, null, query.Search))
            .Select(ToComment)
            .ToList();
        return Result<PagedResponse<CommentResponse>>.Success(ToPagedResponse(filtered, query.SafePage, query.SafePageSize));
    }

    public async Task<Result<CommentResponse>> AddCommentAsync(CreateCommentRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryCurrentUser(out var userId) || !await commentAuthorization.CanCommentOnTarget(userId, request.TargetType, request.TargetId, cancellationToken))
        {
            return Result<CommentResponse>.Failure("Comment target not found.");
        }

        if (string.IsNullOrWhiteSpace(request.Body))
        {
            return Result<CommentResponse>.Failure("Comment body is required.");
        }

        var target = await ResolveCommentTargetAsync(request.TargetType, request.TargetId, cancellationToken);
        if (target is null)
        {
            return Result<CommentResponse>.Failure("Comment target not found.");
        }

        var comment = new Comment
        {
            WorkspaceId = target.Value.WorkspaceId,
            AuthorUserId = userId,
            TargetType = request.TargetType,
            TargetId = request.TargetId,
            Body = request.Body.Trim()
        };

        await projects.AddCommentAsync(comment, cancellationToken);
        await NotifyCommentAsync(comment, target.Value.ProjectId, cancellationToken);
        await AuditAsync(userId, "CommentAdded", "Comment", comment.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<CommentResponse>.Success(ToComment(comment));
    }

    public async Task<Result<CommentResponse>> UpdateCommentAsync(Guid commentId, UpdateCommentRequest request, CancellationToken cancellationToken = default)
    {
        var comment = await projects.GetCommentAsync(commentId, cancellationToken);
        if (comment is null || comment.DeletedAt.HasValue)
        {
            return Result<CommentResponse>.Failure("Comment not found.");
        }

        if (string.IsNullOrWhiteSpace(request.Body))
        {
            return Result<CommentResponse>.Failure("Comment body is required.");
        }

        if (!TryCurrentUser(out var userId) || !await CanModifyCommentAsync(userId, comment, cancellationToken))
        {
            return Result<CommentResponse>.Failure("You are not allowed to edit this comment.");
        }

        comment.Body = request.Body.Trim();
        await AuditAsync(userId, "CommentEdited", "Comment", comment.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<CommentResponse>.Success(ToComment(comment));
    }

    public async Task<Result> DeleteCommentAsync(Guid commentId, CancellationToken cancellationToken = default)
    {
        var comment = await projects.GetCommentAsync(commentId, cancellationToken);
        if (comment is null)
        {
            return Result.Failure("Comment not found.");
        }

        if (!TryCurrentUser(out var userId) || !await CanModifyCommentAsync(userId, comment, cancellationToken))
        {
            return Result.Failure("You are not allowed to delete this comment.");
        }

        comment.MarkDeleted(clock.UtcNow);
        await AuditAsync(userId, "CommentDeleted", "Comment", comment.Id, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task<Result> ValidateProjectParentAsync(Guid workspaceId, Guid groupId, CancellationToken cancellationToken)
    {
        if (await workspaces.GetByIdAsync(workspaceId, cancellationToken) is null)
        {
            return Result.Failure("Workspace not found.");
        }

        if (groupId == Guid.Empty)
        {
            return Result.Failure("Project group is required.");
        }

        var group = await groups.GetByIdAsync(groupId, cancellationToken);
        if (group is null || group.WorkspaceId != workspaceId || group.Status != GroupStatus.Active)
        {
            return Result.Failure("Group must belong to the selected workspace.");
        }

        return Result.Success();
    }

    private async Task<Result> ValidateParentAccessAsync(Project project, Guid userId, CancellationToken cancellationToken)
    {
        var workspaceMember = await workspaces.GetMemberAsync(project.WorkspaceId, userId, cancellationToken);
        if (workspaceMember is not { Status: MembershipStatus.Active })
        {
            return Result.Failure("User must belong to the workspace before joining the project.");
        }

        if (project.GroupId.HasValue && await groups.GetMemberAsync(project.GroupId.Value, userId, cancellationToken) is null)
        {
            return Result.Failure("User must belong to the group before joining the project.");
        }

        return Result.Success();
    }

    private async Task<Result> ValidateTaskRequestAsync(Guid projectId, Guid? milestoneId, string title, DateOnly? startDate, DateOnly? dueDate, int? progressPercent, CancellationToken cancellationToken)
    {
        if (await projects.GetProjectAsync(projectId, cancellationToken) is null)
        {
            return Result.Failure("Project not found.");
        }

        if (milestoneId.HasValue)
        {
            var milestone = await projects.GetMilestoneAsync(milestoneId.Value, cancellationToken);
            if (milestone is null || milestone.ProjectId != projectId)
            {
                return Result.Failure("Milestone must belong to the same project.");
            }
        }

        if (string.IsNullOrWhiteSpace(title))
        {
            return Result.Failure("Task title is required.");
        }

        if (HasInvalidDateRange(startDate, dueDate))
        {
            return Result.Failure("Task due date cannot be before the start date.");
        }

        if (progressPercent is < 0 or > 100)
        {
            return Result.Failure("Task progress must be between 0 and 100.");
        }

        return Result.Success();
    }

    private async Task<bool> WouldCreateCycleAsync(Guid predecessorTaskId, Guid successorTaskId, Guid projectId, CancellationToken cancellationToken)
    {
        var dependencies = await projects.ListProjectDependenciesAsync(projectId, cancellationToken);
        var edges = dependencies
            .GroupBy(dependency => dependency.PredecessorTaskItemId)
            .ToDictionary(group => group.Key, group => group.Select(dependency => dependency.SuccessorTaskItemId).ToList());

        if (!edges.TryGetValue(predecessorTaskId, out var successors))
        {
            edges[predecessorTaskId] = successors = [];
        }

        successors.Add(successorTaskId);
        var stack = new Stack<Guid>();
        var visited = new HashSet<Guid>();
        stack.Push(successorTaskId);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            if (!visited.Add(current))
            {
                continue;
            }

            if (current == predecessorTaskId)
            {
                return true;
            }

            if (edges.TryGetValue(current, out var next))
            {
                foreach (var nextTaskId in next)
                {
                    stack.Push(nextTaskId);
                }
            }
        }

        return false;
    }

    private async Task NotifyTaskChangesAsync(TaskItem task, TaskItemStatus previousStatus, DateOnly? previousDueDate, CancellationToken cancellationToken)
    {
        var assignments = await projects.ListAssignmentsAsync(task.Id, cancellationToken);
        if (task.DueDate != previousDueDate)
        {
            foreach (var assignment in assignments)
            {
                await notifications.NotifyAsync(assignment.UserId, "Task due date changed", task.Title, "TaskItem", task.Id, cancellationToken);
            }
        }

        if (task.Status == TaskItemStatus.WaitingReview && previousStatus != TaskItemStatus.WaitingReview)
        {
            foreach (var assignment in assignments.Where(assignment => assignment.Role is TaskAssignmentRole.Owner or TaskAssignmentRole.Reviewer))
            {
                await notifications.NotifyAsync(assignment.UserId, "Task waiting for review", task.Title, "TaskItem", task.Id, cancellationToken);
            }
        }
    }

    private async Task NotifyCommentAsync(Comment comment, Guid projectId, CancellationToken cancellationToken)
    {
        if (comment.TargetType != CommentTargetType.TaskItem)
        {
            return;
        }

        var assignments = await projects.ListAssignmentsAsync(comment.TargetId, cancellationToken);
        foreach (var assignment in assignments.Where(assignment => assignment.UserId != comment.AuthorUserId))
        {
            await notifications.NotifyAsync(assignment.UserId, "Comment added", comment.Body.Length > 120 ? comment.Body[..120] : comment.Body, "TaskItem", projectId, cancellationToken);
        }
    }

    private async Task<bool> CanModifyCommentAsync(Guid userId, Comment comment, CancellationToken cancellationToken)
    {
        if (comment.AuthorUserId == userId)
        {
            return true;
        }

        var target = await ResolveCommentTargetAsync(comment.TargetType, comment.TargetId, cancellationToken);
        return target is not null && await projectAuthorization.CanManageProject(userId, target.Value.ProjectId, cancellationToken);
    }

    private async Task<(Guid ProjectId, Guid WorkspaceId)?> ResolveCommentTargetAsync(CommentTargetType targetType, Guid targetId, CancellationToken cancellationToken)
    {
        if (targetType == CommentTargetType.Project)
        {
            var project = await projects.GetProjectAsync(targetId, cancellationToken);
            return project is null ? null : (project.Id, project.WorkspaceId);
        }

        if (targetType == CommentTargetType.TaskItem)
        {
            var task = await projects.GetTaskAsync(targetId, cancellationToken);
            if (task is null) return null;
            var project = await projects.GetProjectAsync(task.ProjectId, cancellationToken);
            return project is null ? null : (project.Id, project.WorkspaceId);
        }

        if (targetType == CommentTargetType.Milestone)
        {
            var milestone = await projects.GetMilestoneAsync(targetId, cancellationToken);
            if (milestone is null) return null;
            var project = await projects.GetProjectAsync(milestone.ProjectId, cancellationToken);
            return project is null ? null : (project.Id, project.WorkspaceId);
        }

        return null;
    }

    private bool TryCurrentUser(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return currentUser.IsAuthenticated && currentUser.UserId.HasValue;
    }

    private Task AuditAsync(Guid actorUserId, string action, string targetType, Guid targetId, CancellationToken cancellationToken)
    {
        return auditLogger.LogAsync(new AuditLogEntry(actorUserId, action, targetType, targetId, SummaryFor(action)), cancellationToken);
    }

    private static bool IsValidProjectStatusTransition(ProjectStatus current, ProjectStatus next)
    {
        if (current == next) return true;
        if (next == ProjectStatus.Deleted) return false;

        return current switch
        {
            ProjectStatus.Planning => next is ProjectStatus.Active or ProjectStatus.Suspended or ProjectStatus.Archived,
            ProjectStatus.Active => next is ProjectStatus.Review or ProjectStatus.Completed or ProjectStatus.Suspended or ProjectStatus.Archived,
            ProjectStatus.Review => next is ProjectStatus.Active or ProjectStatus.Completed or ProjectStatus.Suspended or ProjectStatus.Archived,
            ProjectStatus.Completed => next is ProjectStatus.Archived,
            ProjectStatus.Suspended => next is ProjectStatus.Planning or ProjectStatus.Active or ProjectStatus.Archived,
            ProjectStatus.Archived => false,
            _ => false
        };
    }

    private static IReadOnlyList<string> ChangedTaskFields(UpdateTaskItemRequest request, TaskItemStatus previousStatus)
    {
        var fields = new List<string>();
        if (request.Title is not null) fields.Add("title");
        if (request.Description is not null) fields.Add("description");
        if (request.MilestoneId.HasValue) fields.Add("milestoneId");
        if (request.Priority.HasValue) fields.Add("priority");
        if (request.StartDate.HasValue) fields.Add("startDate");
        if (request.DueDate.HasValue) fields.Add("dueDate");
        if (request.ProgressPercent.HasValue) fields.Add("progressPercent");
        if (request.Status.HasValue && request.Status != previousStatus) fields.Add("status");
        return fields;
    }

    private static string SummaryFor(string action) => action switch
    {
        "ProjectStatusChanged" => "Project status changed.",
        "TaskAssigned" => "Task assignment added.",
        "TaskAssignmentUpdated" => "Task assignment changed.",
        "TaskAssignmentRemoved" => "Task assignment removed.",
        _ => $"{action} completed."
    };

    private static bool HasInvalidDateRange(DateOnly? startDate, DateOnly? endDate)
    {
        return startDate.HasValue && endDate.HasValue && endDate.Value < startDate.Value;
    }

    private static bool MatchesSearch(string value, string? secondaryValue, string? search)
    {
        if (string.IsNullOrWhiteSpace(search))
        {
            return true;
        }

        return value.Contains(search.Trim(), StringComparison.OrdinalIgnoreCase) ||
            (secondaryValue?.Contains(search.Trim(), StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private static PagedResponse<T> ToPagedResponse<T>(IReadOnlyList<T> items, int page, int pageSize)
    {
        return new PagedResponse<T>(items.Skip((page - 1) * pageSize).Take(pageSize).ToList(), page, pageSize, items.Count);
    }

    private async Task<ProjectResponse> ToProjectAsync(Project project, Guid userId, CancellationToken cancellationToken)
    {
        return new ProjectResponse(
            project.Id,
            project.WorkspaceId,
            project.GroupId ?? Guid.Empty,
            project.OwnerUserId,
            project.Name,
            project.Description,
            project.Status,
            project.StartDate,
            project.DueDate,
            project.CreatedAt,
            project.UpdatedAt,
            new ProjectUiPermissionResponse(await taskAuthorization.CanCreateTask(userId, project.Id, cancellationToken)));
    }

    private static ProjectMemberResponse ToProjectMember(ProjectMember member)
    {
        return new ProjectMemberResponse(member.UserId, member.User?.DisplayName ?? string.Empty, member.User?.Email ?? string.Empty, member.Role, member.JoinedAt);
    }

    private static MilestoneResponse ToMilestone(Milestone milestone)
    {
        return new MilestoneResponse(milestone.Id, milestone.ProjectId, milestone.Name, milestone.Description, milestone.DueDate, milestone.Status, milestone.SortOrder, milestone.CreatedAt, milestone.UpdatedAt);
    }

    private async Task<TaskItemResponse> ToTaskAsync(TaskItem task, Guid userId, CancellationToken cancellationToken, ParentTaskDerivedValues? derivedOverride = null, TimeZoneInfo? timeZoneOverride = null)
    {
        var canEdit = await taskAuthorization.CanUpdateTask(userId, task.Id, cancellationToken);
        var canAssign = await taskAuthorization.CanAssignTask(userId, task.Id, cancellationToken);
        var derived = derivedOverride;
        if (derived is null)
            derived = ParentTaskDerivedValuesCalculator.Calculate(task, await projects.ListTasksAsync(task.ProjectId, cancellationToken), CategoryOf);
        var timeZone = timeZoneOverride ?? (timeZones is null
            ? TimeZoneInfo.Utc
            : await timeZones.ResolveAsync(task.TenantId, task.WorkspaceId, cancellationToken));
        return new TaskItemResponse(
            task.Id,
            task.ProjectId,
            task.MilestoneId,
            task.Title,
            task.Description,
            task.Status,
            task.Priority,
            derived.PlannedStartDate,
            derived.PlannedEndDate,
            derived.ProgressPercent,
            task.CreatedByUserId,
            task.CreatedAt,
            task.UpdatedAt,
            new TaskUiPermissionResponse(
                canEdit,
                canAssign,
                false,
                canEdit,
                Array.Empty<TaskItemStatus>(),
                await GetTaskDomainV1RowVersionAsync(task, cancellationToken)),
            derived.PlannedStartDate,
            derived.PlannedEndDate,
            derived.IsDerived,
            TaskDeadlineCalculator.IsOverdue(task, CategoryOf(task), timeZone, clock.UtcNow, derived.PlannedEndDate),
            task.VersionNo);
    }

    private static TaskStageCategory CategoryOf(TaskItem task) => task.WorkflowStage?.InternalCategory ?? task.Status switch
    {
        TaskItemStatus.InProgress => TaskStageCategory.InProgress,
        TaskItemStatus.WaitingReview => TaskStageCategory.Review,
        TaskItemStatus.Completed => TaskStageCategory.Done,
        TaskItemStatus.Cancelled => TaskStageCategory.Cancelled,
        _ => TaskStageCategory.Todo
    };

    private async Task<string?> GetTaskDomainV1RowVersionAsync(TaskItem task, CancellationToken cancellationToken)
    {
        if (featureFlags is null)
        {
            return null;
        }

        taskDomainV1Enabled ??= featureFlags.IsEnabledAsync(FeatureKeys.TasksDomainV1, cancellationToken);
        return await taskDomainV1Enabled
            ? task.VersionNo.ToString(System.Globalization.CultureInfo.InvariantCulture)
            : null;
    }

    private static TaskAssignmentResponse ToAssignment(TaskAssignment assignment)
    {
        return new TaskAssignmentResponse(assignment.Id, assignment.TaskItemId, assignment.UserId, assignment.User?.DisplayName ?? string.Empty, assignment.Role, assignment.EstimatedHours, assignment.ActualHours, assignment.AssignedAt, assignment.AssignedByUserId);
    }

    private static Result TaskConflict() =>
        Result.Failure(new ApplicationErrorDetail("TASK_STALE_VERSION", "Task has changed. Refetch and retry."));

    private static Result<T> TaskConflict<T>() =>
        Result<T>.Failure(new ApplicationErrorDetail("TASK_STALE_VERSION", "Task has changed. Refetch and retry."));

    private static Result<T> AssignmentConflict<T>() =>
        Result<T>.Failure(new ApplicationErrorDetail("TASK_ALREADY_ASSIGNED", "User already has this assignment role."));

    private static Result<T> GeneralTaskConflict<T>() =>
        Result<T>.Failure(new ApplicationErrorDetail("TASK_CONFLICT", "The task could not be updated. Refetch and retry."));

    // This is the generated PostgreSQL index name for the unique TaskAssignment
    // identity configured in TaskAssignmentConfiguration.  Do not map other
    // database unique constraints to the assignment-specific error.
    private static bool IsAssignmentIdentityConstraint(string? constraintName) =>
        string.Equals(constraintName, "IX_task_assignments_TenantId_TaskItemId_UserId_Role", StringComparison.Ordinal);

    private static TaskDependencyResponse ToDependency(TaskDependency dependency)
    {
        return new TaskDependencyResponse(dependency.Id, dependency.PredecessorTaskItemId, dependency.SuccessorTaskItemId, dependency.DependencyType, dependency.CreatedAt);
    }

    private static CommentResponse ToComment(Comment comment)
    {
        return new CommentResponse(comment.Id, comment.TargetType, comment.TargetId, comment.AuthorUserId, comment.Body, comment.CreatedAt, comment.UpdatedAt);
    }
}
