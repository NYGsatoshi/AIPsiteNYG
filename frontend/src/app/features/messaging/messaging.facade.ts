import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';

import { DraftStorageService } from './draft-storage.service';
import {
  MessageFailureCode,
  MessagingCapability,
  MessagingConversationListItem,
  MessagingDraftScope,
  MessagingMessageViewModel,
  MessagingPageStatus,
  MessagingPageViewModel,
  MessagingRouteKind,
} from './messaging.types';

export const AIP_MESSAGING_PAGE_MOCK = new InjectionToken<MessagingPageViewModel>(
  'AIP_MESSAGING_PAGE_MOCK',
);

interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

interface ConversationDto {
  readonly id?: unknown;
  readonly workspaceId?: unknown;
  readonly type?: unknown;
  readonly title?: unknown;
  readonly lastMessage?: MessageDto | null;
  readonly unreadCount?: unknown;
  readonly updatedAt?: unknown;
  readonly createdAt?: unknown;
}

interface ConversationDetailDto extends ConversationDto {
  readonly isLocked?: unknown;
  readonly members?: readonly ConversationMemberDto[];
}

interface ConversationMemberDto {
  readonly canRead?: unknown;
  readonly canPost?: unknown;
  readonly removedAt?: unknown;
}

interface MessageDto {
  readonly id?: unknown;
  readonly authorDisplayName?: unknown;
  readonly body?: unknown;
  readonly createdAt?: unknown;
  readonly isDeleted?: unknown;
}

@Injectable({ providedIn: 'root' })
export class MessagingFacade {
  private readonly http = inject(HttpClient);
  private readonly draftStorage = inject(DraftStorageService);
  private readonly mockPage = inject(AIP_MESSAGING_PAGE_MOCK, { optional: true });
  private readonly initialPage = this.mockPage ?? emptyMessagingPage('channel', 'loading');
  private readonly pageState = signal<MessagingPageViewModel>(
    this.withStoredDraft(this.initialPage),
  );
  private readonly loadedConversationId = signal<string | null>(
    this.mockPage?.conversation.id ?? null,
  );

  readonly page = computed(() => this.withSortedMessages(this.pageState()));

  loadConversation(conversationId: string | null, routeKind: MessagingRouteKind): void {
    if (this.mockPage) {
      return;
    }

    if (!conversationId) {
      this.loadedConversationId.set(null);
      this.pageState.set(
        emptyMessagingPage(routeKind, 'empty', 'Conversation API route id is missing.'),
      );
      return;
    }

    if (this.loadedConversationId() === conversationId) {
      return;
    }

    this.loadedConversationId.set(conversationId);
    this.pageState.set(emptyMessagingPage(routeKind, 'loading'));
    this.loadConversationList(routeKind);
    this.http
      .get<ConversationDetailDto>(`/api/conversations/${conversationId}`, { withCredentials: true })
      .subscribe({
        next: (conversation) => this.loadMessages(conversationId, conversation, routeKind),
        error: (error: { status?: number }) => {
          this.pageState.set(
            emptyMessagingPage(
              routeKind,
              error.status === 401 || error.status === 403 ? 'permissionDenied' : 'empty',
              error.status === 401 || error.status === 403
                ? 'Authentication or conversation permission is required.'
                : 'Conversation API request failed.',
            ),
          );
        },
      });
  }

  setDraft(value: string): void {
    const page = this.pageState();
    this.draftStorage.writeDraft(this.scopeFor(page), value);
    this.pageState.set({ ...page, draft: value });
  }

  manualRefresh(): void {
    if (!this.mockPage) {
      this.loadedConversationId.set(null);
      this.loadConversation(this.pageState().conversation.id || null, this.pageState().routeKind);
      return;
    }

    this.pageState.set({ ...this.pageState(), hasNewMessagesWhileReading: true });
  }

  acknowledgeNewMessages(): void {
    this.pageState.update((page) => ({ ...page, hasNewMessagesWhileReading: false }));
  }

  loadOlder(): void {
    this.pageState.update((page) => ({
      ...page,
      pagingWindow: {
        ...page.pagingWindow,
        beforeMessageId: page.messages[0]?.id,
        preloadBefore: 30,
      },
    }));
  }

  loadNewer(): void {
    this.pageState.update((page) => ({
      ...page,
      pagingWindow: {
        ...page.pagingWindow,
        afterMessageId: page.messages.at(-1)?.id,
        preloadAfter: 30,
      },
    }));
  }

  sendDraft(): void {
    const page = this.pageState();
    const body = page.draft.trim();
    if (!body || page.sending || !this.canPost(page)) {
      return;
    }

    if (!this.mockPage) {
      this.pageState.set({ ...page, sending: true });
      this.http
        .post<MessageDto>(
          `/api/conversations/${page.conversation.id}/messages`,
          { body },
          { withCredentials: true },
        )
        .subscribe({
          next: (message) => {
            this.draftStorage.clearDraft(this.scopeFor(page));
            this.pageState.update((current) => ({
              ...current,
              draft: '',
              sending: false,
              status: current.status === 'empty' ? 'ready' : current.status,
              messages: [...current.messages, this.toMessage(message)],
            }));
          },
          error: (error: { status?: number }) => {
            this.pageState.update((current) => ({
              ...current,
              sending: false,
              inlineError:
                error.status === 401 || error.status === 403
                  ? 'Authentication or posting permission is required.'
                  : 'Message API request failed.',
            }));
          },
        });
      return;
    }

    const clientRequestId = `client-${Date.now()}`;
    const localMessage: MessagingMessageViewModel = {
      id: `local-${clientRequestId}`,
      clientRequestId,
      authorLabel: 'Current user',
      authorRoleLabel: 'member',
      isOwnMessage: true,
      body,
      sentAtLabel: 'sent',
      deliveryState: 'confirmed',
      retryAllowed: false,
    };

    this.draftStorage.clearDraft(this.scopeFor(page));
    this.pageState.set({
      ...page,
      draft: '',
      sending: false,
      messages: [...page.messages, localMessage],
      status: page.status === 'empty' ? 'ready' : page.status,
    });
  }

  retryMessage(messageId: string): void {
    this.pageState.set({
      ...this.pageState(),
      messages: this.pageState().messages.map((message) =>
        message.id === messageId && message.deliveryState === 'failed'
          ? {
              ...message,
              deliveryState: 'confirmed',
              safeFailureReason: undefined,
              failureCode: undefined,
              retryAllowed: false,
            }
          : message,
      ),
    });
  }

  clearDraftsForSessionBoundary(): void {
    this.draftStorage.clearAllDrafts();
    this.pageState.update((page) => ({ ...page, draft: '' }));
  }

  private loadConversationList(routeKind: MessagingRouteKind): void {
    this.http
      .get<PagedResponseDto<ConversationDto>>('/api/conversations', { withCredentials: true })
      .subscribe({
        next: (response) => {
          const conversations = (response.items ?? []).map((conversation) =>
            this.toConversationListItem(conversation),
          );
          this.pageState.update((page) => ({ ...page, conversations, routeKind }));
        },
        error: () => {
          this.pageState.update((page) => ({ ...page, conversations: [] }));
        },
      });
  }

  private loadMessages(
    conversationId: string,
    conversation: ConversationDetailDto,
    routeKind: MessagingRouteKind,
  ): void {
    this.http
      .get<
        PagedResponseDto<MessageDto>
      >(`/api/conversations/${conversationId}/messages`, { withCredentials: true })
      .subscribe({
        next: (response) => {
          const page = this.toPage(conversation, response.items ?? [], routeKind);
          this.pageState.set(this.withStoredDraft(page));
        },
        error: () => {
          const page = this.toPage(conversation, [], routeKind);
          this.pageState.set({
            ...this.withStoredDraft(page),
            inlineError: 'Message API request failed.',
          });
        },
      });
  }

  private toPage(
    conversation: ConversationDetailDto,
    messages: readonly MessageDto[],
    routeKind: MessagingRouteKind,
  ): MessagingPageViewModel {
    const conversationId = stringValue(conversation.id) ?? '';
    const workspaceId = stringValue(conversation.workspaceId);
    const members = conversation.members ?? [];
    const viewer = members.find((member) => member.canRead === true || member.canPost === true);
    const viewerWasRemoved = viewer?.removedAt !== null && viewer?.removedAt !== undefined;
    const viewerIsParticipant = viewer !== undefined && !viewerWasRemoved;
    const canRead = viewer?.canRead === true;
    const canPost = viewer?.canPost === true && conversation.isLocked !== true;
    const capabilities: MessagingCapability[] = [];
    if (canRead) {
      capabilities.push('readBody', 'viewOwnReadMarker');
    }
    if (canPost) {
      capabilities.push('postMessage');
    }

    return {
      routeKind,
      status: viewerIsParticipant
        ? messages.length === 0
          ? 'empty'
          : 'ready'
        : 'permissionDenied',
      title:
        stringValue(conversation.title) ?? (routeKind === 'dm' ? 'Direct message' : 'Conversation'),
      conversation: {
        id: conversationId,
        kind: routeKind,
        tenantId: '',
        workspaceId,
        title: stringValue(conversation.title) ?? 'Conversation',
        subtitle: 'Live API data',
        viewerIsParticipant,
        viewerWasRemoved,
        capabilities,
        composerDisabledReason: canPost
          ? undefined
          : 'Posting is not available for this conversation.',
        attachment: {
          mode: 'disabled',
          label: 'Attachment API is not wired for this composer.',
        },
      },
      conversations: this.pageState().conversations,
      messages: messages.map((message) => this.toMessage(message)),
      draft: '',
      sending: false,
      hasNewMessagesWhileReading: false,
      readCursorBehavior: 'latestVisibleMessage',
      pagingWindow: {
        visibleMessageIds: messages.map((message) => stringValue(message.id) ?? ''),
        preloadBefore: 0,
        preloadAfter: 0,
      },
    };
  }

  private toConversationListItem(conversation: ConversationDto): MessagingConversationListItem {
    const id = stringValue(conversation.id) ?? '';
    const kind = routeKindFromApi(conversation.type);

    return {
      id,
      kind,
      title: stringValue(conversation.title) ?? (kind === 'dm' ? 'Direct message' : 'Conversation'),
      route:
        kind === 'dm'
          ? `/dm/${id}`
          : `/workspaces/${stringValue(conversation.workspaceId) ?? ''}/channels/${id}`,
      lastActivityLabel: formatDate(conversation.updatedAt) || formatDate(conversation.createdAt),
      safePreviewLabel: stringValue(conversation.lastMessage?.body) ?? '',
      viewerIsParticipant: true,
      unreadCount: numberValue(conversation.unreadCount),
    };
  }

  private toMessage(message: MessageDto): MessagingMessageViewModel {
    return {
      id: stringValue(message.id) ?? `message-${Date.now()}`,
      authorLabel: stringValue(message.authorDisplayName) ?? 'Unknown user',
      authorRoleLabel: 'member',
      isOwnMessage: false,
      body: message.isDeleted === true ? '' : (stringValue(message.body) ?? ''),
      sentAtLabel: formatDate(message.createdAt),
      deliveryState: 'confirmed',
      retryAllowed: false,
    };
  }

  private withStoredDraft(page: MessagingPageViewModel): MessagingPageViewModel {
    return { ...page, draft: this.draftStorage.readDraft(this.scopeFor(page)) || page.draft };
  }

  private withSortedMessages(page: MessagingPageViewModel): MessagingPageViewModel {
    return {
      ...page,
      messages: [...page.messages],
    };
  }

  private canPost(page: MessagingPageViewModel): boolean {
    return (
      page.conversation.viewerIsParticipant &&
      !page.conversation.viewerWasRemoved &&
      page.conversation.capabilities.includes('postMessage')
    );
  }

  private scopeFor(page: MessagingPageViewModel): MessagingDraftScope {
    return {
      tenantId: page.conversation.tenantId,
      workspaceId: page.conversation.workspaceId,
      conversationId: page.conversation.id,
    };
  }

  private safeFailureReason(_code: MessageFailureCode): string {
    return 'Message delivery failed.';
  }
}

function emptyMessagingPage(
  routeKind: MessagingRouteKind,
  status: MessagingPageStatus,
  inlineError?: string,
): MessagingPageViewModel {
  return {
    routeKind,
    status,
    title: routeKind === 'dm' ? 'Direct message' : 'Conversation',
    conversation: {
      id: '',
      kind: routeKind,
      tenantId: '',
      title: routeKind === 'dm' ? 'Direct message' : 'Conversation',
      subtitle: 'Live API data',
      viewerIsParticipant: false,
      viewerWasRemoved: false,
      capabilities: [],
      composerDisabledReason: 'Conversation API data is not loaded.',
      attachment: {
        mode: 'disabled',
        label: 'Attachment API is not wired for this composer.',
      },
    },
    conversations: [],
    messages: [],
    draft: '',
    sending: false,
    hasNewMessagesWhileReading: false,
    inlineError,
    readCursorBehavior: 'conversationOpenFallback',
    pagingWindow: {
      visibleMessageIds: [],
      preloadBefore: 0,
      preloadAfter: 0,
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatDate(value: unknown): string {
  const raw = stringValue(value);
  return raw ? new Date(raw).toLocaleString() : '';
}

function routeKindFromApi(value: unknown): MessagingRouteKind {
  const normalized = String(value ?? '').toLowerCase();
  return normalized.includes('direct') ? 'dm' : 'channel';
}
