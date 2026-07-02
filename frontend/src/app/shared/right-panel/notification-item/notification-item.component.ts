import { Component, EventEmitter, Input, Output } from '@angular/core';

import { isSupportedNotificationTarget } from '../right-panel.facade';
import { RightPanelNotification } from '../right-panel.types';

@Component({
  selector: 'app-notification-item',
  standalone: true,
  template: `
    <article class="notification" [class.notification--read]="notification.read">
      <div class="notification__header">
        <span class="notification__state">{{ notification.read ? '既読' : '未読' }}</span>
        <span class="notification__target">{{ notification.target.label }}</span>
      </div>
      <h3 class="notification__title">{{ notification.title }}</h3>
      <p class="notification__body">{{ notification.body }}</p>

      <div class="notification__actions">
        @if (supportedTarget) {
          <a
            class="notification__link"
            [href]="safeHref"
            (click)="openTarget($event)"
          >
            対象を表示
          </a>
        } @else {
          <span class="notification__unsupported">未対応の対象です</span>
          @if (!notification.read) {
            <button type="button" class="notification__mark" (click)="markRead.emit(notification.id)">
              既読にする
            </button>
          }
        }
      </div>
    </article>
  `,
  styleUrl: './notification-item.component.scss'
})
export class NotificationItemComponent {
  @Input({ required: true }) notification!: RightPanelNotification;
  @Output() targetSelected = new EventEmitter<string>();
  @Output() markRead = new EventEmitter<string>();

  get supportedTarget(): boolean {
    return isSupportedNotificationTarget(this.notification.target.type);
  }

  get safeHref(): string {
    return `#right-panel-${this.notification.id}`;
  }

  openTarget(event: Event): void {
    event.preventDefault();
    this.targetSelected.emit(this.notification.id);
  }
}
