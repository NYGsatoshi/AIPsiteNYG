import { Component, EventEmitter, Input, Output } from '@angular/core';

import { FailedMessageItemComponent } from '../failed-message-item/failed-message-item.component';
import { MessageItemComponent } from '../message-item/message-item.component';
import { MessagingMessageViewModel, MessagingPageStatus } from '../messaging.types';
import { NewMessageBannerComponent } from '../new-message-banner/new-message-banner.component';

@Component({
  selector: 'app-message-timeline',
  standalone: true,
  imports: [FailedMessageItemComponent, MessageItemComponent, NewMessageBannerComponent],
  template: `
    <section class="timeline" data-testid="message-timeline">
      @if (inlineError) {
        <p class="timeline__error" data-testid="manual-refresh-error">{{ inlineError }}</p>
      }

      @if (hasNewMessagesWhileReading) {
        <app-new-message-banner (acknowledge)="acknowledgeNewMessages.emit()" />
      }

      @if (!canReadBody || status === 'permissionDenied' || status === 'removedParticipant') {
        <section class="timeline__empty" data-testid="body-hidden-state">
          <h2>Message body unavailable</h2>
          <p>Conversation membership and read permission are required.</p>
        </section>
      } @else if (messages.length === 0 || status === 'empty') {
        <section class="timeline__empty" data-testid="no-messages-state">
          <h2>No messages yet</h2>
          <p>Messages will appear after the backend returns them.</p>
        </section>
      } @else {
        <div class="timeline__messages">
          @for (message of messages; track message.id) {
            @if (message.deliveryState === 'failed') {
              <app-failed-message-item [message]="message" (retry)="retry.emit($event)" />
            } @else {
              <app-message-item
                [message]="message"
                [canViewOthersPreciseReadTimestamps]="canViewOthersPreciseReadTimestamps"
              />
            }
          }
        </div>
      }
    </section>
  `,
  styleUrl: './message-timeline.component.scss'
})
export class MessageTimelineComponent {
  @Input() messages: readonly MessagingMessageViewModel[] = [];
  @Input() status: MessagingPageStatus = 'ready';
  @Input() canReadBody = true;
  @Input() canViewOthersPreciseReadTimestamps = false;
  @Input() hasNewMessagesWhileReading = false;
  @Input() inlineError = '';
  @Output() readonly retry = new EventEmitter<string>();
  @Output() readonly loadOlder = new EventEmitter<void>();
  @Output() readonly loadNewer = new EventEmitter<void>();
  @Output() readonly acknowledgeNewMessages = new EventEmitter<void>();
}
