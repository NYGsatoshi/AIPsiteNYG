import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';

import { DEFAULT_CHANNEL_MESSAGING_PAGE } from './messaging.mock';
import { DraftStorageService } from './draft-storage.service';
import {
  MessageFailureCode,
  MessagingDraftScope,
  MessagingMessageViewModel,
  MessagingPageViewModel
} from './messaging.types';

export const AIP_MESSAGING_PAGE_MOCK = new InjectionToken<MessagingPageViewModel>('AIP_MESSAGING_PAGE_MOCK');

@Injectable({ providedIn: 'root' })
export class MessagingFacade {
  private readonly draftStorage = inject(DraftStorageService);
  private readonly initialPage = inject(AIP_MESSAGING_PAGE_MOCK, { optional: true }) ?? DEFAULT_CHANNEL_MESSAGING_PAGE;
  private readonly pageState = signal<MessagingPageViewModel>(this.withStoredDraft(this.initialPage));
  private readonly refreshAttempts = signal(0);

  readonly page = computed(() => this.withSortedMessages(this.pageState()));

  setDraft(value: string): void {
    const page = this.pageState();
    this.draftStorage.writeDraft(this.scopeFor(page), value);
    this.pageState.set({ ...page, draft: value });
  }

  manualRefresh(): void {
    const page = this.pageState();
    if (page.status === 'manualRefreshError' && this.refreshAttempts() < 3) {
      this.refreshAttempts.update((attempts) => attempts + 1);
      this.pageState.set({ ...page, inlineError: '手動更新に失敗しました。再試行しています。' });
      return;
    }

    if (page.status === 'manualRefreshError') {
      this.pageState.set({ ...page, inlineError: '手動更新に失敗しました。時間をおいて再試行してください。' });
      return;
    }

    this.pageState.set({ ...page, hasNewMessagesWhileReading: true });
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
        preloadBefore: 30
      }
    }));
  }

  loadNewer(): void {
    this.pageState.update((page) => ({
      ...page,
      pagingWindow: {
        ...page.pagingWindow,
        afterMessageId: page.messages.at(-1)?.id,
        preloadAfter: 30
      }
    }));
  }

  sendDraft(): void {
    const page = this.pageState();
    const body = page.draft.trim();
    if (!body || page.sending || !this.canPost(page)) {
      return;
    }

    const failureCode = page.mockSendFailure;
    const clientRequestId = `client-${Date.now()}`;
    const localMessage: MessagingMessageViewModel = {
      id: `local-${clientRequestId}`,
      clientRequestId,
      authorLabel: '自分',
      authorRoleLabel: 'member',
      isOwnMessage: true,
      body,
      sentAtLabel: failureCode ? '未送信' : '送信済み',
      deliveryState: failureCode ? 'failed' : 'confirmed',
      failureCode,
      safeFailureReason: failureCode ? this.safeFailureReason(failureCode) : undefined,
      retryAllowed: failureCode !== 'permissionDenied' && failureCode !== 'sessionExpired'
    };

    if (!failureCode) {
      this.draftStorage.clearDraft(this.scopeFor(page));
    }

    this.pageState.set({
      ...page,
      draft: failureCode ? page.draft : '',
      sending: false,
      messages: [...page.messages, localMessage],
      status: page.status === 'empty' ? 'ready' : page.status
    });
  }

  retryMessage(messageId: string): void {
    const page = this.pageState();
    this.pageState.set({
      ...page,
      messages: page.messages.map((message) => {
        if (message.id !== messageId || message.deliveryState !== 'failed' || !message.retryAllowed) {
          return message;
        }

        if (message.failureCode === 'permissionDenied' || message.failureCode === 'sessionExpired') {
          return { ...message, retryAllowed: false };
        }

        return {
          ...message,
          deliveryState: 'confirmed',
          sentAtLabel: '再送済み',
          safeFailureReason: undefined,
          failureCode: undefined,
          retryAllowed: false
        };
      })
    });
  }

  clearDraftsForSessionBoundary(): void {
    this.draftStorage.clearAllDrafts();
    this.pageState.update((page) => ({ ...page, draft: '' }));
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

  private safeFailureReason(code: MessageFailureCode): string {
    if (code === 'permissionDenied') {
      return '送信権限がありません。';
    }
    if (code === 'sessionExpired') {
      return 'セッションの有効期限が切れました。';
    }
    if (code === 'validation') {
      return '送信内容を確認してください。';
    }
    return '送信できませんでした。接続を確認して再試行してください。';
  }
}
