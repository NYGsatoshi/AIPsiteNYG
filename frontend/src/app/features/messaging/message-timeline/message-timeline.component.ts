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
      <div class="timeline__actions">
        <button type="button" data-testid="load-older" (click)="loadOlder.emit()">古いメッセージ</button>
        <button type="button" data-testid="load-newer" (click)="loadNewer.emit()">新しいメッセージ</button>
      </div>

      @if (inlineError) {
        <p class="timeline__error" data-testid="manual-refresh-error">{{ inlineError }}</p>
      }

      @if (hasNewMessagesWhileReading) {
        <app-new-message-banner (acknowledge)="acknowledgeNewMessages.emit()" />
      }

      @if (!canReadBody || status === 'permissionDenied' || status === 'removedParticipant') {
        <section class="timeline__empty" data-testid="body-hidden-state">
          <h2>本文は表示できません</h2>
          <p>参加者と権限を確認できるまで、本文・添付・既読状態は表示しません。</p>
        </section>
      } @else if (messages.length === 0 || status === 'empty') {
        <section class="timeline__empty" data-testid="no-messages-state">
          <h2>まだメッセージはありません</h2>
          <p>手動更新しても下書きは保持されます。</p>
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
