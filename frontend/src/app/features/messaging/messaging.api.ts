import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

export type ConversationInboxViewDto = 'All' | 'Unread' | 'Mentions' | 'Later';

export interface ConversationInboxCountsDto {
  readonly all?: unknown;
  readonly unread?: unknown;
  readonly mentions?: unknown;
  readonly later?: unknown;
}

export interface ConversationInboxResponseDto extends PagedResponseDto<ConversationDto> {
  readonly page?: unknown;
  readonly pageSize?: unknown;
  readonly totalCount?: unknown;
  readonly view?: unknown;
  readonly counts?: ConversationInboxCountsDto | null;
}

export type ConversationTypeDto =
  | 'DirectMessage'
  | 'ProjectChannel'
  | 'Thread'
  | 'CommitteeChannel'
  | 'AnnouncementThread'
  | 'ExternalSharedChannel'
  | 'LegalHoldConversation'
  | 'Group'
  | 'ProjectLinked'
  | 'System'
  | number;

export interface ConversationDto {
  readonly id?: unknown;
  readonly workspaceId?: unknown;
  readonly projectId?: unknown;
  readonly type?: ConversationTypeDto | unknown;
  readonly title?: unknown;
  readonly parentConversationId?: unknown;
  readonly rootConversationId?: unknown;
  readonly lastMessage?: MessageDto | null;
  readonly unreadCount?: unknown;
  readonly hasMention?: unknown;
  readonly isMuted?: unknown;
  readonly isArchived?: unknown;
  readonly isLater?: unknown;
  readonly isLocked?: unknown;
  readonly updatedAt?: unknown;
  readonly createdAt?: unknown;
}

export interface ConversationDetailDto extends ConversationDto {
  readonly members?: readonly ConversationMemberDto[];
}

export interface ConversationMemberDto {
  readonly userId?: unknown;
  readonly displayName?: unknown;
  readonly email?: unknown;
  readonly role?: unknown;
  readonly canRead?: unknown;
  readonly canPost?: unknown;
  readonly canManageMembers?: unknown;
  readonly canCreateThread?: unknown;
  readonly leftAt?: unknown;
  readonly removedAt?: unknown;
}

export interface AttachmentDto {
  readonly id?: unknown;
  readonly fileName?: unknown;
  readonly contentType?: unknown;
  readonly fileSize?: unknown;
}

export interface MessageDto {
  readonly id?: unknown;
  readonly workspaceId?: unknown;
  readonly conversationId?: unknown;
  readonly authorUserId?: unknown;
  readonly authorDisplayName?: unknown;
  readonly body?: unknown;
  readonly attachments?: readonly AttachmentDto[];
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
  readonly editedAt?: unknown;
  readonly isDeleted?: unknown;
  readonly clientRequestId?: unknown;
  readonly version?: unknown;
  readonly threadRootMessageId?: unknown;
  readonly thread?: MessageThreadSummaryDto | null;
}

export interface MessageThreadSummaryDto {
  readonly threadRootMessageId?: unknown;
  readonly replyCount?: unknown;
  readonly latestReplyAt?: unknown;
  readonly participantDisplayNames?: readonly unknown[];
}

export interface MessageThreadDto {
  readonly rootMessage?: MessageDto;
  readonly replies?: readonly MessageDto[];
  readonly summary?: MessageThreadSummaryDto;
  readonly hasMore?: unknown;
  readonly maximumReplies?: unknown;
}

export interface ThreadMessageCreatedDto {
  readonly message?: MessageDto;
  readonly summary?: MessageThreadSummaryDto;
}

export interface ConversationRecipientDto {
  readonly userId?: unknown;
  readonly displayName?: unknown;
}

export interface ParticipantStateDto {
  readonly participantId?: unknown;
  readonly userId?: unknown;
  readonly conversationId?: unknown;
  readonly lastOpenedAt?: unknown;
  readonly lastReadMessageId?: unknown;
  readonly lastReadAt?: unknown;
  readonly unreadCursorMessageId?: unknown;
  readonly unreadCount?: unknown;
  readonly isMuted?: unknown;
  readonly isArchived?: unknown;
  readonly isLater?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
}

export interface MessageNotificationPreferenceDto {
  readonly messageNotificationsEnabled?: unknown;
}

export interface MessageSearchResponseDto {
  readonly items?: unknown;
}

@Injectable({ providedIn: 'root' })
export class MessagingApi {
  private readonly http = inject(HttpClient);

  listConversations(view: ConversationInboxViewDto = 'All'): Observable<ConversationInboxResponseDto> {
    return this.http.get<ConversationInboxResponseDto>('/api/conversations', {
      params: view === 'All' ? undefined : { view },
      withCredentials: true
    });
  }

  searchRecipients(query: string): Observable<readonly ConversationRecipientDto[]> {
    return this.http.get<readonly ConversationRecipientDto[]>('/api/conversations/recipients', {
      params: { query },
      withCredentials: true
    });
  }

  searchMessages(query: string): Observable<MessageSearchResponseDto> {
    return this.http.get<MessageSearchResponseDto>('/api/search', {
      params: {
        q: query,
        type: 'Message',
        page: '1',
        pageSize: '50'
      },
      withCredentials: true
    });
  }

  createDirectConversation(recipientUserId: string): Observable<ConversationDetailDto> {
    return this.http.post<ConversationDetailDto>(
      '/api/conversations/direct',
      { recipientUserId },
      { withCredentials: true }
    );
  }

  getConversation(conversationId: string): Observable<ConversationDetailDto> {
    return this.http.get<ConversationDetailDto>(`/api/conversations/${conversationId}`, {
      withCredentials: true
    });
  }

  listMessages(conversationId: string, before?: string): Observable<PagedResponseDto<MessageDto>> {
    return this.http.get<PagedResponseDto<MessageDto>>(`/api/conversations/${conversationId}/messages`, {
      params: before ? { before } : undefined,
      withCredentials: true
    });
  }

  sendMessage(
    conversationId: string,
    body: string,
    clientRequestId?: string,
    mentionedUserIds: readonly string[] = []
  ): Observable<MessageDto> {
    return this.http.post<MessageDto>(
      `/api/conversations/${conversationId}/messages`,
      { body, clientRequestId, mentionedUserIds },
      { withCredentials: true }
    );
  }

  getMessageThread(messageId: string): Observable<MessageThreadDto> {
    return this.http.get<MessageThreadDto>(`/api/messages/${messageId}/thread`, {
      withCredentials: true
    });
  }

  sendThreadMessage(
    messageId: string,
    body: string,
    clientRequestId?: string,
    mentionedUserIds: readonly string[] = []
  ): Observable<ThreadMessageCreatedDto> {
    return this.http.post<ThreadMessageCreatedDto>(
      `/api/messages/${messageId}/thread/messages`,
      { body, clientRequestId, mentionedUserIds },
      { withCredentials: true }
    );
  }

  updateMessage(messageId: string, body: string): Observable<MessageDto> {
    return this.http.patch<MessageDto>(
      `/api/messages/${messageId}`,
      { body },
      { withCredentials: true }
    );
  }

  deleteMessage(messageId: string): Observable<unknown> {
    return this.http.delete(`/api/messages/${messageId}`, {
      withCredentials: true
    });
  }

  reportMessage(messageId: string, reasonCode: string): Observable<unknown> {
    return this.http.post(
      `/api/messages/${messageId}/report`,
      { reasonCode },
      { withCredentials: true }
    );
  }

  getParticipantState(conversationId: string): Observable<ParticipantStateDto> {
    return this.http.get<ParticipantStateDto>(`/api/conversations/${conversationId}/state`, {
      withCredentials: true
    });
  }

  updateParticipantState(conversationId: string, isMuted: boolean): Observable<ParticipantStateDto> {
    return this.http.patch<ParticipantStateDto>(
      `/api/conversations/${conversationId}/state`,
      { isMuted },
      { withCredentials: true }
    );
  }

  updateConversationLater(conversationId: string, isLater: boolean): Observable<ParticipantStateDto> {
    return this.http.patch<ParticipantStateDto>(
      `/api/conversations/${conversationId}/state`,
      { isLater },
      { withCredentials: true }
    );
  }

  getMessageNotificationPreference(): Observable<MessageNotificationPreferenceDto> {
    return this.http.get<MessageNotificationPreferenceDto>('/api/me/message-notification-preferences', {
      withCredentials: true
    });
  }

  updateMessageNotificationPreference(messageNotificationsEnabled: boolean): Observable<MessageNotificationPreferenceDto> {
    return this.http.patch<MessageNotificationPreferenceDto>(
      '/api/me/message-notification-preferences',
      { messageNotificationsEnabled },
      { withCredentials: true }
    );
  }

  markRead(conversationId: string, lastReadMessageId: string | null): Observable<unknown> {
    return this.http.post(
      `/api/conversations/${conversationId}/read`,
      { lastReadMessageId },
      { withCredentials: true }
    );
  }
}
