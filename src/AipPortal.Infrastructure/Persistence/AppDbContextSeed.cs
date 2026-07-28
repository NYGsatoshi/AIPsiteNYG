using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Common.Tenancy;
using Microsoft.EntityFrameworkCore;
using System.Text;

namespace AipPortal.Infrastructure.Persistence;

public static class AppDbContextSeed
{
    public static readonly Guid DefaultTenantId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    public static async Task<Tenant> SeedDefaultTenantAsync(
        AppDbContext dbContext,
        TenancyOptions options,
        CancellationToken cancellationToken = default)
    {
        var slug = string.IsNullOrWhiteSpace(options.DefaultTenantSlug)
            ? "default"
            : options.DefaultTenantSlug.Trim().ToLowerInvariant();

        var tenant = await dbContext.Tenants.FirstOrDefaultAsync(candidate => candidate.Slug == slug, cancellationToken);
        if (tenant is not null)
        {
            return tenant;
        }

        tenant = await dbContext.Tenants.FirstOrDefaultAsync(cancellationToken);
        if (tenant is not null)
        {
            return tenant;
        }

        tenant = new Tenant(DefaultTenantId)
        {
            Name = "Default Tenant",
            Slug = slug,
            DisplayName = "Default Tenant",
            Status = TenantStatus.Active
        };

        await dbContext.Tenants.AddAsync(tenant, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        return tenant;
    }

    public static async Task SeedUiShellAsync(AppDbContext dbContext, Guid tenantId, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        await SeedModulesAsync(dbContext, now, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        var modules = await dbContext.FeatureModules.ToDictionaryAsync(module => module.Key, cancellationToken);
        await SeedPanelsAsync(dbContext, modules, now, cancellationToken);
        await SeedCommandsAsync(dbContext, modules, now, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        var commands = await dbContext.CommandDefinitions.ToDictionaryAsync(command => command.Key, cancellationToken);
        await SeedRadialMenusAsync(dbContext, commands, tenantId, now, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public static async Task SeedPlansAsync(AppDbContext dbContext, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var features = "[\"ProductionTracking\",\"AdvancedGanttChart\",\"ExternalGuestAccess\",\"FileSharing\",\"Calendar\",\"Attendance\",\"Forms\",\"WebhookIntegration\",\"ApiAccess\",\"CustomBranding\",\"AuditLogViewer\",\"RadialMenu\",\"DockingLayout\"]";
        var plans = new (string Name, string Description, int Users, long Storage, int Projects, PlanStatus Status)[]
        {
            ("InternalPilot", "Internal pilot and development plan.", 100, 10L * 1024 * 1024 * 1024, 100, PlanStatus.InternalOnly),
            ("SchoolPilot", "Small school pilot plan.", 150, 25L * 1024 * 1024 * 1024, 150, PlanStatus.Active),
            ("Standard", "Standard SaaS plan foundation.", 500, 100L * 1024 * 1024 * 1024, 500, PlanStatus.Active),
            ("Enterprise", "Enterprise and on-prem configuration plan.", 5000, 1024L * 1024 * 1024 * 1024, 5000, PlanStatus.Active)
        };

        var existing = await dbContext.Plans.Select(plan => plan.Name).ToListAsync(cancellationToken);
        foreach (var plan in plans.Where(plan => !existing.Contains(plan.Name)))
        {
            await dbContext.Plans.AddAsync(new Plan
            {
                Name = plan.Name,
                Description = plan.Description,
                MaxUsers = plan.Users,
                MaxStorageBytes = plan.Storage,
                MaxProjects = plan.Projects,
                EnabledFeaturesJson = features,
                Status = plan.Status,
                CreatedAt = now
            }, cancellationToken);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public static async Task SeedLocalAdminAsync(
        AppDbContext dbContext,
        IPasswordHasher passwordHasher,
        Guid tenantId,
        string email,
        string password,
        string? displayName,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(password);

        await EnsureBootstrapAdminAsync(
            dbContext,
            passwordHasher,
            tenantId,
            email,
            password,
            displayName,
            ensureDefaultWorkspace: true,
            cancellationToken);
    }

    public static async Task SeedBrowserSmokeAsync(
        AppDbContext dbContext,
        IPasswordHasher passwordHasher,
        IFileStorageService fileStorage,
        Guid tenantId,
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(password);

        const string workspaceSlug = "browser-smoke-workspace";
        const string projectSlug = "browser-smoke-project";
        const string announcementTitle = "Browser smoke announcement";
        const string taskTitle = "Browser smoke task";
        const string recipientEmail = "browser-smoke-recipient@example.test";
        const string recipientDisplayName = "Browser Smoke Recipient";
        const string taskLabelName = "Browser smoke label";
        const string taskFileName = "browser-smoke-task.txt";
        const string taskFileContents = "Synthetic PR03C browser smoke file.\n";
        var taskFileBytes = Encoding.UTF8.GetBytes(taskFileContents);

        var now = DateTimeOffset.UtcNow;
        var normalizedEmail = email.Trim().ToUpperInvariant();
        var user = await dbContext.Users.FirstOrDefaultAsync(candidate => candidate.NormalizedEmail == normalizedEmail, cancellationToken);
        if (user is null)
        {
            user = new User
            {
                DisplayName = "Automated Browser Smoke User",
                Email = email.Trim(),
                NormalizedEmail = normalizedEmail,
                PasswordHash = passwordHasher.HashPassword(password),
                SystemRole = SystemRole.User,
                Status = UserStatus.Active
            };
            await dbContext.Users.AddAsync(user, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        else
        {
            user.DisplayName = "Automated Browser Smoke User";
            user.Email = email.Trim();
            user.NormalizedEmail = normalizedEmail;
            user.SystemRole = SystemRole.User;
            user.Status = UserStatus.Active;
            user.FailedLoginAttempts = 0;
            user.LockoutEndAt = null;
            if (user.IsDeleted)
            {
                user.Restore();
            }

            if (!passwordHasher.VerifyPassword(user.PasswordHash, password))
            {
                user.PasswordHash = passwordHasher.HashPassword(password);
            }
        }

        var normalizedRecipientEmail = recipientEmail.ToUpperInvariant();
        var recipient = await dbContext.Users.FirstOrDefaultAsync(candidate => candidate.NormalizedEmail == normalizedRecipientEmail, cancellationToken);
        if (recipient is null)
        {
            recipient = new User
            {
                DisplayName = recipientDisplayName,
                Email = recipientEmail,
                NormalizedEmail = normalizedRecipientEmail,
                PasswordHash = passwordHasher.HashPassword($"{password}:recipient"),
                SystemRole = SystemRole.User,
                Status = UserStatus.Active
            };
            await dbContext.Users.AddAsync(recipient, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        else
        {
            recipient.DisplayName = recipientDisplayName;
            recipient.Email = recipientEmail;
            recipient.NormalizedEmail = normalizedRecipientEmail;
            recipient.SystemRole = SystemRole.User;
            recipient.Status = UserStatus.Active;
            recipient.FailedLoginAttempts = 0;
            recipient.LockoutEndAt = null;
            if (recipient.IsDeleted)
            {
                recipient.Restore();
            }
        }

        var tenantUser = await dbContext.TenantUsers
            .FirstOrDefaultAsync(candidate => candidate.TenantId == tenantId && candidate.UserId == user.Id, cancellationToken);
        if (tenantUser is null)
        {
            tenantUser = new TenantUser
            {
                TenantId = tenantId,
                UserId = user.Id,
                Role = TenantUserRole.Member,
                Status = TenantUserStatus.Active,
                JoinedAt = now
            };
            await dbContext.TenantUsers.AddAsync(tenantUser, cancellationToken);
        }
        else
        {
            tenantUser.Role = TenantUserRole.Member;
            tenantUser.Status = TenantUserStatus.Active;
            if (tenantUser.JoinedAt == default)
            {
                tenantUser.JoinedAt = now;
            }
        }

        var recipientTenantUser = await dbContext.TenantUsers
            .FirstOrDefaultAsync(candidate => candidate.TenantId == tenantId && candidate.UserId == recipient.Id, cancellationToken);
        if (recipientTenantUser is null)
        {
            await dbContext.TenantUsers.AddAsync(new TenantUser
            {
                TenantId = tenantId,
                UserId = recipient.Id,
                Role = TenantUserRole.Member,
                Status = TenantUserStatus.Active,
                JoinedAt = now
            }, cancellationToken);
        }
        else
        {
            recipientTenantUser.Role = TenantUserRole.Member;
            recipientTenantUser.Status = TenantUserStatus.Active;
            if (recipientTenantUser.JoinedAt == default)
            {
                recipientTenantUser.JoinedAt = now;
            }
        }

        var workspace = await dbContext.Workspaces
            .FirstOrDefaultAsync(candidate => candidate.TenantId == tenantId && candidate.Slug == workspaceSlug, cancellationToken);
        if (workspace is null)
        {
            workspace = new Workspace
            {
                TenantId = tenantId,
                Name = "Browser Smoke Workspace",
                Slug = workspaceSlug,
                Description = "Synthetic workspace for automated browser smoke tests.",
                Status = WorkspaceStatus.Active,
                CreatedByUserId = user.Id
            };
            await dbContext.Workspaces.AddAsync(workspace, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        else
        {
            workspace.Name = "Browser Smoke Workspace";
            workspace.Description = "Synthetic workspace for automated browser smoke tests.";
            workspace.Status = WorkspaceStatus.Active;
            workspace.CreatedByUserId = user.Id;
            if (workspace.IsDeleted)
            {
                workspace.Restore();
            }
        }

        var workspaceMember = await dbContext.WorkspaceMembers.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.WorkspaceId == workspace.Id && candidate.UserId == user.Id,
            cancellationToken);
        if (workspaceMember is null)
        {
            await dbContext.WorkspaceMembers.AddAsync(new WorkspaceMember
            {
                TenantId = tenantId,
                WorkspaceId = workspace.Id,
                UserId = user.Id,
                Role = WorkspaceRole.Owner,
                Status = MembershipStatus.Active,
                JoinedAt = now
            }, cancellationToken);
        }
        else
        {
            workspaceMember.Role = WorkspaceRole.Owner;
            workspaceMember.Status = MembershipStatus.Active;
            workspaceMember.JoinedAt ??= now;
        }

        var recipientWorkspaceMember = await dbContext.WorkspaceMembers.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.WorkspaceId == workspace.Id && candidate.UserId == recipient.Id,
            cancellationToken);
        if (recipientWorkspaceMember is null)
        {
            await dbContext.WorkspaceMembers.AddAsync(new WorkspaceMember
            {
                TenantId = tenantId,
                WorkspaceId = workspace.Id,
                UserId = recipient.Id,
                Role = WorkspaceRole.Member,
                Status = MembershipStatus.Active,
                JoinedAt = now
            }, cancellationToken);
        }
        else
        {
            recipientWorkspaceMember.Role = WorkspaceRole.Member;
            recipientWorkspaceMember.Status = MembershipStatus.Active;
            recipientWorkspaceMember.JoinedAt ??= now;
        }

        var announcement = await dbContext.Announcements.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.WorkspaceId == workspace.Id && candidate.Title == announcementTitle,
            cancellationToken);
        if (announcement is null)
        {
            announcement = new Announcement
            {
                TenantId = tenantId,
                WorkspaceId = workspace.Id,
                AuthorUserId = user.Id,
                Title = announcementTitle,
                Body = "Synthetic announcement body for the real-backend browser smoke test.",
                Priority = AnnouncementPriority.Important,
                IsPinned = true,
                RequiresReadConfirmation = false,
                PublishedAt = now.AddMinutes(-5)
            };
            await dbContext.Announcements.AddAsync(announcement, cancellationToken);
        }
        else
        {
            announcement.AuthorUserId = user.Id;
            announcement.Body = "Synthetic announcement body for the real-backend browser smoke test.";
            announcement.Priority = AnnouncementPriority.Important;
            announcement.IsPinned = true;
            announcement.RequiresReadConfirmation = false;
            announcement.PublishedAt = now.AddMinutes(-5);
            announcement.ExpiresAt = null;
            if (announcement.IsDeleted)
            {
                announcement.Restore();
            }
        }

        var project = await dbContext.Projects.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.WorkspaceId == workspace.Id && candidate.Slug == projectSlug,
            cancellationToken);
        if (project is null)
        {
            project = new Project
            {
                TenantId = tenantId,
                WorkspaceId = workspace.Id,
                OwnerUserId = user.Id,
                CreatedByUserId = user.Id,
                Name = "Browser Smoke Project",
                Slug = projectSlug,
                Description = "Synthetic project for the real-backend browser smoke test.",
                Status = ProjectStatus.Active,
                StartDate = DateOnly.FromDateTime(now.UtcDateTime.Date),
                DueDate = DateOnly.FromDateTime(now.UtcDateTime.Date.AddDays(14))
            };
            await dbContext.Projects.AddAsync(project, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        else
        {
            project.OwnerUserId = user.Id;
            project.CreatedByUserId = user.Id;
            project.Name = "Browser Smoke Project";
            project.Description = "Synthetic project for the real-backend browser smoke test.";
            project.Status = ProjectStatus.Active;
            project.StartDate = DateOnly.FromDateTime(now.UtcDateTime.Date);
            project.DueDate = DateOnly.FromDateTime(now.UtcDateTime.Date.AddDays(14));
            if (project.IsDeleted)
            {
                project.Restore();
            }
        }

        var projectMember = await dbContext.ProjectMembers.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.ProjectId == project.Id && candidate.UserId == user.Id,
            cancellationToken);
        if (projectMember is null)
        {
            await dbContext.ProjectMembers.AddAsync(new ProjectMember
            {
                TenantId = tenantId,
                ProjectId = project.Id,
                UserId = user.Id,
                Role = ProjectRole.Owner,
                JoinedAt = now
            }, cancellationToken);
        }
        else
        {
            projectMember.Role = ProjectRole.Owner;
            if (projectMember.JoinedAt == default)
            {
                projectMember.JoinedAt = now;
            }
        }

        var recipientProjectMember = await dbContext.ProjectMembers.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.ProjectId == project.Id && candidate.UserId == recipient.Id,
            cancellationToken);
        if (recipientProjectMember is null)
        {
            await dbContext.ProjectMembers.AddAsync(new ProjectMember
            {
                TenantId = tenantId,
                ProjectId = project.Id,
                UserId = recipient.Id,
                Role = ProjectRole.Contributor,
                JoinedAt = now
            }, cancellationToken);
        }
        else
        {
            recipientProjectMember.Role = ProjectRole.Contributor;
            if (recipientProjectMember.JoinedAt == default)
            {
                recipientProjectMember.JoinedAt = now;
            }
        }

        var task = await dbContext.TaskItems.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.ProjectId == project.Id && candidate.Title == taskTitle,
            cancellationToken);
        if (task is null)
        {
            task = new TaskItem
            {
                TenantId = tenantId,
                WorkspaceId = workspace.Id,
                ProjectId = project.Id,
                Title = taskTitle,
                Description = "Synthetic task detail for the real-backend browser smoke test.",
                Status = TaskItemStatus.NotStarted,
                Priority = TaskPriority.Medium,
                StartDate = project.StartDate,
                DueDate = project.DueDate,
                ProgressPercent = 10,
                SortOrder = 1,
                CreatedByUserId = user.Id
            };
            await dbContext.TaskItems.AddAsync(task, cancellationToken);
        }
        else
        {
            task.WorkspaceId = workspace.Id;
            task.Description = "Synthetic task detail for the real-backend browser smoke test.";
            task.Status = TaskItemStatus.NotStarted;
            task.Priority = TaskPriority.Medium;
            task.StartDate = project.StartDate;
            task.DueDate = project.DueDate;
            task.ProgressPercent = 10;
            task.SortOrder = 1;
            task.CreatedByUserId = user.Id;
            if (task.IsDeleted)
            {
                task.Restore();
            }
        }

        var taskLabel = await dbContext.ProjectTaskLabels.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.ProjectId == project.Id && candidate.Name == taskLabelName,
            cancellationToken);
        if (taskLabel is null)
        {
            taskLabel = new ProjectTaskLabel
            {
                TenantId = tenantId,
                WorkspaceId = workspace.Id,
                ProjectId = project.Id,
                Name = taskLabelName,
                Description = "Synthetic label for the real-backend task detail acceptance.",
                SortKey = 1024,
                VersionNo = 1
            };
            await dbContext.ProjectTaskLabels.AddAsync(taskLabel, cancellationToken);
        }
        else
        {
            taskLabel.WorkspaceId = workspace.Id;
            taskLabel.Description = "Synthetic label for the real-backend task detail acceptance.";
            taskLabel.IsArchived = false;
        }

        var taskWorkItemLabel = await dbContext.WorkItemLabels.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.TaskItemId == task.Id && candidate.LabelId == taskLabel.Id,
            cancellationToken);
        if (taskWorkItemLabel is null)
        {
            await dbContext.WorkItemLabels.AddAsync(new WorkItemLabel
            {
                TenantId = tenantId,
                TaskItemId = task.Id,
                LabelId = taskLabel.Id,
                AddedAt = now,
                AddedByUserId = user.Id
            }, cancellationToken);
        }

        var taskFile = await dbContext.FileObjects.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.WorkspaceId == workspace.Id && candidate.ProjectId == project.Id && candidate.OriginalFileName == taskFileName,
            cancellationToken);
        if (taskFile is null)
        {
            taskFile = new FileObject
            {
                TenantId = tenantId,
                WorkspaceId = workspace.Id,
                ProjectId = project.Id,
                UploadedByUserId = user.Id,
                OriginalFileName = taskFileName,
                StorageKey = $"browser-smoke/{tenantId:D}/{project.Id:D}/{taskFileName}",
                ContentType = "text/plain",
                SizeBytes = taskFileBytes.LongLength,
                Classification = DataClassification.Private,
                Status = FileObjectStatus.Active
            };
            await dbContext.FileObjects.AddAsync(taskFile, cancellationToken);
        }
        else
        {
            taskFile.Status = FileObjectStatus.Active;
            taskFile.ProjectId = project.Id;
            taskFile.WorkspaceId = workspace.Id;
            taskFile.UploadedByUserId = user.Id;
            taskFile.ContentType = "text/plain";
            taskFile.SizeBytes = taskFileBytes.LongLength;
        }

        var taskAttachment = await dbContext.Attachments.FirstOrDefaultAsync(
            candidate => candidate.TenantId == tenantId && candidate.OwnerType == AttachmentOwnerType.TaskItem && candidate.OwnerId == task.Id && candidate.FileObjectId == taskFile.Id,
            cancellationToken);
        if (taskAttachment is null)
        {
            await dbContext.Attachments.AddAsync(new Attachment
            {
                TenantId = tenantId,
                FileObjectId = taskFile.Id,
                WorkspaceId = workspace.Id,
                OwnerType = AttachmentOwnerType.TaskItem,
                OwnerId = task.Id,
                OwnerUserId = user.Id,
                UploadedByUserId = user.Id,
                FileName = taskFileName,
                StoredFileName = taskFileName,
                FilePath = "browser-smoke/internal/task-file",
                ContentType = "text/plain",
                Extension = ".txt",
                SizeBytes = taskFileBytes.LongLength,
                StorageProvider = "browser-smoke",
                StorageKey = taskFile.StorageKey,
                ScanStatus = FileScanStatus.Clean
            }, cancellationToken);
        }
        else
        {
            taskAttachment.ScanStatus = FileScanStatus.Clean;
            taskAttachment.OwnerType = AttachmentOwnerType.TaskItem;
            taskAttachment.OwnerId = task.Id;
            taskAttachment.WorkspaceId = workspace.Id;
            taskAttachment.FileName = taskFileName;
            taskAttachment.StoredFileName = taskFileName;
            taskAttachment.FilePath = "browser-smoke/internal/task-file";
            taskAttachment.ContentType = "text/plain";
            taskAttachment.Extension = ".txt";
            taskAttachment.SizeBytes = taskFileBytes.LongLength;
            taskAttachment.StorageProvider = "browser-smoke";
            taskAttachment.StorageKey = taskFile.StorageKey;
            if (taskAttachment.IsDeleted)
            {
                taskAttachment.Restore();
            }
        }

        var taskAssignment = await dbContext.TaskAssignments.FirstOrDefaultAsync(
            candidate =>
                candidate.TenantId == tenantId &&
                candidate.TaskItemId == task.Id &&
                candidate.UserId == user.Id &&
                candidate.Role == TaskAssignmentRole.Assignee,
            cancellationToken);
        if (taskAssignment is null)
        {
            await dbContext.TaskAssignments.AddAsync(new TaskAssignment
            {
                TenantId = tenantId,
                TaskItemId = task.Id,
                UserId = user.Id,
                Role = TaskAssignmentRole.Assignee,
                AssignedByUserId = user.Id,
                AssignedAt = now
            }, cancellationToken);
        }
        else
        {
            taskAssignment.AssignedByUserId = user.Id;
            taskAssignment.AssignedAt = taskAssignment.AssignedAt == default ? now : taskAssignment.AssignedAt;
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        await using var taskFileStream = new MemoryStream(taskFileBytes, writable: false);
        var storageResult = await fileStorage.SaveAsync(
            taskFile.StorageKey,
            taskFileStream,
            taskFile.ContentType,
            cancellationToken);
        if (!storageResult.IsSuccess)
        {
            throw new InvalidOperationException("Browser smoke synthetic file could not be stored.");
        }
    }

    public static async Task EnsureBootstrapAdminAsync(
        AppDbContext dbContext,
        IPasswordHasher passwordHasher,
        Guid tenantId,
        string email,
        string? password = null,
        string? displayName = null,
        bool ensureDefaultWorkspace = true,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);

        var normalizedEmail = email.Trim().ToUpperInvariant();
        var user = await dbContext.Users.FirstOrDefaultAsync(candidate => candidate.NormalizedEmail == normalizedEmail, cancellationToken);
        if (user is null)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(password);
            user = new User
            {
                DisplayName = string.IsNullOrWhiteSpace(displayName) ? "Local Admin" : displayName.Trim(),
                Email = email.Trim(),
                NormalizedEmail = normalizedEmail,
                PasswordHash = passwordHasher.HashPassword(password),
                SystemRole = SystemRole.SystemAdmin,
                Status = UserStatus.Active,
                CreatedAt = DateTimeOffset.UtcNow
            };

            await dbContext.Users.AddAsync(user, cancellationToken);
        }
        else
        {
            var trimmedDisplayName = string.IsNullOrWhiteSpace(displayName) ? user.DisplayName : displayName.Trim();
            if (user.DisplayName != trimmedDisplayName)
            {
                user.DisplayName = trimmedDisplayName;
            }

            var trimmedEmail = email.Trim();
            if (user.Email != trimmedEmail)
            {
                user.Email = trimmedEmail;
            }

            if (!string.IsNullOrWhiteSpace(password) && !passwordHasher.VerifyPassword(user.PasswordHash, password))
            {
                user.PasswordHash = passwordHasher.HashPassword(password);
            }

            if (user.SystemRole != SystemRole.SystemAdmin)
            {
                user.SystemRole = SystemRole.SystemAdmin;
            }

            if (user.Status != UserStatus.Active)
            {
                user.Status = UserStatus.Active;
            }

            if (user.FailedLoginAttempts != 0)
            {
                user.FailedLoginAttempts = 0;
            }

            if (user.LockoutEndAt.HasValue)
            {
                user.LockoutEndAt = null;
            }

            if (user.IsDeleted)
            {
                user.Restore();
            }
        }

        var tenantUser = await dbContext.TenantUsers
            .FirstOrDefaultAsync(candidate => candidate.TenantId == tenantId && candidate.UserId == user.Id, cancellationToken);
        if (tenantUser is null)
        {
            tenantUser = new TenantUser
            {
                TenantId = tenantId,
                UserId = user.Id,
                Role = TenantUserRole.Owner,
                Status = TenantUserStatus.Active,
                JoinedAt = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow
            };

            await dbContext.TenantUsers.AddAsync(tenantUser, cancellationToken);
        }
        else
        {
            if (tenantUser.Role != TenantUserRole.Owner)
            {
                tenantUser.Role = TenantUserRole.Owner;
            }

            if (tenantUser.Status != TenantUserStatus.Active)
            {
                tenantUser.Status = TenantUserStatus.Active;
            }

            if (tenantUser.JoinedAt == default)
            {
                tenantUser.JoinedAt = DateTimeOffset.UtcNow;
            }
        }

        if (ensureDefaultWorkspace)
        {
            await EnsureDefaultWorkspaceOwnerAsync(dbContext, tenantId, user, cancellationToken);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static async Task EnsureDefaultWorkspaceOwnerAsync(
        AppDbContext dbContext,
        Guid tenantId,
        User user,
        CancellationToken cancellationToken)
    {
        const string workspaceSlug = "default-workspace";

        var workspace = await dbContext.Workspaces
            .FirstOrDefaultAsync(candidate => candidate.TenantId == tenantId && candidate.Slug == workspaceSlug, cancellationToken);
        if (workspace is null)
        {
            workspace = new Workspace
            {
                TenantId = tenantId,
                Name = "Default Workspace",
                Slug = workspaceSlug,
                Description = "Bootstrap workspace for initial admin operations.",
                Status = WorkspaceStatus.Active,
                CreatedByUserId = user.Id
            };
            await dbContext.Workspaces.AddAsync(workspace, cancellationToken);
        }
        else
        {
            if (workspace.Status != WorkspaceStatus.Active)
            {
                workspace.Status = WorkspaceStatus.Active;
            }

            if (workspace.IsDeleted)
            {
                workspace.Restore();
            }
        }

        var member = await dbContext.WorkspaceMembers
            .FirstOrDefaultAsync(candidate => candidate.TenantId == tenantId && candidate.WorkspaceId == workspace.Id && candidate.UserId == user.Id, cancellationToken);
        if (member is null)
        {
            member = new WorkspaceMember
            {
                TenantId = tenantId,
                WorkspaceId = workspace.Id,
                UserId = user.Id,
                Role = WorkspaceRole.Owner,
                Status = MembershipStatus.Active,
                JoinedAt = DateTimeOffset.UtcNow
            };
            await dbContext.WorkspaceMembers.AddAsync(member, cancellationToken);
        }
        else
        {
            if (member.Role != WorkspaceRole.Owner)
            {
                member.Role = WorkspaceRole.Owner;
            }

            if (member.Status != MembershipStatus.Active)
            {
                member.Status = MembershipStatus.Active;
            }

            if (!member.JoinedAt.HasValue)
            {
                member.JoinedAt = DateTimeOffset.UtcNow;
            }
        }
    }

    private static async Task SeedModulesAsync(AppDbContext dbContext, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var modules = new (string Key, string Name, string Route, string Icon, int Sort)[]
        {
            ("Dashboard", "Dashboard", "/dashboard", "layout-dashboard", 10),
            ("Workspaces", "Workspaces", "/workspaces", "building", 20),
            ("Groups", "Groups", "/groups", "users", 30),
            ("Channels", "Channels", "/channels", "messages-square", 40),
            ("Messaging", "Messaging", "/messages", "message-circle", 50),
            ("Announcements", "Announcements", "/announcements", "megaphone", 60),
            ("Notifications", "Notifications", "/notifications", "bell", 70),
            ("Files", "Files", "/files", "paperclip", 80),
            ("Projects", "Projects", "/projects", "folder-kanban", 90),
            ("ProductionTracking", "Production Tracking", "/production", "gantt-chart", 100),
            ("Feedback", "Feedback", "/feedback", "message-square-text", 110),
            ("Search", "Search", "/search", "search", 120),
            ("Admin", "Admin", "/admin", "shield", 130)
        };

        var existing = await dbContext.FeatureModules.ToDictionaryAsync(module => module.Key, cancellationToken);
        foreach (var module in modules.Where(module => !existing.ContainsKey(module.Key)))
        {
            await dbContext.FeatureModules.AddAsync(new FeatureModule
            {
                Key = module.Key,
                Name = module.Name,
                DefaultRoute = module.Route,
                Icon = module.Icon,
                RequiredRole = module.Key == "Admin" ? SystemRole.Admin : null,
                SortOrder = module.Sort,
                CreatedAt = now
            }, cancellationToken);
        }

        if (existing.TryGetValue("Admin", out var adminModule) && adminModule.RequiredRole != SystemRole.Admin)
        {
            adminModule.RequiredRole = SystemRole.Admin;
        }
    }

    private static async Task SeedPanelsAsync(AppDbContext dbContext, IReadOnlyDictionary<string, FeatureModule> modules, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var panels = new (string Key, string Title, string Module, int Sort)[]
        {
            ("dashboard.overview", "Overview", "Dashboard", 10),
            ("project.summary", "Project Summary", "Projects", 20),
            ("project.taskList", "Task List", "Projects", 30),
            ("project.gantt", "Gantt", "ProductionTracking", 40),
            ("project.members", "Members", "Projects", 50),
            ("project.artifacts", "Artifacts", "Files", 60),
            ("project.comments", "Comments", "Projects", 70),
            ("project.activityLogs", "Activity Logs", "Projects", 80),
            ("messaging.conversationList", "Conversations", "Messaging", 90),
            ("messaging.conversationDetail", "Conversation Detail", "Messaging", 100),
            ("notifications.list", "Notifications", "Notifications", 110)
        };

        var existing = await dbContext.PanelDefinitions.Select(panel => panel.Key).ToListAsync(cancellationToken);
        foreach (var panel in panels.Where(panel => !existing.Contains(panel.Key)))
        {
            await dbContext.PanelDefinitions.AddAsync(new PanelDefinition
            {
                FeatureModuleId = modules[panel.Module].Id,
                Key = panel.Key,
                Name = panel.Title,
                Route = "/" + panel.Key.Replace('.', '/'),
                DefaultPosition = "Center",
                MinWidth = 280,
                MinHeight = 180,
                DefaultWidth = 640,
                DefaultHeight = 420,
                SortOrder = panel.Sort,
                CreatedAt = now
            }, cancellationToken);
        }
    }

    private static async Task SeedCommandsAsync(AppDbContext dbContext, IReadOnlyDictionary<string, FeatureModule> modules, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var commands = new (string Key, string Label, string Module, CommandContextType Context, string? Route, int Sort)[]
        {
            ("project.open", "Open Project", "Projects", CommandContextType.Project, "/projects/{contextId}", 10),
            ("project.create", "Create Project", "Projects", CommandContextType.Global, "/projects/new", 20),
            ("project.members", "Project Members", "Projects", CommandContextType.Project, "/projects/{contextId}/members", 30),
            ("task.create", "Create Task", "Projects", CommandContextType.Project, "/projects/{contextId}/tasks/new", 40),
            ("task.changeStatus", "Change Status", "Projects", CommandContextType.TaskItem, null, 50),
            ("task.assignUser", "Assign User", "Projects", CommandContextType.TaskItem, null, 60),
            ("task.addComment", "Add Comment", "Projects", CommandContextType.TaskItem, null, 70),
            ("task.complete", "Complete Task", "Projects", CommandContextType.TaskItem, null, 80),
            ("artifact.upload", "Upload Artifact", "Files", CommandContextType.Project, null, 90),
            ("activityLog.create", "Create Activity Log", "Projects", CommandContextType.Project, null, 100),
            ("dm.open", "Open DM", "Messaging", CommandContextType.Global, "/messages", 110),
            ("notification.open", "Open Notification", "Notifications", CommandContextType.Global, "/notifications", 120),
            ("gantt.open", "Open Gantt", "ProductionTracking", CommandContextType.Project, "/projects/{contextId}/gantt", 130)
        };

        var existing = await dbContext.CommandDefinitions.Select(command => command.Key).ToListAsync(cancellationToken);
        foreach (var command in commands.Where(command => !existing.Contains(command.Key)))
        {
            await dbContext.CommandDefinitions.AddAsync(new CommandDefinition
            {
                FeatureModuleId = modules[command.Module].Id,
                Key = command.Key,
                Name = command.Label,
                ActionType = command.Route is null ? CommandActionType.ClientAction : CommandActionType.Navigate,
                Route = command.Route,
                ContextType = command.Context,
                SortOrder = command.Sort,
                CreatedAt = now
            }, cancellationToken);
        }
    }

    private static async Task SeedRadialMenusAsync(
        AppDbContext dbContext,
        IReadOnlyDictionary<string, CommandDefinition> commands,
        Guid tenantId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await SeedProfileAsync(dbContext, commands, "default.project", "Default Project", CommandContextType.Project, new[]
        {
            (RadialMenuDirection.Up, "project.open"),
            (RadialMenuDirection.UpRight, "project.members"),
            (RadialMenuDirection.Right, "dm.open"),
            (RadialMenuDirection.DownRight, "task.addComment"),
            (RadialMenuDirection.Down, "task.create"),
            (RadialMenuDirection.DownLeft, "activityLog.create"),
            (RadialMenuDirection.Left, "artifact.upload"),
            (RadialMenuDirection.UpLeft, "gantt.open")
        }, tenantId, now, cancellationToken);

        await SeedProfileAsync(dbContext, commands, "default.task", "Default Task", CommandContextType.TaskItem, new[]
        {
            (RadialMenuDirection.Up, "task.changeStatus"),
            (RadialMenuDirection.UpRight, "task.assignUser"),
            (RadialMenuDirection.Right, "task.addComment"),
            (RadialMenuDirection.DownRight, "artifact.upload"),
            (RadialMenuDirection.Down, "task.complete"),
            (RadialMenuDirection.DownLeft, "activityLog.create"),
            (RadialMenuDirection.Left, "project.open"),
            (RadialMenuDirection.UpLeft, "gantt.open")
        }, tenantId, now, cancellationToken);
    }

    private static async Task SeedProfileAsync(
        AppDbContext dbContext,
        IReadOnlyDictionary<string, CommandDefinition> commands,
        string key,
        string name,
        CommandContextType context,
        IReadOnlyList<(RadialMenuDirection Direction, string CommandKey)> items,
        Guid tenantId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (await dbContext.RadialMenuProfiles.AnyAsync(profile => profile.TenantId == tenantId && profile.ProfileKey == key, cancellationToken))
        {
            return;
        }

        var profile = new RadialMenuProfile
        {
            TenantId = tenantId,
            ProfileKey = key,
            Name = name,
            ContextType = context,
            Scope = context == CommandContextType.Project ? RadialMenuScope.Project : RadialMenuScope.Global,
            IsDefault = true,
            CreatedAt = now
        };

        await dbContext.RadialMenuProfiles.AddAsync(profile, cancellationToken);
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            await dbContext.RadialMenuItems.AddAsync(new RadialMenuItem
            {
                TenantId = tenantId,
                RadialMenuProfileId = profile.Id,
                CommandDefinitionId = commands[item.CommandKey].Id,
                CommandKey = item.CommandKey,
                Direction = item.Direction,
                Label = commands[item.CommandKey].Name,
                Icon = commands[item.CommandKey].Icon,
                SortOrder = i
            }, cancellationToken);
        }
    }
}
