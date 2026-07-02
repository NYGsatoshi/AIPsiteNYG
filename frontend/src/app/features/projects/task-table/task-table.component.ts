import { Component, EventEmitter, Input, Output } from '@angular/core';

import {
  AppDataGridActionEvent,
  AppDataGridColumnDef
} from '../../../shared/grid/app-data-grid/app-data-grid.types';
import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { TaskGridRow, TaskRowAction } from '../projects.types';

@Component({
  selector: 'app-task-table',
  standalone: true,
  imports: [AppDataGridComponent],
  template: `
    <app-data-grid
      ariaLabel="Project tasks"
      rowIdField="id"
      [rows]="rows"
      [columns]="columns"
      [defaultPageSize]="defaultPageSize"
      [maximumPageSize]="maximumPageSize"
      (actionInvoked)="actionInvoked.emit($event)"
    />
  `
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
      minWidth: 220,
      flex: 1.4,
      wrapText: true,
      autoHeight: true
    },
    {
      field: 'project',
      headerName: 'Project',
      minWidth: 180,
      flex: 1
    },
    {
      field: 'statusLabel',
      headerName: 'Status',
      minWidth: 140,
      flex: 0.8
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
      valueFormatter: (params) => `${params.value ?? 0}%`
    },
    {
      field: 'milestone',
      headerName: 'Milestone',
      minWidth: 160,
      flex: 0.9
    },
    {
      colId: 'rowActions',
      headerName: 'Actions',
      minWidth: 260,
      flex: 1.2,
      sortable: false,
      filter: false,
      cellRenderer: (params: { data?: TaskGridRow }) => this.renderActions(params.data?.rowActions ?? [])
    }
  ];

  private renderActions(actions: readonly TaskRowAction[]): HTMLElement {
    const container = document.createElement('div');
    container.className = 'app-grid-actions';

    actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-grid-actions__button';
      button.dataset['gridAction'] = action.id;
      button.textContent = action.label;
      button.setAttribute('aria-disabled', String(action.disabled));
      if (action.disabledReason) {
        button.title = action.disabledReason;
      }
      container.append(button);
    });

    return container;
  }
}
