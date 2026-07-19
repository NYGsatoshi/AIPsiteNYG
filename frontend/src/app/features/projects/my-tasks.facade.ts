import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { catchError, forkJoin, of, Subscription } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { FrontendApiError } from '../../core/api/api-error.model';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { MyTasksCountsDto, MyTasksProjectionPageDto } from './projects.api';
import { mapMyTaskDtoToProjection } from './projects.mapper';
import {
  MyTasksCount,
  MyTasksLiveTask,
  MyTasksScope,
  MyTasksTab,
  MyTasksUrgencyGroup,
  MyTasksViewModel,
  PROJECTS_DEFAULT_PAGE_SIZE,
  PROJECTS_MAXIMUM_PAGE_SIZE,
  ProjectsPageStatus,
  ProjectsScenario,
  TaskGridRow,
  TaskRowAction
} from './projects.types';

export const AIP_MY_TASKS_MOCK = new InjectionToken<ProjectsScenario>('AIP_MY_TASKS_MOCK');

interface MyTasksState {
  readonly status: ProjectsPageStatus;
  readonly tasks: readonly MyTasksLiveTask[];
  readonly selectedTab: MyTasksTab;
  readonly scope: MyTasksScope;
  readonly workspaceId: string | null;
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly counts: readonly MyTasksCount[];
  readonly realtimeDegraded: boolean;
  readonly message?: string;
  readonly error?: FrontendApiError;
}

@Injectable({ providedIn: 'root' })
export class MyTasksFacade {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeFacade);
  private readonly scenario = inject(AIP_MY_TASKS_MOCK, { optional: true });
  private readonly state = signal<MyTasksState>(this.initialState());
  private hasRequested = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSubscription: Subscription | null = null;

  constructor() {
    this.realtime.durableEvents$.subscribe((event) => this.handleRealtimeEvent(event));
  }

  load(): void {
    if (this.scenario || this.hasRequested) return;
    this.hasRequested = true;
    this.requestMyTasks();
  }

  retry(): void { if (!this.scenario) this.requestMyTasks(); }
  refreshIfLoaded(): void { if (!this.scenario && this.hasRequested) this.requestMyTasks(); }

  setTab(tab: MyTasksTab): void {
    this.state.update((current) => ({ ...current, selectedTab: tab, page: 1 }));
    this.requestMyTasks();
  }

  setScope(scope: MyTasksScope, workspaceId: string | null = null): void {
    this.state.update((current) => ({ ...current, scope, workspaceId: scope === 'allWorkspaces' ? null : workspaceId, page: 1 }));
    this.requestMyTasks();
  }

  setWorkspace(workspaceId: string): void { this.setScope('currentWorkspace', workspaceId); }

  getMyTasks(): MyTasksViewModel {
    const current = this.state();
    return {
      status: current.status,
      title: 'My tasks',
      subtitle: current.scope === 'allWorkspaces' ? 'Authorized tasks across all workspaces' : 'Tasks in the selected workspace',
      rows: current.status === 'ready' ? current.tasks.map((task) => this.toTaskRow(task)) : [],
      columns: [],
      pageSize: { defaultPageSize: PROJECTS_DEFAULT_PAGE_SIZE, maximumPageSize: PROJECTS_MAXIMUM_PAGE_SIZE },
      message: current.message,
      error: current.error,
      tasks: current.tasks,
      selectedTab: current.selectedTab,
      scope: current.scope,
      workspaceId: current.workspaceId,
      counts: current.counts,
      totalCount: current.totalCount,
      realtimeDegraded: current.realtimeDegraded
    };
  }

  private requestMyTasks(): void {
    if (this.scenario) return;
    const current = this.state();
    this.requestSubscription?.unsubscribe();
    this.state.set({ ...current, status: 'loading', tasks: [], message: undefined, error: undefined });
    const params = this.queryParams(current);
    this.requestSubscription = forkJoin({
      page: this.http.get<MyTasksProjectionPageDto>('/api/me/tasks', { params, withCredentials: true }),
      counts: this.http.get<MyTasksCountsDto>('/api/me/tasks/counts', { params, withCredentials: true })
    }).pipe(catchError((error: unknown) => of({ error }))).subscribe((response) => {
      if ('error' in response) {
        this.state.set(this.toErrorState(response.error, current));
        return;
      }
      try {
        const tasks = (response.page.items ?? []).map((task) => mapMyTaskDtoToProjection(task));
        this.state.set({
          ...current,
          status: tasks.length > 0 ? 'ready' : 'empty',
          tasks,
          page: numeric(response.page.page, current.page),
          pageSize: numeric(response.page.pageSize, current.pageSize),
          totalCount: numeric(response.page.totalCount, 0),
          counts: toCounts(response.counts),
          realtimeDegraded: false,
          message: tasks.length > 0 ? undefined : 'No tasks match this relationship view and scope.'
        });
      } catch (error: unknown) {
        this.state.set(this.toErrorState(error, current));
      }
    });
  }

  private queryParams(state: MyTasksState): HttpParams {
    let params = new HttpParams()
      .set('view', state.selectedTab)
      .set('scope', state.scope)
      .set('page', String(state.page))
      .set('pageSize', String(state.pageSize));
    if (state.scope === 'currentWorkspace' && state.workspaceId) params = params.set('workspaceId', state.workspaceId);
    return params;
  }

  private handleRealtimeEvent(event: DurableRealtimeEvent): void {
    if (this.scenario || !this.hasRequested) return;
    if (event.eventType === 'Security.AuthorizationStateChanged.v1') {
      const current = this.state();
      this.state.set({ ...current, tasks: [], counts: [], status: 'loading' });
    }
    if (!['Projects.TaskChanged.v1', 'Projects.TaskAssignmentChanged.v1', 'Projects.TaskWatchChanged.v1', 'Projects.TaskClaimed.v1', 'Projects.TaskLabelsChanged.v1', 'Security.AuthorizationStateChanged.v1'].includes(event.eventType)) return;
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => { this.refreshTimer = null; this.requestMyTasks(); }, 150);
  }

  private toErrorState(error: unknown, current: MyTasksState): MyTasksState {
    const normalized = normalizeApiError(error);
    if (normalized.httpStatus === 401 || normalized.httpStatus === 403) {
      return { ...current, status: 'permissionDenied', tasks: [], message: 'Authentication or workspace permission is required.', error: normalized };
    }
    return { ...current, status: 'error', tasks: [], message: 'My Tasks could not be loaded. Try again.', error: normalized };
  }

  private toTaskRow(task: MyTasksLiveTask): TaskGridRow {
    return {
      id: task.taskId, projectId: task.projectId, title: task.title,
      project: task.projectTitle, status: task.status, statusLabel: task.workflowStageName,
      priority: task.priority, priorityLabel: task.priority[0].toUpperCase() + task.priority.slice(1),
      assignee: task.primaryAssignee, startDate: '', dueDate: task.deadlineAt || task.plannedEndDate,
      progressPercent: task.progressPercent, milestone: '', allowedTransitions: [], rowActions: this.buildActions()
    };
  }

  private buildActions(): readonly TaskRowAction[] { return [{ id: 'openDetail', label: 'Open', disabled: false }]; }

  private initialState(): MyTasksState {
    return {
      status: this.scenario ? (this.scenario.myTasksStatus ?? this.scenario.status) : 'loading',
      tasks: this.scenario ? scenarioTasks(this.scenario) : [], selectedTab: 'assigned', scope: 'currentWorkspace', workspaceId: null,
      page: 1, pageSize: PROJECTS_DEFAULT_PAGE_SIZE, totalCount: 0, counts: [], realtimeDegraded: false,
      message: this.scenario?.myTasksMessage ?? this.scenario?.message, error: this.scenario?.myTasksError
    };
  }
}

function numeric(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }

function toCounts(dto: MyTasksCountsDto): readonly MyTasksCount[] {
  const views = Array.isArray(dto.views) ? dto.views.map((item) => ({ key: String(item.view).replace(/^./, (value) => value.toLowerCase()) as MyTasksTab, count: numeric(item.count, 0) })) : [];
  const groups = Array.isArray(dto.timeGroups) ? dto.timeGroups.map((item) => ({ key: String(item.timeGroup).replace(/^./, (value) => value.toLowerCase()) as MyTasksUrgencyGroup, count: numeric(item.count, 0) })) : [];
  return [...views, ...groups];
}

// Stories and static UI tests may still inject their pre-PR04 scenario object. This
// adapter is deliberately confined to the optional test token; production HTTP state
// is parsed only through mapMyTaskDtoToProjection.
function scenarioTasks(scenario: ProjectsScenario): readonly MyTasksLiveTask[] {
  const tasks = scenario.myTasks ?? scenario.tasks;
  return tasks.map((task) => ({
    taskId: task.id, tenantId: 'scenario-tenant', workspaceId: 'scenario-workspace', workspaceTitle: 'Scenario workspace',
    projectId: task.projectId, projectTitle: task.milestone || 'Project', title: task.title, workflowStageId: null,
    workflowStageName: task.statusLabel, status: task.status, priority: task.priority, isBlocked: task.status === 'blocked',
    plannedEndDate: task.dueDate, deadlineAt: '', progressPercent: task.progressPercent ?? 0, timeGroup: 'noDeadline',
    isOverdue: false, version: task.rowVersion || 'scenario', primaryAssignee: task.assignee, targetGroup: '', reviewer: '', labels: [],
    checklistCompletedCount: 0, checklistTotalCount: 0, canClaim: false, canChangeStage: false, warnings: []
  }));
}
