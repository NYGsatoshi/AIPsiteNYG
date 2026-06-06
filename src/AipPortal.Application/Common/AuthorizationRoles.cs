using AipPortal.Domain.Enums;

namespace AipPortal.Application.Common;

public static class AuthorizationRoles
{
    public static bool CanManage(this WorkspaceRole role)
    {
        return role is WorkspaceRole.Owner or WorkspaceRole.Admin;
    }

    public static bool CanContribute(this WorkspaceRole role)
    {
        return role is WorkspaceRole.Owner or WorkspaceRole.Admin or WorkspaceRole.Adviser or WorkspaceRole.Member;
    }

    public static bool CanManage(this GroupRole role)
    {
        return role is GroupRole.Owner or GroupRole.Admin;
    }

    public static bool CanContribute(this GroupRole role)
    {
        return role is GroupRole.Owner or GroupRole.Admin or GroupRole.Adviser or GroupRole.Member;
    }

    public static bool CanManage(this ChannelRole role)
    {
        return role is ChannelRole.Admin;
    }

    public static bool CanPost(this ChannelRole role)
    {
        return role is ChannelRole.Admin or ChannelRole.Member;
    }
}
