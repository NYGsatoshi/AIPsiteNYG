import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { FrontendApiError } from '../../core/api/api-error.model';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { MyTaskDto, PagedResponseDto } from './projects.api';
import { mapMyTaskDtoToRecord } from './projects.mapper';
import {
  MyTasksViewModel,
  PROJECTS_DEFAULT_PAGE_SIZE,
  PROJECTS_MAXIMUM_PAGE_SIZE,
  ProjectsPageStatus,
  ProjectsScenario,
  TaskGridRow,
  TaskMockRecord,
  TaskRowAction
} from './projects.types';

export const AIP_MY_TASKS_MOCK = new InjectionToken<ProjectsScenario>('AIP_MY_TASKS_MOCK');

interface MyTasksState {
  readonly status: ProjectsPageStatus;
  readonly tasks: readonly TaskMockRecord[];
  readonly message?: string;
  readonly error?: FrontendApiError;
}

@Injectable({
  providedIn: 'root'
})
export class MyTasksFacade {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeFacade);
  private readonly scenario = inject(AIP_MY_TASKS_MOCK, { optional: true });
  private readonly state = signal<MyTasksState>(this.initialState());
  private hasRequested = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.realtime.durableEvents$.subscribe((event) => this.handleRealtimeEvent(event));
  }

  load(): void {
    if (this.scenario || this.hasRequested) {
      return;
    }

    this.hasRequested = true;
    this.requestMyTasks();
  }

  retry(): void {
    if (this.scenario) {
      return;
    }

    this.requestMyTasks();
  }

  refreshIfLoaded(): void {
    if (this.scenario || !this.hasRequested) {
      return;
    }

    this.requestMyTasks();
  }

  getMyTasks(): MyTasksViewModel {
    const current = this.state();
    return {
      status: current.status,
      title: 'My tasks',
      subtitle: 'Tasks assigned to the signed-in user',
      rows: current.status === 'ready' ? current.tasks.map((task) => this.toTaskRow(task)) : [],
      columns: [],
      pageSize: {
        defaultPageSize: PROJECTS_DEFAULT_PAGE_SIZE,
        maximumPageSize: PROJECTS_MAXIMUM_PAGE_SIZE
      },
      message: current.message,
      error: current.error
    };
  }

  private requestMyTasks(): void {
    this.state.set({ status: 'loading', tasks: [] });
    this.fetchMyTasks().subscribe((nextState) => this.state.set(nextState));
  }

  private handleRealtimeEvent(event: DurableRealtimeEvent): void {
    if (this.scenario || !this.hasRequested || event.eventType !== 'Projects.TaskChanged.v1') {
      return;
    }
    if (this.refreshTimer !== null) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.requestMyTasks();
    }, 100);
  }

  private fetchMyTasks(): Observable<MyTasksState> {
    return this.http
      .get<PagedResponseDto<MyTaskDto>>('/api/me/tasks', { withCredentials: true })
      .pipe(
        map((response) => {
          const tasks = (response.items ?? []).map((task) => mapMyTaskDtoToRecord(task));
          return {
            status: tasks.length > 0 ? ('ready' as const) : ('empty' as const),
            tasks,
            message: tasks.length > 0 ? undefined : 'No tasks assigned to you were returned by the backend.'
          };
        }),
        catchError((error: unknown) => of(this.toErrorState(error)))
      );
  }

  private toErrorState(error: unknown): MyTasksState {
    const normalized = normalizeApiError(error);
    if (normalized.httpStatus === 401 || normalized.httpStatus === 403) {
      return {
        status: 'permissionDenied',
        tasks: [],
        message: 'Authentication or task assignment permission is required.',
        error: normalized
      };
    }

    return {
      status: 'error',
      tasks: [],
      message: 'My Tasks could not be loaded. Try again.',
      error: normalized
    };
  }

  private toTaskRow(task: TaskMockRecord): TaskGridRow {
    return {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      project: task.milestone || 'Project',
      status: task.status,
      statusLabel: task.statusLabel,
      priority: task.priority,
      priorityLabel: task.priorityLabel,
      assignee: task.assignee,
      startDate: task.startDate,
      dueDate: task.dueDate,
      progressPercent: task.progressPercent,
      milestone: '',
      allowedTransitions: task.allowedTransitions,
      rowActions: this.buildActions()
    };
  }

  private buildActions(): readonly TaskRowAction[] {
    return [
      {
        id: 'openDetail',
        label: 'Open',
        disabled: false
      }
    ];
  }

  private initialState(): MyTasksState {
    if (!this.scenario) {
      return { status: 'loading', tasks: [] };
    }

    const status = this.scenario.myTasksStatus ?? this.scenario.status;
    const tasks = this.scenario.myTasks ?? this.scenario.tasks;
    return {
      status,
      tasks,
      message: this.scenario.myTasksMessage ?? this.scenario.message,
      error: this.scenario.myTasksError
    };
  }
}
