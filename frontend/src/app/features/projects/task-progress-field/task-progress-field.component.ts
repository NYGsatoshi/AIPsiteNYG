import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-task-progress-field',
  standalone: true,
  template: `
    <div class="task-progress-field" data-testid="task-progress-field">
      <span>{{ value }}%</span>
      <meter min="0" max="100" [value]="value">{{ value }}%</meter>
    </div>
  `,
  styles: [
    `
      .task-progress-field {
        display: grid;
        gap: 0.25rem;
        min-width: 6rem;
      }

      .task-progress-field span {
        font-weight: 700;
      }

      .task-progress-field meter {
        width: 100%;
      }
    `
  ]
})
export class TaskProgressFieldComponent {
  @Input({ required: true }) value = 0;
}
