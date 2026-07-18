import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { normalizeApiError } from '../../core/api/api-error.adapter';
import { RealtimeFacade } from '../../core/realtime/realtime.facade';
import { PagedResponseDto, ProjectDto, TaskDto } from './projects.api';
import { mapProjectDtoToRecord, mapTaskDtoToRecord, mapTaskStatus, taskStatusLabel } from './projects.mapper';
import { ProjectSummaryViewModel, ProjectsPageStatus, TaskGridRow, TaskMockRecord } from './projects.types';

export type ProjectDetailTab = 'overview' | 'tasks' | 'list' | 'schedule' | 'workload' | 'members';

export interface ProjectScheduleViewModel {
  readonly milestones: readonly { id: string; title: string; dueDate: string | null; status: string }[];
  readonly tasks: readonly { id: string; label: string }[];
}

export interface ProjectWorkloadViewModel { readonly userId: string; readonly displayName: string; readonly projectRole: string; readonly assignedTaskCount: number; readonly overdueTaskCount: number; readonly estimatedHours: number; readonly actualHours: number; }
export interface ProjectMemberViewModel { readonly userId: string; readonly displayName: string; readonly role: string; }
export interface ProjectDetailViewModel {
  readonly status: ProjectsPageStatus;
  readonly project?: ProjectSummaryViewModel;
  readonly tasks: readonly TaskGridRow[];
  readonly schedule: ProjectScheduleViewModel;
  readonly workload: readonly ProjectWorkloadViewModel[];
  readonly members: readonly ProjectMemberViewModel[];
  readonly message?: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectDetailFacade {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeFacade);
  private readonly state = signal<ProjectDetailViewModel>(this.loading());
  private projectId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private refreshPending = false;

  constructor() { this.realtime.durableEvents$.subscribe((event) => { if (this.projectId && (event.eventType === 'Projects.ProjectChanged.v1' || event.eventType === 'Projects.TaskChanged.v1') && !this.refreshPending) { this.refreshPending = true; queueMicrotask(() => { this.refreshPending = false; if (this.projectId) this.load(this.projectId); }); } }); }

  view(): ProjectDetailViewModel { return this.state(); }

  load(projectId: string): void {
    this.projectId = projectId;
    this.unsubscribe?.();
    this.unsubscribe = this.realtime.registerSubscription('project-detail', { subscriptionType: 'project', resourceId: projectId });
    this.state.set(this.loading());
    this.http.get<ProjectDto>(`/api/projects/${projectId}`, { withCredentials: true }).pipe(
      switchMap((project) => forkJoin({
        project: of(project),
        tasks: this.http.get<PagedResponseDto<TaskDto>>(`/api/projects/${projectId}/tasks`, { withCredentials: true }),
        gantt: this.http.get<unknown>(`/api/projects/${projectId}/gantt`, { withCredentials: true }),
        workload: this.http.get<unknown>(`/api/projects/${projectId}/workload`, { withCredentials: true }),
        members: this.http.get<unknown>(`/api/projects/${projectId}/members`, { withCredentials: true })
      })),
      map((response) => this.ready(response.project, response.tasks.items ?? [], response.gantt, response.workload, response.members)),
      catchError((error: unknown) => of(this.failure(error)))
    ).subscribe((view) => this.state.set(view));
  }

  release(): void { this.unsubscribe?.(); this.unsubscribe = null; this.projectId = null; }

  private ready(projectDto: ProjectDto, taskDtos: readonly TaskDto[], gantt: unknown, workload: unknown, members: unknown): ProjectDetailViewModel {
    const record = mapProjectDtoToRecord(projectDto);
    const project: ProjectSummaryViewModel = { id: record.id, name: record.name, status: record.status, statusLabel: record.statusLabel, startDate: record.startDate, dueDate: record.dueDate, group: record.group, canCreateTask: record.canCreateTask, taskCounts: { total: taskDtos.length, done: taskDtos.filter((task) => mapTaskStatus(task.status) === 'done').length, blocked: taskDtos.filter((task) => mapTaskStatus(task.status) === 'blocked').length } };
    const rows = taskDtos.map((task) => this.toRow(mapTaskDtoToRecord(task, [record])));
    return { status: 'ready', project, tasks: rows, schedule: this.schedule(gantt), workload: this.workload(workload), members: this.members(members) };
  }

  private toRow(task: TaskMockRecord): TaskGridRow { return { id: task.id, projectId: task.projectId, title: task.title, project: task.milestone || 'Project', status: task.status, statusLabel: task.statusLabel, priority: task.priority, priorityLabel: task.priorityLabel, assignee: task.assignee, startDate: task.startDate, dueDate: task.dueDate, progressPercent: task.progressPercent, milestone: task.milestone, allowedTransitions: task.allowedTransitions, rowActions: [{ id: 'openDetail', label: 'Open', disabled: false }] }; }
  private schedule(value: unknown): ProjectScheduleViewModel { const source = object(value); const milestones = array(source['milestones']).map((item) => { const row = object(item); return { id: text(row['milestoneId']), title: text(row['title'], 'Untitled milestone'), dueDate: optionalText(row['dueDate']), status: taskStatusLabel(mapTaskStatus(row['status'])) }; }); const tasks = array(source['tasks']).map((item) => { const row = object(item); return { id: text(row['taskId']), label: `${text(row['title'], 'Untitled task')} · ${optionalText(row['startDate']) ?? 'No start date'} – ${optionalText(row['dueDate']) ?? 'No due date'}` }; }); return { milestones, tasks }; }
  private workload(value: unknown): readonly ProjectWorkloadViewModel[] { return array(object(value)['members']).map((item) => { const row = object(item); return { userId: text(row['userId']), displayName: text(row['displayName'], 'Member'), projectRole: text(row['projectRole'], 'Member'), assignedTaskCount: number(row['assignedTaskCount']), overdueTaskCount: number(row['overdueTaskCount']), estimatedHours: number(row['estimatedHours']), actualHours: number(row['actualHours']) }; }); }
  private members(value: unknown): readonly ProjectMemberViewModel[] { return array(value).map((item) => { const row = object(item); return { userId: text(row['userId']), displayName: text(row['displayName'], 'Member'), role: text(row['role'], 'Member') }; }); }
  private loading(): ProjectDetailViewModel { return { status: 'loading', tasks: [], schedule: { milestones: [], tasks: [] }, workload: [], members: [] }; }
  private failure(error: unknown): ProjectDetailViewModel { const normalized = normalizeApiError(error); return { ...this.loading(), status: normalized.httpStatus === 401 || normalized.httpStatus === 403 ? 'permissionDenied' : 'error', message: normalized.message }; }
}

function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' && value.length > 0 ? value : fallback; }
function optionalText(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
