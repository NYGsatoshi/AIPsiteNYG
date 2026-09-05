import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { RightPanelNotification } from '../right-panel.types';
import { isSupportedNotificationTarget, requiresAuthorizedServerOpen } from '../right-panel.facade';

@Component({
  selector: 'app-notification-item',
  standalone: true,
  imports: [],
  template: `
    <article class="notification" [class.notification--read]="notification.read">
      <div class="notification__header">
        <span class="notification__state">{{ notification.read ? 'Read' : 'Unread' }}</span>
        <span class="notification__target">{{ notification.target.label }}</span>
      </div>
      <h3 class="notification__title">{{ notification.title }}</h3>
      <p class="notification__body">{{ notification.body }}</p>

      <div class="notification__actions">
        @if (canOpenTarget()) {
          <button
            type="button"
            class="notification__link"
            data-testid="notification-target-link"
            (click)="targetSelected.emit(notification.id)"
            [attr.aria-label]="'Open notification target for ' + notification.title"
          >
            対象を開く
          </button>
        } @else {
          <span class="notification__unsupported" data-testid="notification-target-unavailable">
            未対応の通知対象です
          </span>
        }

        @if (!notification.read) {
          <button
            type="button"
            class="notification__mark"
            data-testid="notification-mark-read-action"
            (click)="markReadRequested.emit(notification.id)"
          >
            既読
          </button>
        }
      </div>
    </article>
  `,
  styleUrl: './notification-item.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class NotificationItemComponent {
  @Input({ required: true }) notification!: RightPanelNotification;
  @Output() readonly targetSelected = new EventEmitter<string>();
  @Output() readonly markReadRequested = new EventEmitter<string>();

  canOpenTarget(): boolean {
    return !!this.notification.id && (
      requiresAuthorizedServerOpen(this.notification.target.type) ||
      (isSupportedNotificationTarget(this.notification.target.type) && !!this.notification.target.route)
    );
  }
}
