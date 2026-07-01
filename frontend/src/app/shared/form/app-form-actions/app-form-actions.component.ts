import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-form-actions',
  standalone: true,
  template: `
    <div class="form-actions" [class.form-actions--end]="align === 'end'">
      <ng-content />
    </div>
  `,
  styles: [
    `
      .form-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }

      .form-actions--end {
        justify-content: flex-end;
      }
    `
  ]
})
export class AppFormActionsComponent {
  @Input() align: 'start' | 'end' = 'end';
}
