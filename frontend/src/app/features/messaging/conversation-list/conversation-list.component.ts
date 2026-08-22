import { Component, inject, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MessageNavigationStateService } from '../message-navigation-state.service';
import { MessagingConversationListItem } from '../messaging.types';

@Component({
  selector: 'app-conversation-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="conversation-list" aria-label="会話" data-testid="conversation-list">
      @for (conversation of conversations; track conversation.id) {
        <a
          class="conversation-list__item"
          [routerLink]="conversation.route"
          data-testid="conversation-list-item"
          (click)="navigationState.rememberListScroll()"
        >
          <span class="conversation-list__title">{{ conversation.title }}</span>
          <span class="conversation-list__meta">{{ conversation.lastActivityLabel }}</span>
          @if (conversation.kind === 'dm') {
            <span class="conversation-list__preview" data-testid="dm-preview-hidden">DMプレビュー非表示</span>
          } @else {
            <span class="conversation-list__preview" data-testid="channel-preview">{{ conversation.safePreviewLabel }}</span>
          }
          @if (conversation.unreadCount) {
            <span class="conversation-list__badge">{{ conversation.unreadCount }}</span>
          }
        </a>
      }
    </nav>
  `,
  styleUrl: './conversation-list.component.scss'
})
export class ConversationListComponent {
  readonly navigationState = inject(MessageNavigationStateService);
  @Input({ required: true }) conversations: readonly MessagingConversationListItem[] = [];
}
