import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { LucideBan, LucideClock, LucideFileCheck, LucideFileX } from '@lucide/angular';

import {
  AppDataGridActionEvent,
  AppDataGridColumnDef
} from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { WorkStatusBadgeComponent } from '../../../shared/ui/work-status/work-status-badge.component';
import { WorkStatus } from '../../../shared/ui/work-status/work-status';
import {
  taskStageCategoryLabel,
  taskStageWorkStatus
} from '../projects.mapper';
import { TaskGridRow, TaskRowAction, TaskStageCategory } from '../projects.types';

@Component({
  selector: 'app-task-stage-category-cell',
  standalone: true,
  imports: [WorkStatusBadgeComponent],
  template: `
    @if (row) {
      <app-work-status-badge
        [status]="workStatus"
        [attr.data-testid]="'task-category-' + row.id + '-desktop'"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TaskStageCategoryCellComponent {
  row: TaskGridRow | null = null;

  get workStatus(): WorkStatus {
    return taskStageWorkStatus(taskRowStageCategory(this.row));
  }

  agInit(params: { data?: TaskGridRow }): void {
    this.row = params.data ?? null;
  }

  refresh(params: { data?: TaskGridRow }): boolean {
    this.row = params.data ?? null;
    return true;
  }
}

@Component({
  selector: 'app-task-table',
  standalone: true,
  imports: [
    AppDataGridComponent,
    LucideBan,
    LucideClock,
    LucideFileCheck,
    LucideFileX,
    WorkStatusBadgeComponent
  ],
  template: `
    <div class="task-state-list" data-testid="task-state-list">
      <div class="task-state-list__grid" data-testid="task-state-grid">
        <app-data-grid
          ariaLabel="Project tasks"
          rowIdField="id"
          [rows]="rows"
          [columns]="columns"
          [defaultPageSize]="defaultPageSize"
          [maximumPageSize]="maximumPageSize"
          (actionInvoked)="actionInvoked.emit($event)"
        />
      </div>

      <div class="task-state-list__cards" data-testid="task-state-cards">
        @if (rows.length === 0) {
          <p class="task-state-list__empty">No tasks are available.</p>
        } @else {
          <ul class="task-state-cards" role="list">
            @for (row of rows; track row.id) {
              <li
                class="task-state-card"
                [attr.data-task-id]="row.id"
                [attr.data-testid]="'task-state-card-' + row.id + '-mobile'"
              >
                <h3 class="task-state-card__title">{{ row.title }}</h3>

                <dl class="task-state-card__details">
                  <div class="task-state-card__detail">
                    <dt>Stage</dt>
                    <dd [attr.data-testid]="'task-stage-name-' + row.id + '-mobile'">
                      {{ stageName(row) }}
                    </dd>
                  </div>
                  <div class="task-state-card__detail">
                    <dt>Category</dt>
                    <dd>
                      <app-work-status-badge
                        [status]="stageWorkStatus(row)"
                        [attr.data-testid]="'task-category-' + row.id + '-mobile'"
                      />
                    </dd>
                  </div>
                  <div class="task-state-card__detail">
                    <dt>Blocking</dt>
                    <dd
                      class="task-state-card__indicator"
                      [class.task-state-card__indicator--blocked]="isBlocked(row)"
                      [attr.data-testid]="'task-blocked-' + row.id + '-mobile'"
                    >
                      @if (isBlocked(row)) {
                        <svg lucideBan aria-hidden="true"></svg>
                        <span>Blocked</span>
                      } @else {
                        <span>Not blocked</span>
                      }
                    </dd>
                  </div>
                  <div class="task-state-card__detail">
                    <dt>Last update</dt>
                    <dd [attr.data-testid]="'task-updated-' + row.id + '-mobile'">
                      @if (updatedAt(row); as timestamp) {
                        <span class="task-state-card__indicator">
                          <svg lucideClock aria-hidden="true"></svg>
                          <time [attr.datetime]="timestamp">{{ formatTimestamp(timestamp) }}</time>
                        </span>
                      } @else {
                        <span>Not available</span>
                      }
                    </dd>
                  </div>
                  <div class="task-state-card__detail">
                    <dt>Artifact</dt>
                    <dd
                      class="task-state-card__indicator"
                      [attr.data-testid]="'task-artifact-' + row.id + '-mobile'"
                    >
                      @if (artifactAvailability(row) === true) {
                        <svg lucideFileCheck aria-hidden="true"></svg>
                        <span>Artifact available</span>
                      } @else if (artifactAvailability(row) === false) {
                        <svg lucideFileX aria-hidden="true"></svg>
                        <span>No artifact</span>
                      } @else {
                        <span>Artifact state unavailable</span>
                      }
                    </dd>
                  </div>
                </dl>

                <div class="task-state-card__actions">
                  @for (action of row.rowActions; track action.id) {
                    <button
                      type="button"
                      class="task-state-card__action"
                      [disabled]="action.disabled"
                      [attr.aria-disabled]="action.disabled"
                      [attr.title]="action.disabledReason ?? null"
                      [attr.data-testid]="'task-' + action.id + '-' + row.id + '-mobile'"
                      (click)="invokeCardAction(row, action, $event)"
                    >
                      {{ action.label }}
                    </button>
                  }
                </div>
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
  styleUrl: './task-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TaskTableComponent {
  @Input() rows: readonly TaskGridRow[] = [];
  @Input() defaultPageSize = 50;
  @Input() maximumPageSize = 100;
  @Output() actionInvoked = new EventEmitter<AppDataGridActionEvent<TaskGridRow>>();

  readonly columns: readonly AppDataGridColumnDef<TaskGridRow>[] = [
    {
      field: 'title',
      headerName: 'Title',
      minWidth: 160,
      flex: 1.4,
      wrapText: true,
      autoHeight: true,
      cellRenderer: (params: { data?: TaskGridRow }) => this.renderTitle(params.data)
    },
    {
      colId: 'workflowStageName',
      headerName: 'Stage',
      minWidth: 110,
      flex: 0.9,
      valueGetter: ({ data }) => data ? this.stageName(data) : '',
      cellRenderer: (params: { data?: TaskGridRow }) => this.renderStageName(params.data)
    },
    {
      colId: 'stageCategory',
      headerName: 'Category',
      minWidth: 120,
      flex: 0.9,
      valueGetter: ({ data }) => data ? taskStageCategoryLabel(taskRowStageCategory(data)) : '',
      cellRenderer: TaskStageCategoryCellComponent
    },
    {
      colId: 'isBlocked',
      headerName: 'Blocking',
      minWidth: 90,
      flex: 0.7,
      valueGetter: ({ data }) => data ? this.isBlocked(data) : false,
      cellRenderer: (params: { data?: TaskGridRow }) => this.renderBlocked(params.data)
    },
    {
      colId: 'updatedAt',
      headerName: 'Last update',
      minWidth: 140,
      flex: 0.9,
      valueGetter: ({ data }) => data ? this.updatedAt(data) : '',
      cellRenderer: (params: { data?: TaskGridRow }) => this.renderUpdatedAt(params.data)
    },
    {
      colId: 'hasArtifact',
      headerName: 'Artifact',
      minWidth: 115,
      flex: 0.7,
      valueGetter: ({ data }) => data ? this.artifactAvailability(data) : null,
      cellRenderer: (params: { data?: TaskGridRow }) => this.renderArtifact(params.data)
    },
    {
      colId: 'rowActions',
      headerName: 'Actions',
      minWidth: 90,
      flex: 0.6,
      sortable: false,
      filter: false,
      cellRenderer: (params: { data?: TaskGridRow }) => this.renderActions(params.data)
    },
    {
      field: 'project',
      headerName: 'Project',
      minWidth: 180,
      flex: 1
    },
    {
      field: 'priorityLabel',
      headerName: 'Priority',
      minWidth: 120,
      flex: 0.7
    },
    {
      field: 'assignee',
      headerName: 'Assignee',
      minWidth: 160,
      flex: 0.9
    },
    {
      field: 'startDate',
      headerName: 'Start',
      minWidth: 130,
      flex: 0.7
    },
    {
      field: 'dueDate',
      headerName: 'Due',
      minWidth: 130,
      flex: 0.7
    },
    {
      field: 'progressPercent',
      headerName: 'Progress',
      minWidth: 120,
      flex: 0.7,
      valueFormatter: (params) => params.value === null || params.value === undefined
        ? 'Not shown'
        : `${params.value}%`
    },
    {
      field: 'milestone',
      headerName: 'Milestone',
      minWidth: 160,
      flex: 0.9
    }
  ];

  stageName(row: TaskGridRow): string {
    return row.workflowStageName || row.statusLabel;
  }

  stageWorkStatus(row: TaskGridRow): WorkStatus {
    return taskStageWorkStatus(taskRowStageCategory(row));
  }

  isBlocked(row: TaskGridRow): boolean {
    return row.isBlocked ?? row.status === 'blocked';
  }

  updatedAt(row: TaskGridRow): string {
    return row.updatedAt || row.createdAt || '';
  }

  artifactAvailability(row: TaskGridRow): boolean | null {
    return typeof row.hasArtifact === 'boolean' ? row.hasArtifact : null;
  }

  formatTimestamp(timestamp: string): string {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return timestamp;
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(parsed);
  }

  invokeCardAction(row: TaskGridRow, action: TaskRowAction, event: Event): void {
    if (action.disabled) {
      return;
    }
    this.actionInvoked.emit({
      actionId: action.id,
      row,
      trigger: event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
    });
  }

  private renderTitle(row: TaskGridRow | undefined): HTMLElement | string {
    if (!row) return '';
    const title = document.createElement('span');
    title.textContent = row.title;
    title.dataset['taskId'] = row.id;
    title.dataset['testid'] = `task-state-row-${row.id}-desktop`;
    return title;
  }

  private renderStageName(row: TaskGridRow | undefined): HTMLElement | string {
    if (!row) return '';
    const stage = document.createElement('span');
    stage.textContent = this.stageName(row);
    stage.dataset['testid'] = `task-stage-name-${row.id}-desktop`;
    return stage;
  }

  private renderBlocked(row: TaskGridRow | undefined): HTMLElement | string {
    if (!row) return '';
    const indicator = document.createElement('span');
    indicator.textContent = this.isBlocked(row) ? 'Blocked' : 'Not blocked';
    indicator.dataset['testid'] = `task-blocked-${row.id}-desktop`;
    indicator.dataset['blocked'] = String(this.isBlocked(row));
    return indicator;
  }

  private renderUpdatedAt(row: TaskGridRow | undefined): HTMLElement | string {
    if (!row) return '';
    const timestamp = this.updatedAt(row);
    const container = document.createElement('span');
    container.dataset['testid'] = `task-updated-${row.id}-desktop`;
    if (!timestamp) {
      container.textContent = 'Not available';
      return container;
    }
    const time = document.createElement('time');
    time.dateTime = timestamp;
    time.textContent = this.formatTimestamp(timestamp);
    container.append(time);
    return container;
  }

  private renderArtifact(row: TaskGridRow | undefined): HTMLElement | string {
    if (!row) return '';
    const indicator = document.createElement('span');
    const availability = this.artifactAvailability(row);
    indicator.textContent = availability === true
      ? 'Artifact available'
      : availability === false
        ? 'No artifact'
        : 'Artifact state unavailable';
    indicator.dataset['testid'] = `task-artifact-${row.id}-desktop`;
    indicator.dataset['hasArtifact'] = availability === null ? 'unknown' : String(availability);
    return indicator;
  }

  private renderActions(row: TaskGridRow | undefined): HTMLElement | string {
    if (!row) return '';
    const container = document.createElement('div');
    container.className = 'app-grid-actions';

    row.rowActions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-grid-actions__button';
      button.dataset['gridAction'] = action.id;
      button.dataset['testid'] = `task-${action.id}-${row.id}-desktop`;
      button.textContent = action.label;
      button.disabled = action.disabled;
      button.setAttribute('aria-disabled', String(action.disabled));
      if (action.disabledReason) {
        button.title = action.disabledReason;
      }
      container.append(button);
    });

    return container;
  }
}

function taskRowStageCategory(row: TaskGridRow | null | undefined): TaskStageCategory {
  if (row?.stageCategory) {
    return row.stageCategory;
  }

  switch (row?.status) {
    case 'inProgress': return 'inProgress';
    case 'review': return 'review';
    case 'done': return 'done';
    case 'cancelled': return 'cancelled';
    default: return 'todo';
  }
}
