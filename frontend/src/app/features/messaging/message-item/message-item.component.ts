import { Component, Input } from '@angular/core';

import { MessagingMessageViewModel } from '../messaging.types';

@Component({
  selector: 'app-message-item',
  standalone: true,
  template: `
    <article
      class="message"
      [attr.data-testid]="message.deliveryState === 'confirmed' ? 'confirmed-message' : 'pending-message'"
      [class.message--own]="message.isOwnMessage"
    >
      <header class="message__meta">
        <span class="message__author">{{ message.authorLabel }}</span>
        <span class="message__role">{{ message.authorRoleLabel }}</span>
        <span class="message__time">{{ message.sentAtLabel }}</span>
      </header>
      <p class="message__body" data-testid="message-body">{{ message.body }}</p>
      @if (message.readState?.ownReadLabel) {
        <p class="message__read" data-testid="own-read-marker">{{ message.readState?.ownReadLabel }}</p>
      }
      @if (message.readState?.otherReadSummaryLabel) {
        <p class="message__read" data-testid="other-read-summary">{{ message.readState?.otherReadSummaryLabel }}</p>
      }
      @if (canViewOthersPreciseReadTimestamps && message.readState?.otherReadPreciseTimestampLabel) {
        <p class="message__read" data-testid="other-read-precise">
          {{ message.readState?.otherReadPreciseTimestampLabel }}
        </p>
      }
    </article>
  `,
  styleUrl: './message-item.component.scss'
})
export class MessageItemComponent {
  @Input({ required: true }) message!: MessagingMessageViewModel;
  @Input() canViewOthersPreciseReadTimestamps = false;
}
