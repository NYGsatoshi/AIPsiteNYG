namespace AipPortal.Web.Controllers;

/// <summary>HTTP categories for established, redacted legacy application errors.</summary>
public static class LegacyApplicationHttpStatus
{
    public static int For(string? error) => error switch
    {
        "Authentication is required." => 401,
        "Attachment not found." or "Attachment owner not found." or
        "File not found." or "Folder not found." or "Destination folder not found." or
        "Workspace not found." or "Group not found." or "Project not found." or
        "Conversation not found." or "Parent conversation not found." or
        "Conversation member not found." or "Recipient user not found." or
        "Message not found." or "Message thread not found." or "User not found." or
        "Channel not found." or "Channel or user not found." or "Channel member not found." or
        "Post not found." or "Event not found." or "Comment target not found." => 404,
        "Recipient user is not allowed." or
        "You are not allowed to upload an attachment for this resource." or
        "You are not allowed to manage this conversation." or
        "You are not allowed to send messages." or "You are not allowed to edit this message." or
        "You are not allowed to delete this message." or "You are not allowed to report this message." or
        "You are not allowed to report this conversation." or
        "You are not allowed to create channels." or "You are not allowed to manage this channel." or
        "You are not allowed to manage channel members." or "You are not allowed to post to this channel." or
        "You are not allowed to edit this post." or "You are not allowed to delete this post." or
        "You are not allowed to reply to this post." or "You are not allowed to pin this post." or
        "You are not allowed to create events in the selected scope." or
        "You are not allowed to update this event." or
        "You are not allowed to move this event to the selected scope." or
        "You are not allowed to archive this event." or
        "You are not allowed to view attendance for this event." or
        "You are not allowed to update attendance for this event." => 403,
        _ => 400
    };
}
