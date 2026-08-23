import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { FrontendFeatureFlagsService } from '../../core/feature-flags/frontend-feature-flags.service';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { DraftStorageService } from './draft-storage.service';
import { MessagingApi } from './messaging.api';
import {
  mapConversationListItem,
  mapConversationPage,
  mapMessage
} from './messaging.mapper';
import {
  MessagingDraftScope,
  MessageFailureCode,
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
  private readonly flags = inject(FrontendFeatureFlagsService);
  private readonly realtime = inject(RealtimeFacade);
  private readonly draftStorage = inject(DraftStorageService);
  private readonly mockPage = inject(AIP_MESSAGING_PAGE_MOCK, { optional: true });
  private readonly initialPage = this.mockPage ?? emptyMessagingPage('channel', 'loading');
  private readonly pageState = signal<MessagingPageViewModel>(
    this.withStoredDraft(this.initialPage)
  );
  private readonly loadedConversationId = signal<string | null>(
    this.mockPage?.conversation.id ?? null
  );
  private realtimeSubscriptionCleanup: (() => void) | undefined;
  private realtimeCatchUpCleanup: (() => void) | undefined;
  private readonly durableEvents: Subscription;

  readonly page = computed(() => this.withSortedMessages(this.pageState()));

  constructor() {
    this.durableEvents = this.realtime.durableEvents$.subscribe((event) => this.applyRealtimeEvent(event));
  }

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
    this.registerConversationRealtime(conversationId);
    const currentPage = this.pageState();
    const existingConversations =
      currentPage.conversation.tenantId === this.currentTenantId()
        ? currentPage.conversations
        : [];
    this.pageState.set({
      ...emptyMessagingPage(routeKind, 'loading'),
      conversations: existingConversations
    });
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

  sendDraft(mentionedUserIds: readonly string[] = []): void {
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

    const normalizedMentionedUserIds = [...new Set(mentionedUserIds.filter((userId) => userId.length > 0))];
    const clientRequestId = createClientRequestId();
    const useOptimistic = this.flags.optimisticMessagingEnabled();
    const pendingMessage: MessagingMessageViewModel = {
      id: `pending-${clientRequestId}`,
      clientRequestId,
      authorLabel: this.currentUserDisplayName(),
      authorRoleLabel: 'member',
      isOwnMessage: true,
      body,
      sentAtLabel: 'Sending',
      deliveryState: 'sending',
      retryAllowed: false,
      mentionedUserIds: normalizedMentionedUserIds
    };

    this.pageState.set({
      ...page,
      sending: true,
      sendState: { status: 'sending', clientRequestId },
      inlineError: undefined,
      messages: useOptimistic ? [...page.messages, pendingMessage] : page.messages,
      status: page.status === 'empty' ? 'ready' : page.status
    });

    this.api.sendMessage(page.conversation.id, body, clientRequestId, normalizedMentionedUserIds).subscribe({
      next: (message) => {
        const confirmedMessage = {
          ...mapMessage(message, this.currentUserId()),
          clientRequestId,
          mentionedUserIds: normalizedMentionedUserIds
        };
        this.draftStorage.clearDraft(this.scopeFor(page));
        this.pageState.update((current) => ({
          ...current,
          draft: '',
          sending: false,
          sendState: { status: 'sent', messageId: confirmedMessage.id },
          status: current.status === 'empty' ? 'ready' : current.status,
          messages: reconcileMessage(current.messages, confirmedMessage)
        }));
      },
      error: (error: { status?: number }) => {
        const message = sendFailureMessage(error.status);
        this.pageState.update((current) => ({
          ...current,
          sending: false,
          sendState: { status: 'failed', message },
          inlineError: message,
          messages: current.messages.map((existing) => existing.id === pendingMessage.id
            ? { ...existing, deliveryState: 'failed', failureCode: failureCode(error.status), safeFailureReason: message, retryAllowed: true }
            : existing)
        }));
      }
    });
  }

  retryMessage(messageId: string): void {
    const page = this.pageState();
    const failed = page.messages.find((message) => message.id === messageId && message.deliveryState === 'failed');
    if (!failed || !failed.clientRequestId || !this.canPost(page) || this.mockPage) {
      return;
    }
    this.pageState.update((current) => ({
      ...current,
      sending: true,
      sendState: { status: 'sending', clientRequestId: failed.clientRequestId },
      messages: current.messages.map((message) => message.id === messageId ? { ...message, deliveryState: 'sending', failureCode: undefined, safeFailureReason: undefined, retryAllowed: false } : message)
    }));
    this.api.sendMessage(page.conversation.id, failed.body, failed.clientRequestId, failed.mentionedUserIds ?? []).subscribe({
      next: (message) => {
        const confirmed = {
          ...mapMessage(message, this.currentUserId()),
          clientRequestId: failed.clientRequestId,
          mentionedUserIds: failed.mentionedUserIds
        };
        this.pageState.update((current) => ({ ...current, sending: false, sendState: { status: 'sent', messageId: confirmed.id }, messages: reconcileMessage(current.messages, confirmed) }));
      },
      error: (error: { status?: number }) => {
        const safeMessage = sendFailureMessage(error.status);
        this.pageState.update((current) => ({ ...current, sending: false, sendState: { status: 'failed', message: safeMessage, requestId: failed.clientRequestId }, messages: current.messages.map((message) => message.id === messageId ? { ...message, deliveryState: 'failed', failureCode: failureCode(error.status), safeFailureReason: safeMessage, retryAllowed: true } : message) }));
      }
    });
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
      messages: [...page.messages].sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''))
    };
  }

  private registerConversationRealtime(conversationId: string): void {
    this.realtimeSubscriptionCleanup?.();
    this.realtimeCatchUpCleanup?.();
    if (!this.flags.realtimeSignalREnabled()) {
      return;
    }
    this.realtimeSubscriptionCleanup = this.realtime.registerSubscription('messaging-conversation', { subscriptionType: 'conversation', resourceId: conversationId });
    this.realtimeCatchUpCleanup = this.realtime.registerCatchUp('messaging-conversation', () => this.catchUpConversation(conversationId));
  }

  private async catchUpConversation(conversationId: string): Promise<void> {
    if (this.loadedConversationId() !== conversationId) {
      return;
    }
    await new Promise<void>((resolve, reject) => this.api.listMessages(conversationId).subscribe({
      next: (response) => {
        this.pageState.update((page) => ({ ...page, messages: mergeMessages(page.messages, (response.items ?? []).map((item) => mapMessage(item, this.currentUserId()))), realtimeDegraded: false }));
        resolve();
      },
      error: reject
    }));
  }

  private applyRealtimeEvent(event: DurableRealtimeEvent): void {
    const page = this.pageState();
    if (!page.conversation.id) {
      return;
    }
    if (event.eventType === 'Messaging.ConversationUnreadChanged.v1') {
      const payload = event.payload as { conversationId?: unknown; userId?: unknown };
      if (payload.conversationId === page.conversation.id && payload.userId === this.currentUserId()) {
        this.pageState.update((current) => ({ ...current, realtimeDegraded: false }));
      }
      return;
    }
    const payload = event.payload as { conversationId?: unknown; message?: unknown; messageId?: unknown; messageVersion?: unknown; body?: unknown; deletionMode?: unknown };
    if (payload.conversationId !== page.conversation.id && (payload.message as { conversationId?: unknown } | undefined)?.conversationId !== page.conversation.id) {
      return;
    }
    if (event.eventType === 'Messaging.MessageCreated.v1' && payload.message && typeof payload.message === 'object') {
      const message = mapRealtimeMessage(payload.message as Record<string, unknown>, this.currentUserId());
      this.pageState.update((current) => ({ ...current, messages: reconcileMessage(current.messages, message), hasNewMessagesWhileReading: !message.isOwnMessage, realtimeDegraded: false }));
      return;
    }
    if (event.eventType === 'Messaging.MessageUpdated.v1' || event.eventType === 'Messaging.MessageDeleted.v1') {
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
      const version = typeof payload.messageVersion === 'number' ? payload.messageVersion : undefined;
      this.pageState.update((current) => ({
        ...current,
        messages: current.messages.map((message) => message.id === messageId && (version === undefined || (message.version ?? 0) < version)
          ? event.eventType === 'Messaging.MessageDeleted.v1'
            ? { ...message, body: '', version, deliveryState: 'confirmed' }
            : { ...message, body: typeof payload.body === 'string' ? payload.body : message.body, version }
          : message)
      }));
    }
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
      mentionCandidates: [],
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

function failureCode(status: number | undefined): MessageFailureCode {
  if (status === 401) {
    return 'sessionExpired';
  }
  if (status === 403) {
    return 'permissionDenied';
  }
  return status && status >= 400 && status < 500 ? 'validation' : 'network';
}

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;
}

function reconcileMessage(
  messages: readonly MessagingMessageViewModel[],
  incoming: MessagingMessageViewModel
): readonly MessagingMessageViewModel[] {
  const matchingIndex = messages.findIndex((message) =>
    message.id === incoming.id ||
    (!!incoming.clientRequestId && message.clientRequestId === incoming.clientRequestId)
  );
  if (matchingIndex < 0) {
    return [...messages, incoming];
  }
  return messages.map((message, index) => index === matchingIndex ? incoming : message);
}

function mergeMessages(
  existing: readonly MessagingMessageViewModel[],
  incoming: readonly MessagingMessageViewModel[]
): readonly MessagingMessageViewModel[] {
  return incoming.reduce<readonly MessagingMessageViewModel[]>((merged, message) => reconcileMessage(merged, message), existing);
}

function mapRealtimeMessage(value: Record<string, unknown>, currentUserId: string): MessagingMessageViewModel {
  const sender = value['sender'] as Record<string, unknown> | undefined;
  const id = typeof value['id'] === 'string' ? value['id'] : `event-${Date.now()}`;
  const authorUserId = typeof sender?.['userId'] === 'string' ? sender['userId'] : '';
  return {
    id,
    clientRequestId: typeof value['clientRequestId'] === 'string' ? value['clientRequestId'] : undefined,
    authorLabel: typeof sender?.['displayName'] === 'string' ? sender['displayName'] : 'Unknown user',
    authorRoleLabel: 'member',
    isOwnMessage: authorUserId !== '' && authorUserId === currentUserId,
    body: typeof value['body'] === 'string' ? value['body'] : '',
    createdAt: typeof value['createdAt'] === 'string' ? value['createdAt'] : undefined,
    version: typeof value['version'] === 'number' ? value['version'] : undefined,
    sentAtLabel: typeof value['createdAt'] === 'string' ? new Date(value['createdAt']).toLocaleString() : '',
    deliveryState: 'confirmed',
    retryAllowed: false
  };
}
