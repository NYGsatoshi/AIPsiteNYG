import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { FrontendApiError } from '../../core/api/api-error.model';
import { FrontendFeatureFlagsService } from '../../core/feature-flags/frontend-feature-flags.service';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { DurableRealtimeEvent } from '../../core/realtime/realtime.models';
import { AipKanbanMoveRequest } from '../../shared/ui/contracts/aip-complex-adapter.contracts';
import {
  ProjectKanbanCard,
  ProjectKanbanColumn,
  ProjectKanbanSnapshot,
  ProjectKanbanSwimlane,
  mapProjectKanbanCommand,
  mapProjectKanbanSnapshot,
  swimlaneApiValue
} from './project-kanban.models';
import {
  MoveTaskOnKanbanRequestDto,
  PagedResponseDto,
  ProjectDto,
  ProjectKanbanCommandResponseDto,
  ProjectKanbanSnapshotDto,
  TaskDto,
  UpdateProjectKanbanConfigRequestDto
} from './projects.api';
import { mapProjectDtoToRecord, mapTaskDtoToRecord, mapTaskStatus, taskStatusLabel } from './projects.mapper';
import { ProjectSummaryViewModel, ProjectsPageStatus, TaskGridRow, TaskMockRecord } from './projects.types';

export type ProjectDetailTab = 'overview' | 'tasks' | 'list' | 'schedule' | 'workload' | 'members';
export type ProjectKanbanStatus = 'disabled' | 'loading' | 'ready' | 'empty' | 'permissionDenied' | 'notFound' | 'error' | 'conflict' | 'rollback';

export interface ProjectScheduleViewModel {
  readonly milestones: readonly { id: string; title: string; dueDate: string | null; status: string }[];
  readonly tasks: readonly { id: string; label: string }[];
}

export interface ProjectWorkloadViewModel { readonly userId: string; readonly displayName: string; readonly projectRole: string; readonly assignedTaskCount: number; readonly overdueTaskCount: number; readonly estimatedHours: number; readonly actualHours: number; }
export interface ProjectMemberViewModel { readonly userId: string; readonly displayName: string; readonly role: string; }
export interface ProjectKanbanViewModel {
  readonly status: ProjectKanbanStatus;
  readonly snapshot: ProjectKanbanSnapshot | null;
  readonly busyTaskId: string | null;
  readonly focusTaskId: string | null;
  readonly feedback: string | null;
  readonly error?: FrontendApiError;
  readonly realtimeDegraded: boolean;
  readonly reconciliationQueued: boolean;
}
export interface ProjectDetailViewModel {
  readonly status: ProjectsPageStatus;
  readonly project?: ProjectSummaryViewModel;
  readonly tasks: readonly TaskGridRow[];
  readonly kanban: ProjectKanbanViewModel;
  readonly schedule: ProjectScheduleViewModel;
  readonly workload: readonly ProjectWorkloadViewModel[];
  readonly members: readonly ProjectMemberViewModel[];
  readonly message?: string;
}

type KanbanLoadOutcome =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'success'; readonly dto: ProjectKanbanSnapshotDto }
  | { readonly kind: 'error'; readonly error: unknown };

@Injectable({ providedIn: 'root' })
export class ProjectDetailFacade {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeFacade);
  private readonly flags = inject(FrontendFeatureFlagsService);
  private readonly state = signal<ProjectDetailViewModel>(this.loading());
  private projectId: string | null = null;
  private realtimeCleanups: (() => void)[] = [];
  private refreshPending = false;
  private interactionActive = false;
  private moveInFlight = false;
  private kanbanRequestGeneration = 0;
  private selectedSwimlane: ProjectKanbanSwimlane | null = null;
  private includeOlderCompleted = false;

  constructor() {
    this.realtime.durableEvents$.subscribe((event) => this.handleRealtimeEvent(event));
  }

  view(): ProjectDetailViewModel {
    const current = this.state();
    return {
      ...current,
      kanban: {
        ...current.kanban,
        realtimeDegraded: this.realtime.connectionState() !== 'Connected'
      }
    };
  }

  load(projectId: string): void {
    this.projectId = projectId;
    this.selectedSwimlane = null;
    this.includeOlderCompleted = false;
    this.releaseRealtime();
    this.realtimeCleanups = [
      this.realtime.registerSubscription('project-detail', { subscriptionType: 'project', resourceId: projectId }),
      this.realtime.registerCatchUp('project-detail-kanban', () =>
        this.refreshKanban(false, 'Project board synchronized from authoritative HTTP state.'))
    ];
    this.state.set(this.loading());
    this.http.get<ProjectDto>(`/api/projects/${projectId}`, { withCredentials: true }).pipe(
      switchMap((project) => forkJoin({
        project: of(project),
        tasks: this.http.get<PagedResponseDto<TaskDto>>(`/api/projects/${projectId}/tasks`, { withCredentials: true }),
        kanban: this.initialKanbanRequest(projectId),
        gantt: this.http.get<unknown>(`/api/projects/${projectId}/gantt`, { withCredentials: true }),
        workload: this.http.get<unknown>(`/api/projects/${projectId}/workload`, { withCredentials: true }),
        members: this.http.get<unknown>(`/api/projects/${projectId}/members`, { withCredentials: true })
      })),
      map((response) => this.ready(response.project, response.tasks.items ?? [], response.kanban, response.gantt, response.workload, response.members)),
      catchError((error: unknown) => of(this.failure(error)))
    ).subscribe((view) => this.state.set(view));
  }

  retryKanban(): void { this.refreshKanban(true); }

  setKanbanInteractionActive(active: boolean): void {
    this.interactionActive = active;
    if (!active && !this.moveInFlight && this.state().kanban.reconciliationQueued)
      this.refreshKanban(true);
  }

  moveTask(intent: AipKanbanMoveRequest<ProjectKanbanCard>): void {
    const current = this.state();
    const snapshot = current.kanban.snapshot;
    const authoritativeCard = snapshot?.cards.find((card) => card.taskId === intent.item.taskId);
    if (!snapshot || !authoritativeCard || !authoritativeCard.canMove || this.moveInFlight)
      return;

    this.moveInFlight = true;
    const rollbackSnapshot = snapshot;
    const optimistic = this.optimisticMove(snapshot, authoritativeCard, intent.targetStatus, intent.targetBeforeItemId, intent.targetAfterItemId);
    this.state.set({
      ...current,
      kanban: {
        ...current.kanban,
        status: optimistic.cards.length ? 'ready' : 'empty',
        snapshot: optimistic,
        busyTaskId: authoritativeCard.taskId,
        focusTaskId: null,
        feedback: `Moving ${authoritativeCard.summary}…`,
        error: undefined
      }
    });

    const request: MoveTaskOnKanbanRequestDto = {
      targetWorkflowStageId: intent.targetStatus,
      targetBeforeTaskId: intent.targetBeforeItemId,
      targetAfterTaskId: intent.targetAfterItemId,
      expectedTaskVersion: authoritativeCard.version,
      expectedBoardVersion: snapshot.boardVersion,
      reason: intent.reason
    };
    this.http.post<ProjectKanbanCommandResponseDto>(`/api/tasks/${authoritativeCard.taskId}/kanban-move`, request, { withCredentials: true })
      .pipe(
        map((dto) => ({ kind: 'success' as const, value: mapProjectKanbanCommand(dto) })),
        catchError((error: unknown) => of({ kind: 'error' as const, error }))
      )
      .subscribe((result) => {
        this.moveInFlight = false;
        const latest = this.state();
        if (result.kind === 'success') {
          const warning = result.value.warnings.find((item) => item.code === 'KANBAN_WIP_LIMIT_EXCEEDED');
          this.selectedSwimlane = result.value.snapshot.selectedSwimlane;
          this.includeOlderCompleted = result.value.snapshot.includesOlderCompleted;
          this.state.set({
            ...latest,
            kanban: {
              status: result.value.snapshot.cards.length ? 'ready' : 'empty',
              snapshot: result.value.snapshot,
              busyTaskId: null,
              focusTaskId: result.value.focusTaskId ?? authoritativeCard.taskId,
              feedback: warning ? `Move saved. ${warning.message}` : 'Move saved.',
              realtimeDegraded: latest.kanban.realtimeDegraded,
              reconciliationQueued: false
            }
          });
          if (latest.kanban.reconciliationQueued) this.refreshKanban(true);
          return;
        }

        const error = normalizeApiError(result.error);
        if (error.httpStatus === 404) {
          this.state.set({
            ...latest,
            kanban: {
              ...latest.kanban,
              status: 'notFound',
              snapshot: null,
              busyTaskId: null,
              focusTaskId: null,
              feedback: 'The Task or Project is no longer available.',
              error,
              reconciliationQueued: false
            }
          });
          return;
        }

        const conflict = error.httpStatus === 409;
        this.state.set({
          ...latest,
          kanban: {
            ...latest.kanban,
            status: conflict ? 'conflict' : 'rollback',
            snapshot: rollbackSnapshot,
            busyTaskId: null,
            focusTaskId: authoritativeCard.taskId,
            feedback: conflict ? 'The board changed elsewhere. The move was rolled back and an authoritative refresh is required.' : `Move denied and rolled back. ${error.message}`,
            error,
            reconciliationQueued: false
          }
        });
        if (conflict) this.refreshKanban(true, 'Conflict resolved from the authoritative Project board.');
      });
  }

  updateKanbanConfig(defaultSwimlane: ProjectKanbanSwimlane, columns: readonly ProjectKanbanColumn[]): void {
    const current = this.state();
    const snapshot = current.kanban.snapshot;
    if (!snapshot?.canConfigure || current.kanban.busyTaskId) return;
    const request: UpdateProjectKanbanConfigRequestDto = {
      expectedBoardVersion: snapshot.boardVersion,
      defaultSwimlane: swimlaneApiValue(defaultSwimlane),
      columns: columns.map((column, index) => ({
        workflowStageId: column.workflowStageId,
        displayOrder: index,
        wipWarningLimit: column.wipWarningLimit
      }))
    };
    this.state.set({ ...current, kanban: { ...current.kanban, feedback: 'Saving board configuration…', error: undefined } });
    this.http.put<ProjectKanbanCommandResponseDto>(`/api/projects/${snapshot.projectId}/kanban/config`, request, { withCredentials: true })
      .pipe(
        map((dto) => ({ kind: 'success' as const, value: mapProjectKanbanCommand(dto) })),
        catchError((error: unknown) => of({ kind: 'error' as const, error }))
      )
      .subscribe((result) => {
        const latest = this.state();
        if (result.kind === 'success') {
          this.selectedSwimlane = result.value.snapshot.selectedSwimlane;
          this.state.set({
            ...latest,
            kanban: {
              ...latest.kanban,
              status: result.value.snapshot.cards.length ? 'ready' : 'empty',
              snapshot: result.value.snapshot,
              focusTaskId: null,
              feedback: 'Board configuration saved.',
              error: undefined
            }
          });
          return;
        }
        const error = normalizeApiError(result.error);
        this.state.set({
          ...latest,
          kanban: {
            ...latest.kanban,
            status: error.httpStatus === 409 ? 'conflict' : 'rollback',
            feedback: `Board configuration was not saved. ${error.message}`,
            error
          }
        });
        if (error.httpStatus === 409) this.refreshKanban(true, 'Configuration conflict resolved from the authoritative Project board.');
      });
  }

  setKanbanSwimlane(swimlane: ProjectKanbanSwimlane): void {
    this.selectedSwimlane = swimlane;
    this.refreshKanban(true);
  }

  setIncludeOlderCompleted(include: boolean): void {
    this.includeOlderCompleted = include;
    this.refreshKanban(true);
  }

  release(): void {
    this.releaseRealtime();
    this.projectId = null;
    this.kanbanRequestGeneration++;
  }

  private releaseRealtime(): void {
    for (const cleanup of this.realtimeCleanups.splice(0))
      cleanup();
  }

  private initialKanbanRequest(projectId: string) {
    if (!this.flags.kanbanV1Enabled()) return of<KanbanLoadOutcome>({ kind: 'disabled' });
    return this.http.get<ProjectKanbanSnapshotDto>(`/api/projects/${projectId}/kanban`, { withCredentials: true }).pipe(
      map((dto): KanbanLoadOutcome => ({ kind: 'success', dto })),
      catchError((error: unknown) => of<KanbanLoadOutcome>({ kind: 'error', error }))
    );
  }

  private refreshKanban(force = false, feedback?: string): void {
    const projectId = this.projectId;
    if (!projectId) return;
    if (!this.flags.kanbanV1Enabled()) {
      const current = this.state();
      this.state.set({ ...current, kanban: this.disabledKanban() });
      return;
    }
    if (!force && (this.interactionActive || this.moveInFlight)) {
      const current = this.state();
      this.state.set({
        ...current,
        kanban: {
          ...current.kanban,
          reconciliationQueued: true,
          feedback: 'A live update is waiting until the current board operation finishes.'
        }
      });
      return;
    }

    const generation = ++this.kanbanRequestGeneration;
    const current = this.state();
    this.state.set({
      ...current,
      kanban: {
        ...current.kanban,
        status: current.kanban.snapshot ? current.kanban.status : 'loading',
        feedback: feedback ?? current.kanban.feedback,
        reconciliationQueued: false
      }
    });
    let params = new HttpParams().set('includeOlderCompleted', String(this.includeOlderCompleted));
    if (this.selectedSwimlane) params = params.set('swimlane', String(swimlaneApiValue(this.selectedSwimlane)));
    this.http.get<ProjectKanbanSnapshotDto>(`/api/projects/${projectId}/kanban`, { params, withCredentials: true })
      .pipe(
        map((dto) => ({ kind: 'success' as const, value: mapProjectKanbanSnapshot(dto) })),
        catchError((error: unknown) => of({ kind: 'error' as const, error }))
      )
      .subscribe((result) => {
        if (generation !== this.kanbanRequestGeneration) return;
        const latest = this.state();
        if (result.kind === 'success') {
          this.selectedSwimlane = result.value.selectedSwimlane;
          this.includeOlderCompleted = result.value.includesOlderCompleted;
          this.state.set({
            ...latest,
            kanban: {
              status: result.value.cards.length ? 'ready' : 'empty',
              snapshot: result.value,
              busyTaskId: null,
              focusTaskId: latest.kanban.focusTaskId,
              feedback: feedback ?? latest.kanban.feedback,
              realtimeDegraded: latest.kanban.realtimeDegraded,
              reconciliationQueued: false
            }
          });
        } else {
          this.state.set({ ...latest, kanban: this.kanbanFailure(result.error, latest.kanban.snapshot) });
        }
      });
  }

  private handleRealtimeEvent(event: DurableRealtimeEvent): void {
    if (!this.projectId || !['Projects.ProjectChanged.v1', 'Projects.TaskChanged.v1', 'Security.AuthorizationStateChanged.v1'].includes(event.eventType))
      return;
    if (event.eventType !== 'Security.AuthorizationStateChanged.v1' && text(event.payload['projectId']) !== this.projectId)
      return;

    if (event.eventType === 'Security.AuthorizationStateChanged.v1') {
      const current = this.state();
      this.state.set({
        ...current,
        kanban: {
          ...this.loadingKanban(),
          feedback: 'Authorization changed. Protected board data was cleared before revalidation.'
        }
      });
    } else if (event.eventType === 'Projects.TaskChanged.v1') {
      const card = this.state().kanban.snapshot?.cards.find((item) => item.taskId === text(event.payload['taskId']));
      const eventVersion = number(event.payload['taskVersion']);
      if (card && eventVersion > 0 && eventVersion <= card.version) return;
    }

    if (this.interactionActive || this.moveInFlight) {
      this.refreshKanban(false);
      return;
    }
    if (this.refreshPending) return;
    this.refreshPending = true;
    queueMicrotask(() => {
      this.refreshPending = false;
      this.refreshKanban(true);
    });
  }

  private ready(projectDto: ProjectDto, taskDtos: readonly TaskDto[], kanban: KanbanLoadOutcome, gantt: unknown, workload: unknown, members: unknown): ProjectDetailViewModel {
    const record = mapProjectDtoToRecord(projectDto);
    const project: ProjectSummaryViewModel = {
      id: record.id,
      name: record.name,
      status: record.status,
      statusLabel: record.statusLabel,
      startDate: record.startDate,
      dueDate: record.dueDate,
      group: record.group,
      canCreateTask: record.canCreateTask,
      taskCounts: {
        total: taskDtos.length,
        done: taskDtos.filter((task) => mapTaskStatus(task.status) === 'done').length,
        blocked: taskDtos.filter((task) => mapTaskStatus(task.status) === 'blocked').length
      }
    };
    const rows = taskDtos.map((task) => this.toRow(mapTaskDtoToRecord(task, [record])));
    return {
      status: 'ready',
      project,
      tasks: rows,
      kanban: this.mapInitialKanban(kanban),
      schedule: this.schedule(gantt),
      workload: this.workload(workload),
      members: this.members(members)
    };
  }

  private mapInitialKanban(outcome: KanbanLoadOutcome): ProjectKanbanViewModel {
    if (outcome.kind === 'disabled') return this.disabledKanban();
    if (outcome.kind === 'error') return this.kanbanFailure(outcome.error, null);
    try {
      const snapshot = mapProjectKanbanSnapshot(outcome.dto);
      this.selectedSwimlane = snapshot.selectedSwimlane;
      this.includeOlderCompleted = snapshot.includesOlderCompleted;
      return {
        status: snapshot.cards.length ? 'ready' : 'empty',
        snapshot,
        busyTaskId: null,
        focusTaskId: null,
        feedback: null,
        realtimeDegraded: this.realtime.connectionState() !== 'Connected',
        reconciliationQueued: false
      };
    } catch (error: unknown) {
      return this.kanbanFailure(error, null);
    }
  }

  private kanbanFailure(error: unknown, snapshot: ProjectKanbanSnapshot | null): ProjectKanbanViewModel {
    const normalized = normalizeApiError(error);
    const status: ProjectKanbanStatus =
      normalized.httpStatus === 401 || normalized.httpStatus === 403 ? 'permissionDenied' :
      normalized.httpStatus === 404 ? 'notFound' :
      normalized.httpStatus === 409 ? 'conflict' : 'error';
    return {
      status,
      snapshot: status === 'permissionDenied' || status === 'notFound' ? null : snapshot,
      busyTaskId: null,
      focusTaskId: null,
      feedback: normalized.message,
      error: normalized,
      realtimeDegraded: this.realtime.connectionState() !== 'Connected',
      reconciliationQueued: false
    };
  }

  private optimisticMove(snapshot: ProjectKanbanSnapshot, card: ProjectKanbanCard, targetStageId: string, beforeId: string | null, afterId: string | null): ProjectKanbanSnapshot {
    const without = snapshot.cards.filter((item) => item.taskId !== card.taskId);
    const target = without.filter((item) => item.workflowStageId === targetStageId)
      .sort((left, right) => left.boardOrder - right.boardOrder || left.taskId.localeCompare(right.taskId));
    let index = target.length;
    if (beforeId) {
      const found = target.findIndex((item) => item.taskId === beforeId);
      if (found >= 0) index = found;
    } else if (afterId) {
      const found = target.findIndex((item) => item.taskId === afterId);
      if (found >= 0) index = found + 1;
    }
    target.splice(index, 0, { ...card, workflowStageId: targetStageId });
    const reordered = new Map(target.map((item, order) => [item.taskId, { ...item, boardOrder: (order + 1) * 1000 }]));
    return { ...snapshot, cards: without.map((item) => reordered.get(item.taskId) ?? item).concat(reordered.has(card.taskId) ? [reordered.get(card.taskId)!] : []) };
  }

  private toRow(task: TaskMockRecord): TaskGridRow { return { id: task.id, projectId: task.projectId, title: task.title, project: task.milestone || 'Project', status: task.status, statusLabel: task.statusLabel, priority: task.priority, priorityLabel: task.priorityLabel, assignee: task.assignee, startDate: task.startDate, dueDate: task.dueDate, progressPercent: task.progressPercent, milestone: task.milestone, allowedTransitions: task.allowedTransitions, rowActions: [{ id: 'openDetail', label: 'Open', disabled: false }] }; }
  private schedule(value: unknown): ProjectScheduleViewModel { const source = object(value); const milestones = array(source['milestones']).map((item) => { const row = object(item); return { id: text(row['milestoneId']), title: text(row['title'], 'Untitled milestone'), dueDate: optionalText(row['dueDate']), status: taskStatusLabel(mapTaskStatus(row['status'])) }; }); const tasks = array(source['tasks']).map((item) => { const row = object(item); return { id: text(row['taskId']), label: `${text(row['title'], 'Untitled task')} · ${optionalText(row['startDate']) ?? 'No start date'} – ${optionalText(row['dueDate']) ?? 'No due date'}` }; }); return { milestones, tasks }; }
  private workload(value: unknown): readonly ProjectWorkloadViewModel[] { return array(object(value)['members']).map((item) => { const row = object(item); return { userId: text(row['userId']), displayName: text(row['displayName'], 'Member'), projectRole: text(row['projectRole'], 'Member'), assignedTaskCount: number(row['assignedTaskCount']), overdueTaskCount: number(row['overdueTaskCount']), estimatedHours: number(row['estimatedHours']), actualHours: number(row['actualHours']) }; }); }
  private members(value: unknown): readonly ProjectMemberViewModel[] { return array(value).map((item) => { const row = object(item); return { userId: text(row['userId']), displayName: text(row['displayName'], 'Member'), role: text(row['role'], 'Member') }; }); }
  private loading(): ProjectDetailViewModel { return { status: 'loading', tasks: [], kanban: this.loadingKanban(), schedule: { milestones: [], tasks: [] }, workload: [], members: [] }; }
  private loadingKanban(): ProjectKanbanViewModel { return { status: 'loading', snapshot: null, busyTaskId: null, focusTaskId: null, feedback: null, realtimeDegraded: this.realtime.connectionState() !== 'Connected', reconciliationQueued: false }; }
  private disabledKanban(): ProjectKanbanViewModel { return { ...this.loadingKanban(), status: 'disabled', feedback: 'Project Kanban is disabled. The maintained Task List remains available.' }; }
  private failure(error: unknown): ProjectDetailViewModel { const normalized = normalizeApiError(error); return { ...this.loading(), status: normalized.httpStatus === 401 || normalized.httpStatus === 403 ? 'permissionDenied' : 'error', message: normalized.message }; }
}

function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' && value.length > 0 ? value : fallback; }
function optionalText(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
