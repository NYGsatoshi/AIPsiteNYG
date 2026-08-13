import { Component, inject } from '@angular/core';

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
          <p class="task-notification-preferences__eyebrow">Current Workspace</p>
          <h2 id="task-notification-preferences-title">Task notification timing</h2>
        </div>
        <button type="button" (click)="refresh()" [disabled]="preference.status === 'loading' || preference.status === 'saving'">
          Refresh
        </button>
      </div>

      @if (preference.status === 'idle') {
        <p class="task-notification-preferences__muted" role="status">Choose an active Workspace to view this preference.</p>
      } @else if (preference.status === 'loading') {
        <p role="status">Loading the current Workspace preference…</p>
      } @else if (preference.status === 'permissionDenied') {
        <p class="task-notification-preferences__error" role="status">{{ preference.message }}</p>
      } @else {
        <p class="task-notification-preferences__timezone">
          Workspace timezone: <strong>{{ preference.workspaceTimeZoneId }}</strong>
        </p>
        <label for="task-notification-time">Daily task deadline digest time</label>
        <select
          id="task-notification-time"
          [value]="preference.storedDeadlineDigestLocalTime ?? 'inherit'"
          [disabled]="preference.status === 'saving'"
          (change)="selectTime($any($event.target).value)"
        >
          <option value="inherit">Use Workspace default (effective {{ preference.effectiveDeadlineDigestLocalTime }})</option>
          @for (time of timeOptions; track time) {
            <option [value]="time">{{ time }}</option>
          }
        </select>
        <p class="task-notification-preferences__muted">
          The saved value is {{ preference.storedDeadlineDigestLocalTime ?? 'inherited' }}. Times are evaluated in the Workspace timezone.
        </p>
        @if (preference.status === 'saving') {
          <p role="status">Saving preference…</p>
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
