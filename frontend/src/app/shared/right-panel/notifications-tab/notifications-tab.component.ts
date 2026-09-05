import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { NotificationItemComponent } from '../notification-item/notification-item.component';
import { RightPanelNotification } from '../right-panel.types';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-notifications-tab',
  standalone: true,
  imports: [NotificationItemComponent],
  template: `
    <section class="notifications-tab" aria-label="通知">
      <p class="notifications-tab__note">通知は現在のスコープに限定されます。未対応の対象はリンクにしません。</p>
      @if (notifications.length > 0) {
        <div class="notifications-tab__list">
          @for (notification of notifications; track notification.id) {
            <app-notification-item
              [notification]="notification"
              (targetSelected)="targetSelected.emit($event)"
              (markReadRequested)="markReadRequested.emit($event)"
            />
          }
        </div>
      } @else {
        <p class="notifications-tab__empty">表示できる通知はありません。</p>
      }
    </section>
  `,
  styleUrl: './notifications-tab.component.scss',
})
export class NotificationsTabComponent {
  @Input({ required: true }) notifications: readonly RightPanelNotification[] = [];
  @Output() readonly targetSelected = new EventEmitter<string>();
  @Output() readonly markReadRequested = new EventEmitter<string>();
}
