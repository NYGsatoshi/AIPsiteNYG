import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppErrorBannerComponent } from '../../../shared/error/app-error-banner/app-error-banner.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { AipGanttComponent, AipKanbanComponent } from '../../../shared/ui/adapters/syncfusion/aip-adapter-shells.components';
import {
  AipAdapterState,
  AipGanttContract,
  AipKanbanContract,
  AipKanbanMoveRequest
} from '../../../shared/ui/contracts/aip-complex-adapter.contracts';
import {
  ProjectKanbanCard,
  ProjectKanbanColumn,
  ProjectKanbanSnapshot,
  ProjectKanbanSwimlane
} from '../project-kanban.models';
import { ProjectDetailFacade, ProjectDetailTab, ProjectKanbanStatus } from '../project-detail.facade';
import { TaskGridRow } from '../projects.types';
import { TaskTableComponent } from '../task-table/task-table.component';

@Component({
  selector: 'app-project-detail-page',
  standalone: true,
  imports: [AppEmptyStateComponent, AppErrorBannerComponent, AppInlineLoadingComponent, AppPermissionDeniedComponent, AipKanbanComponent, AipGanttComponent, TaskTableComponent],
  templateUrl: './project-detail-page.component.html',
  styleUrl: './project-detail-page.component.scss'
})
export class ProjectDetailPageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly facade = inject(ProjectDetailFacade);
  readonly page = computed(() => this.facade.view());
  readonly tab = signal<ProjectDetailTab>('tasks');
  readonly configOpen = signal(false);
  readonly configColumns = signal<readonly ProjectKanbanColumn[]>([]);
  readonly configSwimlane = signal<ProjectKanbanSwimlane>('none');
  readonly tabs: readonly { id: ProjectDetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'list', label: 'List' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'workload', label: 'Workload' },
    { id: 'members', label: 'Members' }
  ];
  readonly swimlanes: readonly { value: ProjectKanbanSwimlane; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'primaryAssignee', label: 'Primary assignee' },
    { value: 'targetGroup', label: 'Target group' },
    { value: 'priority', label: 'Priority' },
    { value: 'parentTask', label: 'Parent task' }
  ];

  constructor() {
    const projectId = this.route.snapshot.paramMap.get('projectId');
    if (projectId) this.facade.load(projectId);
  }

  ngOnDestroy(): void { this.facade.release(); }
  openTask(row: TaskGridRow): void { void this.router.navigate(['/projects', row.projectId, 'tasks', row.id]); }
  openKanbanItem(item: object, projectId: string): void {
    const card = item as ProjectKanbanCard;
    if (card.canOpen) void this.router.navigate(['/projects', projectId, 'tasks', card.taskId]);
  }
  requestKanbanMove(event: AipKanbanMoveRequest<object>): void {
    this.facade.moveTask(event as AipKanbanMoveRequest<ProjectKanbanCard>);
  }
  setKanbanInteractionActive(active: boolean): void { this.facade.setKanbanInteractionActive(active); }
  retryKanban(): void { this.facade.retryKanban(); }
  setSwimlane(value: string): void { this.facade.setKanbanSwimlane(value as ProjectKanbanSwimlane); }
  setIncludeOlderCompleted(include: boolean): void { this.facade.setIncludeOlderCompleted(include); }

  openConfiguration(snapshot: ProjectKanbanSnapshot): void {
    this.configColumns.set(snapshot.columns.map((column) => ({ ...column })));
    this.configSwimlane.set(snapshot.defaultSwimlane);
    this.configOpen.set(true);
    this.facade.setKanbanInteractionActive(true);
  }
  cancelConfiguration(): void {
    this.configOpen.set(false);
    this.facade.setKanbanInteractionActive(false);
  }
  moveConfigColumn(index: number, offset: -1 | 1): void {
    const columns = [...this.configColumns()];
    const target = index + offset;
    if (target < 0 || target >= columns.length) return;
    [columns[index], columns[target]] = [columns[target], columns[index]];
    this.configColumns.set(columns);
  }
  setWipLimit(stageId: string, value: string): void {
    const parsed = value.trim() ? Number(value) : null;
    this.configColumns.update((columns) => columns.map((column) =>
      column.workflowStageId === stageId
        ? { ...column, wipWarningLimit: parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null }
        : column));
  }
  saveConfiguration(): void {
    this.facade.updateKanbanConfig(this.configSwimlane(), this.configColumns());
    this.configOpen.set(false);
    this.facade.setKanbanInteractionActive(false);
  }

  kanban(snapshot: ProjectKanbanSnapshot, status: ProjectKanbanStatus, feedback: string | null, busyTaskId: string | null, focusTaskId: string | null): AipKanbanContract<ProjectKanbanCard> {
    return {
      ariaLabel: 'Canonical Project Task Kanban',
      presentation: 'desktop',
      state: this.kanbanState(status),
      items: snapshot.cards,
      itemIdentity: (card) => card.taskId,
      itemTitle: (card) => card.summary,
      itemDescription: (card) => `Primary assignee: ${card.primaryAssigneeLabel}. Target group: ${card.targetGroupLabel}.`,
      itemMetadata: (card) => [
        `Priority: ${card.priority}`,
        card.isBlocked ? 'Blocked' : 'Not blocked',
        card.isParentSummary ? `Derived progress: ${card.progressPercent}%` : `Progress: ${card.progressPercent}%`,
        card.isParentSummary
          ? `Derived dates: ${card.plannedStartDate ?? 'No start date'} to ${card.plannedEndDate ?? 'No end date'}`
          : card.parentSummary ? `Parent: ${card.parentSummary}` : 'Leaf task',
        card.isParentSummary ? `${card.completedChildCount} of ${card.childCount} child tasks complete` : 'Actionable card'
      ],
      itemKindLabel: (card) => card.isParentSummary ? 'Parent summary task' : 'Actionable leaf task',
      itemStatus: (card) => card.workflowStageId,
      itemOrder: (card) => card.boardOrder,
      itemSwimlane: snapshot.selectedSwimlane === 'none'
        ? undefined
        : (card) => ({ key: card.swimlaneKey, label: card.swimlaneLabel }),
      canOpenItem: (card) => card.canOpen,
      canMoveItem: (card) => card.canMove,
      columns: snapshot.columns.map((column) => ({
        id: column.workflowStageId,
        label: column.displayName,
        category: column.category,
        cardCount: column.currentAuthorizedCardCount,
        wipWarningLimit: column.wipWarningLimit,
        hasWipWarning: column.hasWipWarning,
        requiresReason: column.category === 'cancelled'
      })),
      canRequestTransition: (card, target) => card.allowedTargetWorkflowStageIds.includes(target),
      busyItemId: busyTaskId,
      focusItemId: focusTaskId,
      feedback
    };
  }

  kanbanState(status: ProjectKanbanStatus): AipAdapterState {
    return status === 'permissionDenied' ? 'permission-denied' :
      status === 'notFound' ? 'error' :
      status === 'disabled' ? 'empty' :
      status;
  }

  gantt(): AipGanttContract<{ id: string; label: string }> { const schedule = this.page().schedule; return { ariaLabel: 'Project schedule', presentation: 'desktop', state: 'ready', tasks: schedule.tasks, taskIdentity: (task) => task.id, taskLabel: (task) => task.label, milestones: schedule.milestones, timezone: 'project timezone unavailable from API', readOnly: true }; }
}
