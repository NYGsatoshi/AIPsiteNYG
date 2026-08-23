import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ConversationListComponent } from '../conversation-list/conversation-list.component';
import { MessageNavigationStateService } from '../message-navigation-state.service';
import { ConversationRecipientDto, MessagingApi } from '../messaging.api';
import { MessagingFacade } from '../messaging.facade';

type RecipientSearchStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface RecipientOption {
  readonly userId: string;
  readonly displayName: string;
}

@Component({
  selector: 'app-messages-page',
  standalone: true,
  imports: [ConversationListComponent, FormsModule],
  template: `
    <section class="messages-page" data-testid="messages-page">
      <header class="messages-page__header">
        <div>
          <p class="messages-page__eyebrow">Messages</p>
          <h1>Conversations</h1>
        </div>
        <button
          type="button"
          class="messages-page__primary"
          data-testid="new-message-button"
          aria-label="新しいメッセージを作成"
          (click)="openCreateDialog()"
        >
          新しいメッセージ
        </button>
      </header>

      @if (page().inlineError) {
        <p class="messages-page__error" data-testid="messages-list-error">{{ page().inlineError }}</p>
      }

      @if (page().status === 'loading') {
        <p class="messages-page__empty" data-testid="messages-list-loading">会話を読み込んでいます...</p>
      } @else if (page().status === 'permissionDenied') {
        <section class="messages-page__state" data-testid="messages-permission-denied">
          <h2>Messagesを表示できません</h2>
          <p>ログイン状態または会話の権限を確認してください。</p>
        </section>
      } @else if (page().status === 'manualRefreshError') {
        <section class="messages-page__state" data-testid="messages-list-failed">
          <h2>会話を取得できませんでした</h2>
          <p>APIの取得に失敗しました。空の会話一覧としては扱いません。</p>
          <button type="button" (click)="facade.manualRefresh()">再試行</button>
        </section>
      } @else if (page().conversations.length > 0) {
        <app-conversation-list
          [conversations]="page().conversations"
          [preserveListScroll]="true"
        />
      } @else {
        <section class="messages-page__state" data-testid="messages-list-empty">
          <h2>まだ会話はありません</h2>
          <p>「新しいメッセージ」から相手を選んで会話を開始できます。</p>
          <button
            type="button"
            class="messages-page__primary"
            aria-label="新しいメッセージを作成"
            (click)="openCreateDialog()"
          >
            新しいメッセージ
          </button>
        </section>
      }

      <section class="messages-page__hint" data-testid="messages-selection-hint">
        <h2>会話を選択してください</h2>
        <p>左の一覧から会話を開くか、新しいメッセージで1対1会話を開始できます。</p>
      </section>

      @if (createDialogOpen()) {
        <div class="messages-page__overlay" role="presentation">
          <section
            class="messages-page__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-message-title"
            data-testid="new-message-dialog"
          >
            <header class="messages-page__dialog-header">
              <h2 id="new-message-title">新しいメッセージ</h2>
              <button type="button" aria-label="閉じる" (click)="closeCreateDialog()">×</button>
            </header>

            <label class="messages-page__field">
              <span>宛先ユーザーを検索</span>
              <input
                type="search"
                data-testid="recipient-search"
                [ngModel]="recipientQuery()"
                (ngModelChange)="onRecipientQueryChange($event)"
                placeholder="表示名またはメールで検索"
                autocomplete="off"
              />
            </label>

            @if (recipientStatus() === 'idle') {
              <p class="messages-page__muted" data-testid="recipient-search-idle">検索語を入力してください。</p>
            } @else if (recipientStatus() === 'loading') {
              <p class="messages-page__muted" data-testid="recipient-search-loading">候補を検索しています...</p>
            } @else if (recipientStatus() === 'error') {
              <p class="messages-page__error" data-testid="recipient-search-error">
                宛先候補を取得できませんでした。
              </p>
            } @else if (recipientStatus() === 'empty') {
              <p class="messages-page__muted" data-testid="recipient-search-empty">候補が見つかりません。</p>
            } @else {
              <div class="messages-page__recipients" role="listbox" aria-label="宛先候補">
                @for (recipient of recipients(); track recipient.userId) {
                  <button
                    type="button"
                    role="option"
                    class="messages-page__recipient"
                    [class.messages-page__recipient--selected]="selectedRecipientId() === recipient.userId"
                    [attr.aria-selected]="selectedRecipientId() === recipient.userId"
                    data-testid="recipient-option"
                    (click)="selectRecipient(recipient.userId)"
                  >
                    {{ recipient.displayName }}
                  </button>
                }
              </div>
            }

            @if (createError()) {
              <p class="messages-page__error" data-testid="create-conversation-error">{{ createError() }}</p>
            }

            <footer class="messages-page__dialog-actions">
              <button type="button" (click)="closeCreateDialog()" [disabled]="creating()">キャンセル</button>
              <button
                type="button"
                class="messages-page__primary"
                data-testid="create-conversation-submit"
                [disabled]="!canSubmitCreate()"
                (click)="createConversation()"
              >
                {{ creating() ? '作成中...' : '会話を作成' }}
              </button>
            </footer>
          </section>
        </div>
      }
    </section>
  `,
  styleUrl: './messages-page.component.scss'
})
export class MessagesPageComponent {
  readonly facade = inject(MessagingFacade);
  private readonly api = inject(MessagingApi);
  private readonly router = inject(Router);
  private readonly navigationState = inject(MessageNavigationStateService);
  readonly page = this.facade.page;
  readonly createDialogOpen = signal(false);
  readonly recipientQuery = signal('');
  readonly recipientStatus = signal<RecipientSearchStatus>('idle');
  readonly recipients = signal<readonly RecipientOption[]>([]);
  readonly selectedRecipientId = signal<string | null>(null);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly canSubmitCreate = computed(() => this.selectedRecipientId() !== null && !this.creating());

  constructor() {
    effect(() => {
      if (this.page().status !== 'loading') {
        this.navigationState.restoreListScroll();
      }
    });
    this.facade.loadConversationListPage();
  }

  openCreateDialog(): void {
    this.createDialogOpen.set(true);
    this.createError.set(null);
  }

  closeCreateDialog(): void {
    if (this.creating()) {
      return;
    }

    this.createDialogOpen.set(false);
    this.recipientQuery.set('');
    this.recipientStatus.set('idle');
    this.recipients.set([]);
    this.selectedRecipientId.set(null);
    this.createError.set(null);
  }

  onRecipientQueryChange(value: string): void {
    this.recipientQuery.set(value);
    this.selectedRecipientId.set(null);
    this.createError.set(null);
    const query = value.trim();
    if (!query) {
      this.recipientStatus.set('idle');
      this.recipients.set([]);
      return;
    }

    this.recipientStatus.set('loading');
    this.api.searchRecipients(query).subscribe({
      next: (response) => {
        const recipients = response.map(mapRecipient).filter((recipient): recipient is RecipientOption => recipient !== null);
        this.recipients.set(recipients);
        this.recipientStatus.set(recipients.length > 0 ? 'ready' : 'empty');
      },
      error: () => {
        this.recipients.set([]);
        this.recipientStatus.set('error');
      }
    });
  }

  selectRecipient(userId: string): void {
    this.selectedRecipientId.set(userId);
    this.createError.set(null);
  }

  createConversation(): void {
    const recipientUserId = this.selectedRecipientId();
    if (!recipientUserId || this.creating()) {
      return;
    }

    this.creating.set(true);
    this.createError.set(null);
    this.api.createDirectConversation(recipientUserId).subscribe({
      next: (conversation) => {
        const conversationId = stringValue(conversation.id);
        if (!conversationId) {
          this.creating.set(false);
          this.createError.set('APIレスポンスに会話IDがありません。');
          return;
        }

        this.creating.set(false);
        this.closeCreateDialog();
        void this.router.navigateByUrl(`/dm/${conversationId}`);
      },
      error: () => {
        this.creating.set(false);
        this.createError.set('会話を作成できませんでした。');
      }
    });
  }
}

function mapRecipient(recipient: ConversationRecipientDto): RecipientOption | null {
  const userId = stringValue(recipient.userId);
  const displayName = stringValue(recipient.displayName);
  return userId && displayName ? { userId, displayName } : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
