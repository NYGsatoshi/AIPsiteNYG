import { Component, inject } from '@angular/core';

import { ConversationListComponent } from '../conversation-list/conversation-list.component';
import { MessagingFacade } from '../messaging.facade';

@Component({
  selector: 'app-messages-page',
  standalone: true,
  imports: [ConversationListComponent],
  template: `
    <section class="messages-page" data-testid="messages-page">
      <header class="messages-page__header">
        <p class="messages-page__eyebrow">Messages</p>
        <h1>Conversations</h1>
      </header>

      @if (page().inlineError) {
        <p class="messages-page__error" data-testid="messages-list-error">{{ page().inlineError }}</p>
      }

      @if (page().conversations.length > 0) {
        <app-conversation-list [conversations]="page().conversations" />
      } @else if (page().status === 'loading') {
        <p class="messages-page__empty" data-testid="messages-list-loading">Loading conversations...</p>
      } @else {
        <p class="messages-page__empty" data-testid="messages-list-empty">No conversations are available.</p>
      }
    </section>
  `,
  styleUrl: './messages-page.component.scss'
})
export class MessagesPageComponent {
  private readonly facade = inject(MessagingFacade);
  readonly page = this.facade.page;

  constructor() {
    this.facade.loadConversationListPage();
  }
}
