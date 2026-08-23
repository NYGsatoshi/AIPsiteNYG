using AipPortal.Application.Channels;
using AipPortal.Application.Common;
using AipPortal.Application.Common.Interfaces;
using AipPortal.Application.Groups;
using AipPortal.Application.Workspaces;
using AipPortal.Domain.Entities;
using AipPortal.Domain.Enums;

namespace AipPortal.Application.Announcements;

public sealed class AnnouncementAudienceService(
    IAnnouncementRepository announcements,
    IWorkspaceRepository workspaces,
    IGroupRepository groups,
    IChannelRepository channels,
    IUserRepository users,
    ITenantRepository tenants,
    IWorkspaceAuthorizationService workspaceAuthorization,
    IGroupAuthorizationService groupAuthorization,
    IChannelAuthorizationService channelAuthorization,
    ICurrentUser currentUser,
    ICurrentTenant currentTenant) : IAnnouncementAudienceService
{
    public async Task<Result<IReadOnlyList<AnnouncementAudienceOptionResponse>>> ListAsync(CancellationToken cancellationToken = default)
    {
        if (!currentUser.IsAuthenticated || !currentUser.UserId.HasValue)
        {
            return Result<IReadOnlyList<AnnouncementAudienceOptionResponse>>.Failure("Authentication is required.");
        }

        if (!currentTenant.IsAvailable || currentTenant.IsPlatformScope)
        {
            return Result<IReadOnlyList<AnnouncementAudienceOptionResponse>>.Failure("A tenant context is required to resolve announcement audiences.");
        }

        var userId = currentUser.UserId.Value;
        var isSystemAdmin = await IsSystemAdminAsync(userId, cancellationToken);
        if (!isSystemAdmin)
        {
            var tenantMembership = await tenants.GetTenantUserAsync(currentTenant.TenantId, userId, cancellationToken);
            if (tenantMembership is not { Status: TenantUserStatus.Active })
            {
                return Result<IReadOnlyList<AnnouncementAudienceOptionResponse>>.Success([]);
            }
        }

        var options = new List<AnnouncementAudienceOptionResponse>();

        if (isSystemAdmin)
        {
            options.Add(await CreateOptionAsync(
                "global",
                "global",
                null,
                null,
                null,
                "テナント全体",
                cancellationToken));
        }

        var visibleWorkspaces = await workspaces.ListForUserAsync(userId, isSystemAdmin, cancellationToken);
        foreach (var workspace in visibleWorkspaces)
        {
            if (workspace.DeletedAt.HasValue || workspace.Status != WorkspaceStatus.Active)
            {
                continue;
            }

            if (await CanCreateWorkspaceAnnouncementAsync(userId, workspace.Id, cancellationToken))
            {
                options.Add(await CreateOptionAsync(
                    $"workspace:{workspace.Id:D}",
                    "workspace",
                    workspace.Id,
                    null,
                    null,
                    workspace.Name,
                    cancellationToken));
            }

            var workspaceGroups = await groups.ListByWorkspaceAsync(workspace.Id, cancellationToken);
            foreach (var group in workspaceGroups)
            {
                if (group.DeletedAt.HasValue || group.Status != GroupStatus.Active || group.WorkspaceId != workspace.Id)
                {
                    continue;
                }

                if (await CanCreateGroupAnnouncementAsync(userId, group.Id, cancellationToken))
                {
                    options.Add(await CreateOptionAsync(
                        $"group:{group.Id:D}",
                        "group",
                        workspace.Id,
                        group.Id,
                        null,
                        $"{workspace.Name} / {group.Name}",
                        cancellationToken));
                }

                var groupChannels = await channels.ListByGroupAsync(group.Id, cancellationToken);
                foreach (var channel in groupChannels)
                {
                    if (channel.DeletedAt.HasValue ||
                        channel.Status != ChannelStatus.Active ||
                        channel.GroupId != group.Id ||
                        channel.WorkspaceId != workspace.Id ||
                        !await channelAuthorization.CanManageChannel(userId, channel.Id, cancellationToken))
                    {
                        continue;
                    }

                    options.Add(await CreateOptionAsync(
                        $"channel:{channel.Id:D}",
                        "channel",
                        workspace.Id,
                        group.Id,
                        channel.Id,
                        $"{workspace.Name} / {group.Name} / #{channel.Name}",
                        cancellationToken));
                }
            }
        }

        return Result<IReadOnlyList<AnnouncementAudienceOptionResponse>>.Success(options);
    }

    private async Task<AnnouncementAudienceOptionResponse> CreateOptionAsync(
        string key,
        string scopeType,
        Guid? workspaceId,
        Guid? groupId,
        Guid? channelId,
        string displayName,
        CancellationToken cancellationToken)
    {
        var prototype = new Announcement
        {
            TenantId = currentTenant.TenantId,
            WorkspaceId = workspaceId,
            GroupId = groupId,
            ChannelId = channelId
        };
        var recipients = await announcements.ListTargetUsersAsync(prototype, cancellationToken);
        return new AnnouncementAudienceOptionResponse(
            key,
            scopeType,
            workspaceId,
            groupId,
            channelId,
            displayName,
            recipients.Count);
    }

    private async Task<bool> CanCreateWorkspaceAnnouncementAsync(Guid userId, Guid workspaceId, CancellationToken cancellationToken)
    {
        if (await workspaceAuthorization.CanManageWorkspace(userId, workspaceId, cancellationToken))
        {
            return true;
        }

        return await IsTeacherAsync(userId, cancellationToken) &&
            await workspaceAuthorization.CanViewWorkspace(userId, workspaceId, cancellationToken);
    }

    private async Task<bool> CanCreateGroupAnnouncementAsync(Guid userId, Guid groupId, CancellationToken cancellationToken)
    {
        if (await groupAuthorization.CanManageGroup(userId, groupId, cancellationToken))
        {
            return true;
        }

        return await IsTeacherAsync(userId, cancellationToken) &&
            await groupAuthorization.CanViewGroup(userId, groupId, cancellationToken);
    }

    private async Task<bool> IsSystemAdminAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await users.GetByIdAsync(userId, cancellationToken);
        return user is { Status: UserStatus.Active, DeletedAt: null, SystemRole: SystemRole.SystemAdmin };
    }

    private async Task<bool> IsTeacherAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await users.GetByIdAsync(userId, cancellationToken);
        return user is
        {
            Status: UserStatus.Active,
            DeletedAt: null,
            SystemRole: SystemRole.Teacher or SystemRole.Admin or SystemRole.SystemAdmin
        };
    }
}
