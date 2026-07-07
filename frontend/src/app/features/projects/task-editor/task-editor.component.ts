import { Component, Input, OnChanges } from '@angular/core';
import { AbstractControl, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators, FormControl, FormGroup } from '@angular/forms';

import {
  BackendAuthoritativeTransitionNote,
  ProjectCapability,
  TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE,
  TaskDetailState,
  TaskMockRecord,
  TaskPriority,
  TaskStatus
} from '../projects.types';

export const integerRangeValidator = (min: number, max: number): ValidatorFn => {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === '') {
      return null;
    }

    const numericValue = Number(value);
    if (!Number.isInteger(numericValue)) {
      return { integer: true };
    }

    if (numericValue < min || numericValue > max) {
      return { range: { min, max } };
    }

    return null;
  };
};

@Component({
  selector: 'app-task-editor',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    @if (task) {
      <form class="task-editor" [formGroup]="form" data-testid="task-editor">
        @if (state === 'rowVersionConflict') {
          <section class="task-editor__recoverable" data-testid="row-version-conflict">
            <h2>RowVersionConflict</h2>
            <p>The mock save detected a stale row version. P0 uses reload-after-save before live API conflict handling.</p>
            <button type="button">Reload</button>
          </section>
        }

        @if (state === 'invalidStateTransition') {
          <section class="task-editor__recoverable" data-testid="invalid-state-transition">
            <h2>InvalidStateTransition</h2>
            <p>The selected transition is no longer allowed. Reload the task and use the backend-authorized transition list.</p>
          </section>
        }

        <p class="task-editor__note" data-testid="status-transition-authoritative-note">
          {{ transitionNote.message }}
        </p>
        <p class="task-editor__note" data-testid="task-editor-readonly-note">
          Task editing is not available in MVP0. Values are read-only until a backend save path is wired.
        </p>

        <label>
          <span>Title</span>
          <input type="text" formControlName="title" data-testid="task-title-input" readonly />
        </label>

        <label>
          <span>Description</span>
          <textarea formControlName="description" rows="4" data-testid="task-description-input" readonly></textarea>
        </label>

        <label>
          <span>Status</span>
          <select
            formControlName="status"
            data-testid="task-status-select"
            aria-disabled="true"
            tabindex="-1"
            (mousedown)="preventEdit($event)"
            (keydown)="preventEdit($event)"
          >
            @for (status of statuses; track status.value) {
              <option [value]="status.value" [disabled]="isUnsupportedTransition(status.value)">
                {{ status.label }}
              </option>
            }
          </select>
        </label>

        <label>
          <span>Priority</span>
          <select
            formControlName="priority"
            data-testid="task-priority-select"
            aria-disabled="true"
            tabindex="-1"
            (mousedown)="preventEdit($event)"
            (keydown)="preventEdit($event)"
          >
            @for (priority of priorities; track priority.value) {
              <option [value]="priority.value">{{ priority.label }}</option>
            }
          </select>
        </label>

        <label>
          <span>Due date</span>
          <input type="date" formControlName="dueDate" data-testid="task-due-date-input" readonly />
        </label>

        <label>
          <span>Assignee</span>
          <input type="text" formControlName="assignee" data-testid="task-assignee-input" readonly />
        </label>

        <label>
          <span>Start date</span>
          <input type="date" formControlName="startDate" data-testid="task-start-date-input" readonly />
        </label>

        <label>
          <span>Progress percent</span>
          <input type="number" formControlName="progressPercent" data-testid="task-progress-input" readonly />
          @if (form.controls.progressPercent.invalid && form.controls.progressPercent.touched) {
            <small data-testid="task-progress-error">Progress must be an integer from 0 to 100.</small>
          }
        </label>

        <label>
          <span>Milestone</span>
          <input
            type="text"
            formControlName="milestone"
            readonly
            aria-readonly="true"
            data-testid="task-milestone-input"
          />
        </label>

        <button type="button" class="task-editor__save" data-testid="task-save-disabled" disabled>
          Save not available in MVP0
        </button>
      </form>
    }
  `,
  styles: [
    `
      .task-editor {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
      }

      .task-editor label,
      .task-editor__recoverable,
      .task-editor__note {
        display: grid;
        gap: 0.375rem;
      }

      .task-editor label:nth-of-type(2),
      .task-editor__recoverable,
      .task-editor__note {
        grid-column: 1 / -1;
      }

      .task-editor input,
      .task-editor select,
      .task-editor textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 0.625rem 0.75rem;
        border: 1px solid #b7c2d6;
        border-radius: 0.5rem;
        font: inherit;
      }

      .task-editor input[readonly],
      .task-editor textarea[readonly],
      .task-editor select[aria-disabled='true'] {
        background: #eef2f7;
        color: #475569;
      }

      .task-editor small {
        color: #a33131;
      }

      .task-editor__note,
      .task-editor__recoverable {
        padding: 0.75rem;
        border: 1px solid #c7d0df;
        border-radius: 0.5rem;
        background: #f7f9fc;
      }

      .task-editor__recoverable h2,
      .task-editor__recoverable p,
      .task-editor__note {
        margin: 0;
      }

      .task-editor__save {
        justify-self: start;
        min-height: 40px;
        border: 1px solid #94a3b8;
        border-radius: 6px;
        background: #e2e8f0;
        color: #475569;
        font-weight: 700;
        cursor: not-allowed;
        padding: 0 14px;
      }

      @media (max-width: 720px) {
        .task-editor {
          grid-template-columns: 1fr;
        }

        .task-editor label:nth-of-type(2),
        .task-editor__recoverable,
        .task-editor__note {
          grid-column: auto;
        }
      }
    `
  ]
})
export class TaskEditorComponent implements OnChanges {
  @Input() task: TaskMockRecord | undefined;
  @Input() capabilities: readonly ProjectCapability[] = [];
  @Input() state: TaskDetailState = 'ready';
  @Input() transitionNote: BackendAuthoritativeTransitionNote = TASK_STATUS_BACKEND_AUTHORITATIVE_NOTE;

  readonly statuses: readonly { value: TaskStatus; label: string }[] = [
    { value: 'notStarted', label: 'Not started' },
    { value: 'inProgress', label: 'In progress' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'review', label: 'Review' },
    { value: 'done', label: 'Done' }
  ];
  readonly priorities: readonly { value: TaskPriority; label: string }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' }
  ];

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    description: new FormControl('', { nonNullable: true }),
    status: new FormControl<TaskStatus>('notStarted', { nonNullable: true }),
    priority: new FormControl<TaskPriority>('medium', { nonNullable: true }),
    dueDate: new FormControl('', { nonNullable: true }),
    assignee: new FormControl('', { nonNullable: true }),
    startDate: new FormControl('', { nonNullable: true }),
    progressPercent: new FormControl(0, { nonNullable: true, validators: [integerRangeValidator(0, 100)] }),
    milestone: new FormControl('', { nonNullable: true })
  });

  get canEditMilestone(): boolean {
    return this.capabilities.includes('editMilestone');
  }

  preventEdit(event: Event): void {
    event.preventDefault();
  }

  ngOnChanges(): void {
    if (!this.task) {
      return;
    }

    this.form.setValue({
      title: this.task.title,
      description: this.task.description,
      status: this.task.status,
      priority: this.task.priority,
      dueDate: this.task.dueDate,
      assignee: this.task.assignee,
      startDate: this.task.startDate,
      progressPercent: this.task.progressPercent,
      milestone: this.task.milestone
    });
  }

  isUnsupportedTransition(status: TaskStatus): boolean {
    if (!this.task || status === this.task.status) {
      return false;
    }

    return !this.task.allowedTransitions.includes(status);
  }
}
