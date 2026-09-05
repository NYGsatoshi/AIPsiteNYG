import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MessageNavigationStateService } from '../message-navigation-state.service';
import { MessagingConversationListItem } from '../messaging.types';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager
  selector: 'app-conversation-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="conversation-list" aria-label="会話" data-testid="conversation-list">
      @for (conversation of conversations; track conversation.id) {
        <div class="conversation-list__row">
          <a
            class="conversation-list__item"
            [class.conversation-list__item--selected]="isSelected(conversation)"
            [class.conversation-list__item--unread]="isUnread(conversation)"
            [class.conversation-list__item--mention]="conversation.hasMention === true"
            [attr.aria-current]="isSelected(conversation) ? 'page' : null"
            [attr.data-conversation-id]="conversation.id"
            [routerLink]="conversation.route"
            data-testid="conversation-list-item"
            (click)="rememberListScrollBeforeNavigate(conversation.id)"
          >
            <span class="conversation-list__title">{{ conversation.title }}</span>
            <span class="conversation-list__meta">{{ conversation.lastActivityLabel }}</span>
            @if (conversation.kind === 'dm') {
              <span class="conversation-list__preview" data-testid="dm-preview-hidden">DMプレビュー非表示</span>
            } @else {
              <span class="conversation-list__preview" data-testid="channel-preview">{{ conversation.safePreviewLabel }}</span>
            }

            @if (isSelected(conversation) || (showUnreadBadges && isUnread(conversation)) || conversation.hasMention === true || conversation.isLater === true) {
              <span class="conversation-list__states" data-testid="conversation-state-summary">
                @if (isSelected(conversation)) {
                  <span class="conversation-list__state conversation-list__state--selected" data-testid="conversation-selected">
                    選択中
                  </span>
                }
                @if (showUnreadBadges && isUnread(conversation)) {
                  <span class="conversation-list__state conversation-list__state--unread" data-testid="conversation-unread">
                    <span class="conversation-list__unread-dot" aria-hidden="true"></span>
                    <span data-testid="conversation-unread-badge">未読 {{ conversation.unreadCount }}件</span>
                  </span>
                }
                @if (conversation.hasMention === true) {
                  <span
                    class="conversation-list__state conversation-list__state--mention"
                    data-testid="conversation-mention"
                    aria-label="あなたへのメンションがあります"
                  >
                    &#64;you
                  </span>
                }
                @if (conversation.isLater === true) {
                  <span class="conversation-list__state conversation-list__state--later" data-testid="conversation-later-state">
                    Later
                  </span>
                }
              </span>
            }
          </a>
          @if (showLaterActions) {
            <button
              type="button"
              class="conversation-list__later"
              data-testid="conversation-later-toggle"
              [attr.aria-label]="laterActionLabel(conversation)"
              [attr.aria-pressed]="conversation.isLater === true"
              [disabled]="laterPendingConversationId !== null"
              (click)="laterChanged.emit({ conversationId: conversation.id, isLater: conversation.isLater !== true })"
            >
              {{ laterPendingConversationId === conversation.id ? 'Saving' : (conversation.isLater === true ? 'Remove' : 'Later') }}
            </button>
          }
        </div>
      }
    </nav>
  `,
  styleUrl: './conversation-list.component.scss',
})
export class ConversationListComponent {
  private readonly navigationState = inject(MessageNavigationStateService);
  @Input({ required: true }) conversations: readonly MessagingConversationListItem[] = [];
  @Input() selectedConversationId: string | null = null;
  @Input() preserveListScroll = false;
  @Input() showUnreadBadges = true;
  @Input() showLaterActions = false;
  @Input() laterPendingConversationId: string | null = null;
  @Output() readonly laterChanged = new EventEmitter<{ conversationId: string; isLater: boolean }>();

  isSelected(conversation: MessagingConversationListItem): boolean {
    return this.selectedConversationId === conversation.id;
  }

  isUnread(conversation: MessagingConversationListItem): boolean {
    return (conversation.unreadCount ?? 0) > 0;
  }

  rememberListScrollBeforeNavigate(conversationId: string): void {
    if (this.preserveListScroll) {
      this.navigationState.rememberListScroll(conversationId);
    }
  }

  laterActionLabel(conversation: MessagingConversationListItem): string {
    const action = conversation.isLater === true ? 'Remove from Later' : 'Add to Later';
    return `${action}: ${conversation.title}`;
  }
}
