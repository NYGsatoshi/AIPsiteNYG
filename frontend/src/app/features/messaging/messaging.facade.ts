import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { AuthSessionFacade } from '../../core/auth/auth-session.facade';
import { FrontendFeatureFlagsService } from '../../core/feature-flags/frontend-feature-flags.service';
import {
  ProtectedStateClearReason,
  RealtimeFacade,
} from '../../core/realtime/realtime.facade';
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
  MessagingMessageActionState,
  MessagingMessageViewModel,
  MessagingPageStatus,
  MessagingPageViewModel,
  MessagingRouteKind
} from './messaging.types';
import { MessageNavigationStateService } from './message-navigation-state.service';

export const AIP_MESSAGING_PAGE_MOCK = new InjectionToken<MessagingPageViewModel>(
  'AIP_MESSAGING_PAGE_MOCK'
);

const MESSAGING_REALTIME_OWNER = 'messaging-route';
const EMPTY_MESSAGE_ACTION: MessagingMessageActionState = {
  messageId: null,
  mode: 'idle',
  draft: '',
  pending: null
};

@Injectable({ providedIn: 'root' })
export class MessagingFacade {
  private readonly api = inject(MessagingApi);
  private readonly authSession = inject(AuthSessionFacade);
  private readonly flags = inject(FrontendFeatureFlagsService);
  private readonly realtime = inject(RealtimeFacade);
  private readonly draftStorage = inject(DraftStorageService);
  private readonly navigationState = inject(MessageNavigationStateService);
  private readonly mockPage = inject(AIP_MESSAGING_PAGE_MOCK, { optional: true });
  private readonly initialPage = this.mockPage ?? emptyMessagingPage('channel', 'loading');
  private readonly pageState = signal<MessagingPageViewModel>(
    this.withStoredDraft(this.initialPage)
  );
  private readonly messageActionState = signal<MessagingMessageActionState>(EMPTY_MESSAGE_ACTION);
  private readonly loadedConversationId = signal<string | null>(
    this.mockPage?.conversation.id ?? null
  );
  private loadedExpectedWorkspaceId: string | null = null;
  private realtimeSubscriptionCleanup: (() => void) | undefined;
  private realtimeCatchUpCleanup: (() => void) | undefined;
  private readonly durableEvents: Subscription;
  private readonly protectedRequests = new Set<Subscription>();
  private requestGeneration = 0;
  private messageActionFeedbackId = 0;

  readonly page = computed(() => this.withSortedMessages(this.pageState()));
  readonly messageAction = this.messageActionState.asReadonly();

  constructor() {
    this.durableEvents = this.realtime.durableEvents$.subscribe((event) => this.applyRealtimeEvent(event));
    if (!this.mockPage) {
      this.realtime.registerProtectedStateClearer?.(
        'messaging',
        (reason) => this.clearProtectedState(reason),
      );
    }
  }

  loadConversationListPage(routeKind: MessagingRouteKind = 'channel'): void {
    if (this.mockPage) {
      return;
    }

    const generation = this.beginRequestGeneration();
    this.releaseConversationRealtime();
    this.loadedConversationId.set(null);
    this.pageState.set(emptyMessagingPage(routeKind, 'loading'));
    this.realtimeCatchUpCleanup = this.realtime.registerCatchUp(
      MESSAGING_REALTIME_OWNER,
      () => this.catchUpConversationList(routeKind),
    );
    void this.loadConversationList(routeKind, true, generation);
  }

  loadConversation(
    conversationId: string | null,
    routeKind: 'channel',
    expectedWorkspaceId: string | null,
  ): void;
  loadConversation(
    conversationId: string | null,
    routeKind: 'dm',
    expectedWorkspaceId?: null,
  ): void;
  loadConversation(
    conversationId: string | null,
    routeKind: MessagingRouteKind,
    expectedWorkspaceId: string | null = null,
  ): void {
    if (this.mockPage) {
      return;
    }

    const routeWorkspaceId = routeKind === 'channel' ? nonEmptyString(expectedWorkspaceId) : null;
    if (!conversationId || (routeKind === 'channel' && !routeWorkspaceId)) {
      this.beginRequestGeneration();
      this.releaseConversationRealtime();
      this.loadedConversationId.set(null);
      this.loadedExpectedWorkspaceId = null;
      this.pageState.set(
        emptyMessagingPage(
          routeKind,
          routeKind === 'channel' ? 'permissionDenied' : 'empty',
          'Conversation route scope is missing.',
        )
      );
      return;
    }

    if (
      this.loadedConversationId() === conversationId &&
      this.loadedExpectedWorkspaceId === routeWorkspaceId
    ) {
      return;
    }

    const generation = this.beginRequestGeneration();
    this.releaseConversationRealtime();
    this.loadedConversationId.set(conversationId);
    this.loadedExpectedWorkspaceId = routeWorkspaceId;
    const currentPage = this.pageState();
    const existingConversations =
      currentPage.conversation.tenantId === this.currentTenantId()
        ? currentPage.conversations
        : [];
    this.pageState.set({
      ...emptyMessagingPage(routeKind, 'loading'),
      conversations: existingConversations
    });
    void this.loadConversationData(
      conversationId,
      routeKind,
      generation,
      routeWorkspaceId,
      true,
    );
  }

  private loadConversationData(
    conversationId: string,
    routeKind: MessagingRouteKind,
    generation: number,
    expectedWorkspaceId: string | null,
    registerRealtimeAfterValidation: boolean,
  ): Promise<void> {
    const listCompletion = this.loadConversationList(routeKind, false, generation);
    const detailCompletion = new Promise<void>((resolve) => {
      let messagesStarted = false;
      let settled = false;
      const settle = (): void => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const conversationRequest = this.api.getConversation(conversationId).subscribe({
        next: (conversation) => {
          if (!this.isCurrentRequest(generation, conversationId)) {
            settle();
            return;
          }
          if (
            expectedWorkspaceId !== null &&
            nonEmptyString(conversation.workspaceId) !== expectedWorkspaceId
          ) {
            this.rejectConversationOutsideRouteWorkspace(generation, conversationId, routeKind);
            settle();
            return;
          }
          if (registerRealtimeAfterValidation) {
            this.registerConversationRealtime(conversationId);
          }
          messagesStarted = true;
          const messagesRequest = this.api.listMessages(conversationId).subscribe({
            next: (response) => {
              if (!this.isCurrentRequest(generation, conversationId)) {
                return;
              }
              const page = mapConversationPage(conversation, response.items ?? [], {
                currentUserId: this.currentUserId(),
                currentTenantId: this.currentTenantId(),
                fallbackRouteKind: routeKind,
                existingConversations: this.pageState().conversations
              });
              this.pageState.set(this.withStoredDraft(page));
            },
            error: (error: { status?: number }) => {
              if (this.isCurrentRequest(generation, conversationId)) {
                this.rejectIncompleteConversationAggregate(
                  generation,
                  conversationId,
                  routeKind,
                  error.status,
                );
              }
              settle();
            },
            complete: settle,
          });
          messagesRequest.add(settle);
          this.trackProtectedRequest(messagesRequest);
        },
        error: (error: { status?: number }) => {
          if (this.isCurrentRequest(generation, conversationId)) {
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
          settle();
        },
        complete: () => {
          if (!messagesStarted) {
            settle();
          }
        },
      });
      conversationRequest.add(() => {
        if (!messagesStarted) {
          settle();
        }
      });
      this.trackProtectedRequest(conversationRequest);
    });
    return Promise.all([listCompletion, detailCompletion]).then(() => undefined);
  }

  setDraft(value: string): void {
    const page = this.pageState();
    this.draftStorage.writeDraft(this.scopeFor(page), value);
    this.pageState.set({ ...page, draft: value });
  }

  manualRefresh(): void {
    if (!this.mockPage) {
      const page = this.pageState();
      const conversationId = page.conversation.id || this.loadedConversationId();
      if (conversationId) {
        this.loadedConversationId.set(null);
        if (page.routeKind === 'channel') {
          this.loadConversation(
            conversationId,
            'channel',
            this.loadedExpectedWorkspaceId ?? page.conversation.workspaceId ?? null,
          );
        } else {
          this.loadConversation(conversationId, 'dm');
        }
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
    const generation = this.requestGeneration;
    const conversationId = page.conversation.id;
    const useOptimistic = this.flags.optimisticMessagingEnabled();
    const pendingMessage: MessagingMessageViewModel = {
      id: `pending-${clientRequestId}`,
      clientRequestId,
      authorLabel: this.currentUserDisplayName(),
      authorRoleLabel: 'member',
      isOwnMessage: true,
      body,
      isDeleted: false,
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

    const request = this.api.sendMessage(page.conversation.id, body, clientRequestId, normalizedMentionedUserIds).subscribe({
      next: (message) => {
        if (!this.isCurrentRequest(generation, conversationId)) {
          return;
        }
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
        if (!this.isCurrentRequest(generation, conversationId)) {
          return;
        }
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
    this.trackProtectedRequest(request);
  }

  retryMessage(messageId: string): void {
    const page = this.pageState();
    const failed = page.messages.find((message) => message.id === messageId && message.deliveryState === 'failed');
    if (!failed || !failed.clientRequestId || !this.canPost(page) || this.mockPage) {
      return;
    }
    const generation = this.requestGeneration;
    const conversationId = page.conversation.id;
    this.pageState.update((current) => ({
      ...current,
      sending: true,
      sendState: { status: 'sending', clientRequestId: failed.clientRequestId },
      messages: current.messages.map((message) => message.id === messageId ? { ...message, deliveryState: 'sending', failureCode: undefined, safeFailureReason: undefined, retryAllowed: false } : message)
    }));
    const request = this.api.sendMessage(page.conversation.id, failed.body, failed.clientRequestId, failed.mentionedUserIds ?? []).subscribe({
      next: (message) => {
        if (!this.isCurrentRequest(generation, conversationId)) {
          return;
        }
        const confirmed = {
          ...mapMessage(message, this.currentUserId()),
          clientRequestId: failed.clientRequestId,
          mentionedUserIds: failed.mentionedUserIds
        };
        this.pageState.update((current) => ({ ...current, sending: false, sendState: { status: 'sent', messageId: confirmed.id }, messages: reconcileMessage(current.messages, confirmed) }));
      },
      error: (error: { status?: number }) => {
        if (!this.isCurrentRequest(generation, conversationId)) {
          return;
        }
        const safeMessage = sendFailureMessage(error.status);
        this.pageState.update((current) => ({ ...current, sending: false, sendState: { status: 'failed', message: safeMessage, requestId: failed.clientRequestId }, messages: current.messages.map((message) => message.id === messageId ? { ...message, deliveryState: 'failed', failureCode: failureCode(error.status), safeFailureReason: safeMessage, retryAllowed: true } : message) }));
      }
    });
    this.trackProtectedRequest(request);
  }

  beginMessageEdit(messageId: string): void {
    const message = this.messageActionTarget(messageId, true);
    if (!message || !this.canPost(this.pageState()) || this.messageActionState().mode !== 'idle' || this.mockPage) {
      return;
    }

    this.messageActionState.set({
      messageId,
      mode: 'editing',
      draft: message.body,
      pending: null
    });
  }

  updateMessageEditDraft(messageId: string, draft: string): void {
    const action = this.messageActionState();
    if (action.messageId !== messageId || action.mode !== 'editing' || action.pending) {
      return;
    }
    this.messageActionState.set({ ...action, draft, error: undefined });
  }

  saveMessageEdit(messageId: string): void {
    const action = this.messageActionState();
    const message = this.messageActionTarget(messageId, true);
    const body = action.draft.trim();
    if (
      action.messageId !== messageId ||
      action.mode !== 'editing' ||
      action.pending ||
      !message ||
      !this.canPost(this.pageState()) ||
      this.mockPage
    ) {
      return;
    }
    if (!body) {
      this.messageActionState.set({ ...action, error: 'Enter a message before saving.' });
      return;
    }

    const generation = this.requestGeneration;
    const conversationId = this.pageState().conversation.id;
    this.messageActionState.set({ ...action, pending: 'edit', error: undefined });
    const request = this.api.updateMessage(messageId, body).subscribe({
      next: (updated) => {
        if (!this.isCurrentRequest(generation, conversationId)) {
          return;
        }
        const activeAction = this.messageActionState();
        const currentMessage = this.pageState().messages.find((current) => current.id === messageId);
        if (
          activeAction.messageId !== messageId ||
          activeAction.mode !== 'editing' ||
          activeAction.pending !== 'edit' ||
          !currentMessage
        ) {
          return;
        }
        const mapped = mapMessage(updated, this.currentUserId());
        if (
          currentMessage.version !== undefined &&
          (mapped.version === undefined || mapped.version < currentMessage.version)
        ) {
          this.setMessageActionFeedback('Message changed. Refresh the conversation before trying again.', true);
          return;
        }
        this.pageState.update((page) => ({
          ...page,
          messages: page.messages.map((current) => current.id === messageId
            ? { ...mapped, readState: current.readState, mentionedUserIds: current.mentionedUserIds }
            : current)
        }));
        this.setMessageActionFeedback('Message updated.', true);
      },
      error: (error: { status?: number; httpStatus?: number }) => {
        if (this.isCurrentRequest(generation, conversationId)) {
          this.messageActionState.update((current) => current.messageId === messageId && current.mode === 'editing'
            ? { ...current, pending: null, error: messageActionFailureMessage(httpStatus(error)) }
            : current);
        }
      }
    });
    this.trackProtectedRequest(request);
  }

  requestMessageDelete(messageId: string): void {
    const message = this.messageActionTarget(messageId, true);
    if (!message || this.messageActionState().mode !== 'idle' || this.mockPage) {
      return;
    }
    this.messageActionState.set({
      messageId,
      mode: 'confirmDelete',
      draft: '',
      pending: null
    });
  }

  confirmMessageDelete(messageId: string): void {
    const action = this.messageActionState();
    const message = this.messageActionTarget(messageId, true);
    if (
      action.messageId !== messageId ||
      action.mode !== 'confirmDelete' ||
      action.pending ||
      !message ||
      this.mockPage
    ) {
      return;
    }

    const generation = this.requestGeneration;
    const conversationId = this.pageState().conversation.id;
    this.messageActionState.set({ ...action, pending: 'delete', error: undefined });
    const request = this.api.deleteMessage(messageId).subscribe({
      next: () => {
        if (!this.isCurrentRequest(generation, conversationId)) {
          return;
        }
        // The current list endpoint omits DeletedAt rows, so reconcile a
        // successful delete by removing it rather than inventing a durable tombstone.
        this.pageState.update((page) => ({
          ...page,
          messages: page.messages.filter((current) => current.id !== messageId),
          status: page.messages.length <= 1 ? 'empty' : page.status
        }));
        this.setMessageActionFeedback('Message deleted.', true);
      },
      error: (error: { status?: number; httpStatus?: number }) => {
        if (this.isCurrentRequest(generation, conversationId)) {
          this.messageActionState.update((current) => current.messageId === messageId && current.mode === 'confirmDelete'
            ? { ...current, pending: null, error: messageActionFailureMessage(httpStatus(error)) }
            : current);
        }
      }
    });
    this.trackProtectedRequest(request);
  }

  requestMessageReport(messageId: string): void {
    const message = this.messageActionTarget(messageId);
    if (!message || this.messageActionState().mode !== 'idle' || this.mockPage) {
      return;
    }
    this.messageActionState.set({
      messageId,
      mode: 'confirmReport',
      draft: '',
      pending: null
    });
  }

  confirmMessageReport(messageId: string, reasonCode: string): void {
    const action = this.messageActionState();
    const message = this.messageActionTarget(messageId);
    if (
      action.messageId !== messageId ||
      action.mode !== 'confirmReport' ||
      action.pending ||
      !message ||
      !reasonCode ||
      this.mockPage
    ) {
      return;
    }

    const generation = this.requestGeneration;
    const conversationId = this.pageState().conversation.id;
    this.messageActionState.set({ ...action, pending: 'report', error: undefined });
    const request = this.api.reportMessage(messageId, reasonCode).subscribe({
      next: () => {
        if (!this.isCurrentRequest(generation, conversationId)) {
          return;
        }
        this.setMessageActionFeedback('Report request recorded.');
      },
      error: (error: { status?: number; httpStatus?: number }) => {
        if (this.isCurrentRequest(generation, conversationId)) {
          this.messageActionState.update((current) => current.messageId === messageId && current.mode === 'confirmReport'
            ? { ...current, pending: null, error: messageActionFailureMessage(httpStatus(error)) }
            : current);
        }
      }
    });
    this.trackProtectedRequest(request);
  }

  cancelMessageAction(): void {
    if (!this.messageActionState().pending) {
      this.messageActionState.set(EMPTY_MESSAGE_ACTION);
    }
  }

  clearDraftsForSessionBoundary(): void {
    this.draftStorage.clearAllDrafts();
    this.pageState.update((page) => ({ ...page, draft: '' }));
  }

  private loadConversationList(
    routeKind: MessagingRouteKind,
    listOnly: boolean,
    generation: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const request = this.api.listConversations().subscribe({
      next: (response) => {
        if (generation !== this.requestGeneration) {
          return;
        }
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
        if (generation !== this.requestGeneration) {
          return;
        }
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
        },
        complete: resolve,
      });
      request.add(resolve);
      this.trackProtectedRequest(request);
    });
  }

  private canPost(page: MessagingPageViewModel): boolean {
    return (
      page.conversation.viewerIsParticipant &&
      !page.conversation.viewerWasRemoved &&
      page.conversation.capabilities.includes('postMessage')
    );
  }

  private messageActionTarget(messageId: string, ownMessageOnly = false): MessagingMessageViewModel | null {
    const message = this.pageState().messages.find((current) => current.id === messageId);
    if (
      !message ||
      message.deliveryState !== 'confirmed' ||
      message.isDeleted ||
      (ownMessageOnly && !message.isOwnMessage)
    ) {
      return null;
    }
    return message;
  }

  private setMessageActionFeedback(message: string, focusTimeline = false): void {
    this.messageActionFeedbackId += 1;
    this.messageActionState.set({
      ...EMPTY_MESSAGE_ACTION,
      feedback: {
        id: this.messageActionFeedbackId,
        message,
        focusTimeline
      }
    });
  }

  private scopeFor(page: MessagingPageViewModel): MessagingDraftScope {
    return {
      tenantId: page.conversation.tenantId,
      userId: this.currentUserId(),
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
    this.releaseConversationRealtime();
    if (!this.flags.realtimeSignalREnabled()) {
      return;
    }
    this.realtimeSubscriptionCleanup = this.realtime.registerSubscription(MESSAGING_REALTIME_OWNER, { subscriptionType: 'conversation', resourceId: conversationId });
    this.realtimeCatchUpCleanup = this.realtime.registerCatchUp(MESSAGING_REALTIME_OWNER, () => this.catchUpConversation(conversationId));
  }

  private catchUpConversation(conversationId: string): Promise<void> | void {
    if (this.loadedConversationId() !== conversationId) {
      return;
    }
    const routeKind = this.pageState().routeKind;
    const generation = this.beginRequestGeneration();
    this.pageState.set(emptyMessagingPage(routeKind, 'loading'));
    return this.loadConversationData(
      conversationId,
      routeKind,
      generation,
      this.loadedExpectedWorkspaceId,
      false,
    );
  }

  private catchUpConversationList(routeKind: MessagingRouteKind): Promise<void> | void {
    if (this.loadedConversationId() !== null) {
      return;
    }
    const generation = this.beginRequestGeneration();
    this.pageState.set(emptyMessagingPage(routeKind, 'loading'));
    return this.loadConversationList(routeKind, true, generation);
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
    const payload = event.payload as { conversationId?: unknown; message?: unknown; messageId?: unknown; messageVersion?: unknown; body?: unknown; updatedAt?: unknown; deletionMode?: unknown };
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
      if (event.eventType === 'Messaging.MessageDeleted.v1') {
        this.pageState.update((current) => {
          const messages = current.messages.filter((message) => message.id !== messageId);
          return {
            ...current,
            messages,
            status: messages.length === 0 ? 'empty' : current.status
          };
        });
        if (this.messageActionState().messageId === messageId) {
          this.setMessageActionFeedback('Message was removed.', true);
        }
        return;
      }
      this.pageState.update((current) => ({
        ...current,
        messages: current.messages.map((message) => message.id === messageId && (version === undefined || (message.version ?? 0) < version)
          ? {
              ...message,
              body: typeof payload.body === 'string' ? payload.body : message.body,
              editedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : message.editedAt,
              version
            }
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

  private beginRequestGeneration(): number {
    this.requestGeneration++;
    this.cancelProtectedRequests();
    this.messageActionState.set(EMPTY_MESSAGE_ACTION);
    return this.requestGeneration;
  }

  private isCurrentRequest(generation: number, conversationId: string): boolean {
    return generation === this.requestGeneration && this.loadedConversationId() === conversationId;
  }

  private trackProtectedRequest(request: Subscription): void {
    this.protectedRequests.add(request);
    request.add(() => this.protectedRequests.delete(request));
  }

  private cancelProtectedRequests(): void {
    for (const request of [...this.protectedRequests]) {
      request.unsubscribe();
    }
    this.protectedRequests.clear();
  }

  private releaseConversationRealtime(): void {
    this.realtimeSubscriptionCleanup?.();
    this.realtimeCatchUpCleanup?.();
    this.realtimeSubscriptionCleanup = undefined;
    this.realtimeCatchUpCleanup = undefined;
  }

  private rejectConversationOutsideRouteWorkspace(
    generation: number,
    conversationId: string,
    routeKind: MessagingRouteKind,
  ): void {
    if (!this.isCurrentRequest(generation, conversationId)) {
      return;
    }
    this.beginRequestGeneration();
    this.releaseConversationRealtime();
    this.loadedConversationId.set(null);
    this.loadedExpectedWorkspaceId = null;
    this.pageState.set(
      emptyMessagingPage(
        routeKind,
        'permissionDenied',
        'Conversation is not available in this Workspace.',
      ),
    );
  }

  private rejectIncompleteConversationAggregate(
    generation: number,
    conversationId: string,
    routeKind: MessagingRouteKind,
    status: number | undefined,
  ): void {
    if (!this.isCurrentRequest(generation, conversationId)) {
      return;
    }

    // Conversation detail alone is not a safe projection: access can be
    // revoked between the detail and message reads (the backend may surface
    // that denial as 400). Discard every protected field unless the complete
    // aggregate loaded successfully.
    this.beginRequestGeneration();
    this.releaseConversationRealtime();
    const accessDenied = status === 400 || status === 401 || status === 403 || status === 404;
    this.pageState.set(
      emptyMessagingPage(
        routeKind,
        accessDenied ? 'permissionDenied' : 'manualRefreshError',
        accessDenied
          ? 'Authentication or conversation permission is required.'
          : 'Message API request failed.',
      ),
    );
  }

  private clearProtectedState(reason: ProtectedStateClearReason): void {
    const preserveRouteIntent = reason === 'authorization';
    const routeKind = this.pageState().routeKind;
    this.beginRequestGeneration();
    if (!preserveRouteIntent) {
      this.releaseConversationRealtime();
      this.loadedConversationId.set(null);
      this.loadedExpectedWorkspaceId = null;
      this.navigationState.clearForWorkspaceBoundary();
    }
    if (reason === 'session' || reason === 'tenant') {
      this.clearDraftsForSessionBoundary();
    }
    this.pageState.set(emptyMessagingPage(
      routeKind,
      'loading',
      'Waiting for an active Workspace selection.',
    ));
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

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sendFailureMessage(status: number | undefined): string {
  return status === 401 || status === 403
    ? 'Authentication or posting permission is required.'
    : 'Message API request failed.';
}

function messageActionFailureMessage(status: number | undefined): string {
  if (status === 401) {
    return 'Your session has ended. Sign in again before trying this message action.';
  }
  if (status === 400 || status === 403 || status === 404) {
    return 'This message action is no longer available. Refresh the conversation and try again.';
  }
  return 'The message action could not be completed. Try again.';
}

function httpStatus(error: { readonly status?: number; readonly httpStatus?: number }): number | undefined {
  return error.httpStatus ?? error.status;
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
    isDeleted: false,
    createdAt: typeof value['createdAt'] === 'string' ? value['createdAt'] : undefined,
    version: typeof value['version'] === 'number' ? value['version'] : undefined,
    sentAtLabel: typeof value['createdAt'] === 'string' ? new Date(value['createdAt']).toLocaleString() : '',
    deliveryState: 'confirmed',
    retryAllowed: false
  };
}
