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

  sendMessage(conversationId: string, body: string, clientRequestId?: string): Observable<MessageDto> {
    return this.http.post<MessageDto>(
      `/api/conversations/${conversationId}/messages`,
      { body, clientRequestId },
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
