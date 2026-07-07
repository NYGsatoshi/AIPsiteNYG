import { Component, Input } from '@angular/core';

import { RightPanelNotification } from '../right-panel.types';

@Component({
  selector: 'app-notification-item',
  standalone: true,
  template: `
    <article class="notification" [class.notification--read]="notification.read">
      <div class="notification__header">
        <span class="notification__state">{{ notification.read ? 'Read' : 'Unread' }}</span>
        <span class="notification__target">{{ notification.target.label }}</span>
      </div>
      <h3 class="notification__title">{{ notification.title }}</h3>
      <p class="notification__body">{{ notification.body }}</p>

      <div class="notification__actions">
        <span class="notification__unsupported" data-testid="notification-target-unavailable">
          Target navigation and mark-read actions are not available in MVP0.
        </span>
      </div>
    </article>
  `,
  styleUrl: './notification-item.component.scss'
})
export class NotificationItemComponent {
  @Input({ required: true }) notification!: RightPanelNotification;
}
