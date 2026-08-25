import { Component, Input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { TASK_BRIEF_FIELD_MAX_LENGTH } from '../projects.types';

@Component({
  selector: 'app-task-brief-fields',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <fieldset class="task-brief" data-testid="task-brief-fields">
      <legend>Task brief</legend>
      <p class="task-brief__intro" id="task-brief-help">
        Optional, Task-specific guidance. Authorized Project context is shown separately and is not copied into these fields.
      </p>

      <div class="task-brief__fields">
        <label>
          <span class="task-brief__label">Goal <small>(optional)</small></span>
          <span class="task-brief__source" data-testid="task-brief-goal-source">{{ sourceLabel(goalControl) }}</span>
          <textarea
            [formControl]="goalControl"
            rows="3"
            [maxLength]="maxLength"
            [readonly]="readonly"
            [attr.aria-invalid]="isInvalid(goalControl) ? 'true' : null"
            aria-describedby="task-brief-help task-brief-goal-limit task-brief-goal-error"
            data-testid="task-brief-goal-input"
          ></textarea>
          <small id="task-brief-goal-limit">What should be true when this Task is complete. Up to {{ maxLength }} characters.</small>
          @if (goalControl.hasError('maxlength') && goalControl.touched) {
            <strong id="task-brief-goal-error" class="task-brief__error" role="alert">Goal must be {{ maxLength }} characters or fewer.</strong>
          }
        </label>

        <label>
          <span class="task-brief__label">Deliverable <small>(optional)</small></span>
          <span class="task-brief__source" data-testid="task-brief-deliverable-source">{{ sourceLabel(deliverableControl) }}</span>
          <textarea
            [formControl]="deliverableControl"
            rows="3"
            [maxLength]="maxLength"
            [readonly]="readonly"
            [attr.aria-invalid]="isInvalid(deliverableControl) ? 'true' : null"
            aria-describedby="task-brief-help task-brief-deliverable-limit task-brief-deliverable-error"
            data-testid="task-brief-deliverable-input"
          ></textarea>
          <small id="task-brief-deliverable-limit">The concrete output to hand off or publish. Up to {{ maxLength }} characters.</small>
          @if (deliverableControl.hasError('maxlength') && deliverableControl.touched) {
            <strong id="task-brief-deliverable-error" class="task-brief__error" role="alert">Deliverable must be {{ maxLength }} characters or fewer.</strong>
          }
        </label>

        <label>
          <span class="task-brief__label">Constraints <small>(optional)</small></span>
          <span class="task-brief__source" data-testid="task-brief-constraints-source">{{ sourceLabel(constraintsControl) }}</span>
          <textarea
            [formControl]="constraintsControl"
            rows="3"
            [maxLength]="maxLength"
            [readonly]="readonly"
            [attr.aria-invalid]="isInvalid(constraintsControl) ? 'true' : null"
            aria-describedby="task-brief-help task-brief-constraints-limit task-brief-constraints-error"
            data-testid="task-brief-constraints-input"
          ></textarea>
          <small id="task-brief-constraints-limit">Boundaries, requirements, or conditions to preserve. Up to {{ maxLength }} characters.</small>
          @if (constraintsControl.hasError('maxlength') && constraintsControl.touched) {
            <strong id="task-brief-constraints-error" class="task-brief__error" role="alert">Constraints must be {{ maxLength }} characters or fewer.</strong>
          }
        </label>
      </div>

      <section class="task-brief__review" aria-labelledby="task-brief-review-heading" data-testid="task-brief-review">
        <h3 id="task-brief-review-heading">Review before starting</h3>
        <dl>
          <div data-testid="task-brief-review-goal"><dt>Goal</dt><dd>{{ reviewValue(goalControl) }}</dd></div>
          <div data-testid="task-brief-review-deliverable"><dt>Deliverable</dt><dd>{{ reviewValue(deliverableControl) }}</dd></div>
          <div data-testid="task-brief-review-constraints"><dt>Constraints</dt><dd>{{ reviewValue(constraintsControl) }}</dd></div>
        </dl>
      </section>
    </fieldset>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .task-brief { min-width: 0; margin: 0; padding: 1rem; border: 1px solid var(--aip-color-border-default); border-radius: .75rem; }
    .task-brief legend { padding: 0 .35rem; font-size: 1.05rem; font-weight: 750; }
    .task-brief__intro { margin: 0 0 1rem; color: var(--aip-color-text-secondary); }
    .task-brief__fields { display: grid; gap: 1rem; }
    .task-brief label { display: grid; min-width: 0; gap: .375rem; }
    .task-brief__label { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem; font-weight: 700; }
    .task-brief__label small { color: var(--aip-color-text-secondary); font-weight: 500; }
    .task-brief__source { justify-self: start; padding: .2rem .5rem; border-radius: 999px; background: var(--aip-color-bg-selected); color: var(--aip-color-action-primary); font-size: .78rem; font-weight: 700; }
    .task-brief textarea { width: 100%; min-width: 0; box-sizing: border-box; resize: vertical; padding: .625rem .75rem; border: 1px solid var(--aip-color-border-strong); border-radius: .5rem; background: var(--aip-color-bg-control); color: var(--aip-color-text-primary); font: inherit; }
    .task-brief textarea[readonly] { background: var(--aip-color-bg-surface-subtle); color: var(--aip-color-text-secondary); }
    .task-brief label > small { color: var(--aip-color-text-secondary); }
    .task-brief__error { color: var(--aip-color-danger); font-size: .8rem; }
    .task-brief__review { min-width: 0; margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--aip-color-border-default); }
    .task-brief__review h3 { margin: 0 0 .75rem; font-size: 1rem; }
    .task-brief__review dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; margin: 0; }
    .task-brief__review dl > div { min-width: 0; padding: .75rem; border-radius: .5rem; background: var(--aip-color-bg-surface-subtle); }
    .task-brief__review dt { font-weight: 700; }
    .task-brief__review dd { margin: .35rem 0 0; color: var(--aip-color-text-secondary); overflow-wrap: anywhere; white-space: pre-wrap; }
    @media (max-width: 720px) { .task-brief__review dl { grid-template-columns: 1fr; } }
  `]
})
export class TaskBriefFieldsComponent {
  @Input({ required: true }) goalControl!: FormControl<string>;
  @Input({ required: true }) deliverableControl!: FormControl<string>;
  @Input({ required: true }) constraintsControl!: FormControl<string>;
  @Input() readonly = false;

  readonly maxLength = TASK_BRIEF_FIELD_MAX_LENGTH;

  sourceLabel(control: FormControl<string>): string {
    return control.value.trim().length > 0 ? 'Task-specific' : 'Not set';
  }

  reviewValue(control: FormControl<string>): string {
    return control.value.trim() || 'Not set';
  }

  isInvalid(control: FormControl<string>): boolean {
    return control.touched && control.hasError('maxlength');
  }
}
