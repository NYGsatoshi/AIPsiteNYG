import { Component, inject } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import {
  TaskNotificationPreferencesFacade,
  taskNotificationPreferenceTimeOptions,
} from './task-notification-preferences.facade';

@Component({
  selector: 'app-task-notification-preferences',
  standalone: true,
  template: `
    @let preference = viewModel();
    <section class="task-notification-preferences" aria-labelledby="task-notification-preferences-title">
      <div class="task-notification-preferences__header">
        <div>
          <p class="task-notification-preferences__eyebrow">{{ i18n.translate('notifications.eyebrow') }}</p>
          <h2 id="task-notification-preferences-title">{{ i18n.translate('notifications.title') }}</h2>
        </div>
        <button type="button" (click)="refresh()" [disabled]="preference.status === 'loading' || preference.status === 'saving'">
          {{ i18n.translate('notifications.refresh') }}
        </button>
      </div>

      @if (preference.status === 'idle') {
        <p class="task-notification-preferences__muted" role="status">{{ i18n.translate('notifications.idle') }}</p>
      } @else if (preference.status === 'loading') {
        <p role="status">{{ i18n.translate('notifications.loading') }}</p>
      } @else if (preference.status === 'permissionDenied') {
        <p class="task-notification-preferences__error" role="status">{{ preference.message }}</p>
      } @else {
        <p class="task-notification-preferences__timezone">
          {{ i18n.translate('notifications.timezone') }} <strong>{{ preference.workspaceTimeZoneId }}</strong>
        </p>
        <label for="task-notification-time">{{ i18n.translate('notifications.digestTime') }}</label>
        <select
          id="task-notification-time"
          [value]="preference.storedDeadlineDigestLocalTime ?? 'inherit'"
          [disabled]="preference.status === 'saving'"
          (change)="selectTime($any($event.target).value)"
        >
          <option value="inherit">{{ i18n.translate('notifications.inherit', { time: preference.effectiveDeadlineDigestLocalTime ?? '' }) }}</option>
          @for (time of timeOptions; track time) {
            <option [value]="time">{{ time }}</option>
          }
        </select>
        <p class="task-notification-preferences__muted">
          {{ i18n.translate('notifications.savedValue', { value: preference.storedDeadlineDigestLocalTime ?? i18n.translate('notifications.inherited') }) }}
        </p>
        @if (preference.status === 'saving') {
          <p role="status">{{ i18n.translate('notifications.saving') }}</p>
        }
        @if (preference.message) {
          <p class="task-notification-preferences__error" role="status">{{ preference.message }}</p>
        }
      }
    </section>
  `,
  styleUrl: './task-notification-preferences.component.scss',
})
export class TaskNotificationPreferencesComponent {
  readonly i18n = inject(I18nService);
  private readonly preferences = inject(TaskNotificationPreferencesFacade);
  readonly viewModel = this.preferences.viewModel;
  readonly timeOptions = taskNotificationPreferenceTimeOptions();

  refresh(): void {
    this.preferences.refresh();
  }

  selectTime(value: string): void {
    this.preferences.save(value === 'inherit' ? null : value);
  }
}
