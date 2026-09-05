import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { MessagingMessageViewModel } from '../messaging.types';

@Component({
  selector: 'app-failed-message-item',
  standalone: true,
  template: `
    <article class="failed-message" data-testid="failed-message">
      <header class="failed-message__meta">
        <span>{{ message.authorLabel }}</span>
        <span>{{ message.sentAtLabel }}</span>
        @if (message.clientRequestId) {
          <span data-testid="client-request-id">{{ message.clientRequestId }}</span>
        }
      </header>
      <p class="failed-message__body" data-testid="failed-message-body">{{ message.body }}</p>
      <p class="failed-message__reason" data-testid="safe-failure-reason">
        {{ message.safeFailureReason ?? 'Message was not sent.' }}
      </p>
      @if (message.retryAllowed) {
        <button type="button" data-testid="retry-failed-message" (click)="retry.emit(message.id)">
          Retry
        </button>
      }
    </article>
  `,
  styleUrl: './failed-message-item.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class FailedMessageItemComponent {
  @Input({ required: true }) message!: MessagingMessageViewModel;
  @Output() readonly retry = new EventEmitter<string>();
}
