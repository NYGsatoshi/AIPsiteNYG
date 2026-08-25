import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface PagedResponseDto<T> {
  readonly items?: readonly T[];
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
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
}

export interface MessageNotificationPreferenceDto {
  readonly messageNotificationsEnabled?: unknown;
}

@Injectable({ providedIn: 'root' })
export class MessagingApi {
  private readonly http = inject(HttpClient);

  listConversations(): Observable<PagedResponseDto<ConversationDto>> {
    return this.http.get<PagedResponseDto<ConversationDto>>('/api/conversations', {
      withCredentials: true
    });
  }

  searchRecipients(query: string): Observable<readonly ConversationRecipientDto[]> {
    return this.http.get<readonly ConversationRecipientDto[]>('/api/conversations/recipients', {
      params: { query },
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
