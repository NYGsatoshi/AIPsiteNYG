import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { DraftStorageService } from './draft-storage.service';
import { MessagingApi } from './messaging.api';
import {
  mapConversationListItem,
  mapConversationPage,
  mapMessage
} from './messaging.mapper';
import {
  MessagingDraftScope,
  MessagingMessageViewModel,
  MessagingPageStatus,
  MessagingPageViewModel,
  MessagingRouteKind
} from './messaging.types';

export const AIP_MESSAGING_PAGE_MOCK = new InjectionToken<MessagingPageViewModel>(
  'AIP_MESSAGING_PAGE_MOCK'
);

@Injectable({ providedIn: 'root' })
export class MessagingFacade {
  private readonly api = inject(MessagingApi);
  private readonly authSession = inject(AuthSessionFacade);
  private readonly draftStorage = inject(DraftStorageService);
  private readonly mockPage = inject(AIP_MESSAGING_PAGE_MOCK, { optional: true });
  private readonly initialPage = this.mockPage ?? emptyMessagingPage('channel', 'loading');
  private readonly pageState = signal<MessagingPageViewModel>(
    this.withStoredDraft(this.initialPage)
  );
  private readonly loadedConversationId = signal<string | null>(
    this.mockPage?.conversation.id ?? null
  );

  readonly page = computed(() => this.withSortedMessages(this.pageState()));

  loadConversationListPage(routeKind: MessagingRouteKind = 'channel'): void {
    if (this.mockPage) {
      return;
    }

    this.loadedConversationId.set(null);
    this.pageState.set(emptyMessagingPage(routeKind, 'loading'));
    this.loadConversationList(routeKind, true);
  }

  loadConversation(conversationId: string | null, routeKind: MessagingRouteKind): void {
    if (this.mockPage) {
      return;
    }

    if (!conversationId) {
      this.loadedConversationId.set(null);
      this.pageState.set(
        emptyMessagingPage(routeKind, 'empty', 'Conversation API route id is missing.')
      );
      return;
    }

    if (this.loadedConversationId() === conversationId) {
      return;
    }

    this.loadedConversationId.set(conversationId);
    this.pageState.set(emptyMessagingPage(routeKind, 'loading'));
    this.loadConversationList(routeKind, false);
    this.api.getConversation(conversationId).subscribe({
      next: (conversation) => {
        this.api.listMessages(conversationId).subscribe({
          next: (response) => {
            const page = mapConversationPage(conversation, response.items ?? [], {
              currentUserId: this.currentUserId(),
              currentTenantId: this.currentTenantId(),
              fallbackRouteKind: routeKind,
              existingConversations: this.pageState().conversations
            });
            this.pageState.set(this.withStoredDraft(page));
          },
          error: () => {
            const page = mapConversationPage(conversation, [], {
              currentUserId: this.currentUserId(),
              currentTenantId: this.currentTenantId(),
              fallbackRouteKind: routeKind,
              existingConversations: this.pageState().conversations
            });
            this.pageState.set({
              ...this.withStoredDraft(page),
              inlineError: 'Message API request failed.'
            });
          }
        });
      },
      error: (error: { status?: number }) => {
        this.pageState.set(
          emptyMessagingPage(
            routeKind,
            error.status === 401 || error.status === 403 ? 'permissionDenied' : 'empty',
            error.status === 401 || error.status === 403
              ? 'Authentication or conversation permission is required.'
              : 'Conversation API request failed.'
          )
        );
      }
    });
  }

  setDraft(value: string): void {
    const page = this.pageState();
    this.draftStorage.writeDraft(this.scopeFor(page), value);
    this.pageState.set({ ...page, draft: value });
  }

  manualRefresh(): void {
    if (!this.mockPage) {
      const page = this.pageState();
      if (page.conversation.id) {
        this.loadedConversationId.set(null);
        this.loadConversation(page.conversation.id, page.routeKind);
      } else {
        this.loadConversationListPage(page.routeKind);
      }
      return;
    }

    this.pageState.update((page) => ({
      ...page,
      inlineError: 'Manual refresh requires the backend API.'
    }));
  }

  acknowledgeNewMessages(): void {
    this.pageState.update((page) => ({ ...page, hasNewMessagesWhileReading: false }));
  }

  loadOlder(): void {
    this.pageState.update((page) => ({
      ...page,
      inlineError: 'Message paging is disabled for MVP0.'
    }));
  }

  loadNewer(): void {
    this.pageState.update((page) => ({
      ...page,
      inlineError: 'Message paging is disabled for MVP0.'
    }));
  }

  sendDraft(): void {
    const page = this.pageState();
    const body = page.draft.trim();
    if (!body || page.sending || !this.canPost(page)) {
      return;
    }

    if (this.mockPage) {
      this.pageState.update((current) => ({
        ...current,
        inlineError: 'Message sending requires the backend API.',
        sendState: { status: 'failed', message: 'Message sending requires the backend API.' }
      }));
      return;
    }

    const clientRequestId = `client-${Date.now()}`;
    const pendingMessage: MessagingMessageViewModel = {
      id: `pending-${clientRequestId}`,
      clientRequestId,
      authorLabel: this.currentUserDisplayName(),
      authorRoleLabel: 'member',
      isOwnMessage: true,
      body,
      sentAtLabel: 'Sending',
      deliveryState: 'sending',
      retryAllowed: false
    };

    this.pageState.set({
      ...page,
      sending: true,
      sendState: { status: 'sending', clientRequestId },
      inlineError: undefined,
      messages: [...page.messages, pendingMessage],
      status: page.status === 'empty' ? 'ready' : page.status
    });

    this.api.sendMessage(page.conversation.id, body).subscribe({
      next: (message) => {
        const confirmedMessage = mapMessage(message, this.currentUserId());
        this.draftStorage.clearDraft(this.scopeFor(page));
        this.pageState.update((current) => ({
          ...current,
          draft: '',
          sending: false,
          sendState: { status: 'sent', messageId: confirmedMessage.id },
          status: current.status === 'empty' ? 'ready' : current.status,
          messages: current.messages.map((existing) =>
            existing.id === pendingMessage.id ? confirmedMessage : existing
          )
        }));
      },
      error: (error: { status?: number }) => {
        const message = sendFailureMessage(error.status);
        this.pageState.update((current) => ({
          ...current,
          sending: false,
          sendState: { status: 'failed', message },
          inlineError: message,
          messages: current.messages.filter((existing) => existing.id !== pendingMessage.id)
        }));
      }
    });
  }

  retryMessage(_messageId: string): void {
    this.pageState.update((page) => ({
      ...page,
      inlineError: 'Manual message retry is disabled for MVP0.'
    }));
  }

  clearDraftsForSessionBoundary(): void {
    this.draftStorage.clearAllDrafts();
    this.pageState.update((page) => ({ ...page, draft: '' }));
  }

  private loadConversationList(routeKind: MessagingRouteKind, listOnly: boolean): void {
    this.api.listConversations().subscribe({
      next: (response) => {
        const conversations = (response.items ?? []).map((conversation) =>
          mapConversationListItem(conversation)
        );
        this.pageState.update((page) => ({
          ...page,
          routeKind,
          conversations,
          status: listOnly ? 'empty' : page.status,
          title: listOnly ? 'Messages' : page.title,
          inlineError: undefined
        }));
      },
      error: (error: { status?: number }) => {
        this.pageState.update((page) => ({
          ...page,
          conversations: [],
          status: listOnly
            ? error.status === 401 || error.status === 403
              ? 'permissionDenied'
              : 'manualRefreshError'
            : page.status,
          inlineError: 'Conversation list API request failed.'
        }));
      }
    });
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
      conversationId: page.conversation.id
    };
  }

  private withStoredDraft(page: MessagingPageViewModel): MessagingPageViewModel {
    return { ...page, draft: this.draftStorage.readDraft(this.scopeFor(page)) || page.draft };
  }

  private withSortedMessages(page: MessagingPageViewModel): MessagingPageViewModel {
    return {
      ...page,
      messages: [...page.messages]
    };
  }

  private currentUserId(): string {
    return this.authSession.currentUser()?.userId ?? '';
  }

  private currentUserDisplayName(): string {
    return this.authSession.currentUser()?.displayName || 'You';
  }

  private currentTenantId(): string {
    return this.authSession.currentTenant()?.tenantId ?? '';
  }
}

function emptyMessagingPage(
  routeKind: MessagingRouteKind,
  status: MessagingPageStatus,
  inlineError?: string
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
        label: 'Attachments are disabled for MVP0 messaging.'
      }
    },
    conversations: [],
    messages: [],
    draft: '',
    sending: false,
    sendState: { status: 'idle' },
    hasNewMessagesWhileReading: false,
    inlineError,
    readCursorBehavior: 'conversationOpenFallback',
    pagingWindow: {
      visibleMessageIds: [],
      preloadBefore: 0,
      preloadAfter: 0
    }
  };
}

function sendFailureMessage(status: number | undefined): string {
  return status === 401 || status === 403
    ? 'Authentication or posting permission is required.'
    : 'Message API request failed.';
}
