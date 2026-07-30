import {
  ProjectKanbanCardDto,
  ProjectKanbanColumnDto,
  ProjectKanbanCommandResponseDto,
  ProjectKanbanSnapshotDto,
  ProjectKanbanWarningDto
} from './projects.api';

export type ProjectKanbanSwimlane = 'none' | 'primaryAssignee' | 'targetGroup' | 'priority' | 'parentTask';
export type ProjectKanbanStageCategory = 'backlog' | 'todo' | 'inProgress' | 'review' | 'done' | 'cancelled';

export interface ProjectKanbanWarning {
  readonly code: string;
  readonly message: string;
  readonly workflowStageId: string | null;
  readonly currentCount: number | null;
  readonly limit: number | null;
}

export interface ProjectKanbanColumn {
  readonly workflowStageId: string;
  readonly displayName: string;
  readonly category: ProjectKanbanStageCategory;
  readonly displayOrder: number;
  readonly wipWarningLimit: number | null;
  readonly currentAuthorizedCardCount: number;
  readonly hasWipWarning: boolean;
  readonly canConfigure: boolean;
}

export interface ProjectKanbanCard {
  readonly taskId: string;
  readonly summary: string;
  readonly workflowStageId: string;
  readonly boardOrder: number;
  readonly parentTaskId: string | null;
  readonly parentSummary: string | null;
  readonly isParentSummary: boolean;
  readonly isLeaf: boolean;
  readonly completedChildCount: number;
  readonly childCount: number;
  readonly progressPercent: number;
  readonly plannedStartDate: string | null;
  readonly plannedEndDate: string | null;
  readonly primaryAssigneeUserId: string | null;
  readonly primaryAssigneeLabel: string;
  readonly targetGroupId: string | null;
  readonly targetGroupLabel: string;
  readonly priority: string;
  readonly isBlocked: boolean;
  readonly version: number;
  readonly swimlaneKey: string;
  readonly swimlaneLabel: string;
  readonly canOpen: boolean;
  readonly canMove: boolean;
  readonly allowedTargetWorkflowStageIds: readonly string[];
}

export interface ProjectKanbanSnapshot {
  readonly projectId: string;
  readonly boardVersion: number;
  readonly timeZone: string;
  readonly defaultSwimlane: ProjectKanbanSwimlane;
  readonly selectedSwimlane: ProjectKanbanSwimlane;
  readonly supportedSwimlanes: readonly ProjectKanbanSwimlane[];
  readonly supportedFilters: readonly string[];
  readonly includesOlderCompleted: boolean;
  readonly doneWindowDays: number;
  readonly totalAuthorizedCardCount: number;
  readonly isTruncated: boolean;
  readonly canConfigure: boolean;
  readonly warnings: readonly ProjectKanbanWarning[];
  readonly columns: readonly ProjectKanbanColumn[];
  readonly cards: readonly ProjectKanbanCard[];
}

export interface ProjectKanbanCommandResponse {
  readonly snapshot: ProjectKanbanSnapshot;
  readonly focusTaskId: string | null;
  readonly warnings: readonly ProjectKanbanWarning[];
}

export function mapProjectKanbanSnapshot(dto: ProjectKanbanSnapshotDto): ProjectKanbanSnapshot {
  const board = dto.board;
  if (!board) throw new Error('Kanban board metadata is missing.');
  const projectId = requiredText(board.projectId, 'projectId');
  const columns = (dto.columns ?? []).map(mapColumn);
  const stageIds = new Set(columns.map((column) => column.workflowStageId));
  const cards = (dto.cards ?? []).map((card) => mapCard(card, stageIds));
  return {
    projectId,
    boardVersion: positiveNumber(board.version, 'board.version'),
    timeZone: requiredText(board.timeZone, 'board.timeZone'),
    defaultSwimlane: swimlane(board.defaultSwimlane),
    selectedSwimlane: swimlane(board.selectedSwimlane),
    supportedSwimlanes: (board.supportedSwimlanes ?? []).map(swimlane),
    supportedFilters: (board.supportedFilters ?? []).map((value) => requiredText(value, 'supportedFilter')),
    includesOlderCompleted: boolean(board.includesOlderCompleted),
    doneWindowDays: nonNegativeNumber(board.doneWindowDays),
    totalAuthorizedCardCount: nonNegativeNumber(board.totalAuthorizedCardCount),
    isTruncated: boolean(board.isTruncated),
    canConfigure: boolean(board.uiPermissions?.canConfigure),
    warnings: (board.warnings ?? []).map(mapWarning),
    columns,
    cards
  };
}

export function mapProjectKanbanCommand(dto: ProjectKanbanCommandResponseDto): ProjectKanbanCommandResponse {
  if (!dto.snapshot) throw new Error('Authoritative Kanban snapshot is missing.');
  return {
    snapshot: mapProjectKanbanSnapshot(dto.snapshot),
    focusTaskId: optionalText(dto.focusTaskId),
    warnings: (dto.warnings ?? []).map(mapWarning)
  };
}

export function swimlaneApiValue(value: ProjectKanbanSwimlane): number {
  return { none: 0, primaryAssignee: 1, targetGroup: 2, priority: 3, parentTask: 4 }[value];
}

function mapColumn(dto: ProjectKanbanColumnDto): ProjectKanbanColumn {
  return {
    workflowStageId: requiredText(dto.workflowStageId, 'column.workflowStageId'),
    displayName: requiredText(dto.displayName, 'column.displayName'),
    category: stageCategory(dto.category),
    displayOrder: number(dto.displayOrder),
    wipWarningLimit: nullablePositiveNumber(dto.wipWarningLimit),
    currentAuthorizedCardCount: nonNegativeNumber(dto.currentAuthorizedCardCount),
    hasWipWarning: boolean(dto.hasWipWarning),
    canConfigure: boolean(dto.uiPermissions?.canConfigure)
  };
}

function mapCard(dto: ProjectKanbanCardDto, stageIds: ReadonlySet<string>): ProjectKanbanCard {
  const workflowStageId = requiredText(dto.workflowStageId, 'card.workflowStageId');
  if (!stageIds.has(workflowStageId)) throw new Error('Kanban card references an unavailable Workflow Stage.');
  return {
    taskId: requiredText(dto.taskId, 'card.taskId'),
    summary: requiredText(dto.summary, 'card.summary'),
    workflowStageId,
    boardOrder: number(dto.boardOrder),
    parentTaskId: optionalText(dto.parentTaskId),
    parentSummary: optionalText(dto.parentSummary),
    isParentSummary: boolean(dto.isParentSummary),
    isLeaf: boolean(dto.isLeaf),
    completedChildCount: nonNegativeNumber(dto.completedChildCount),
    childCount: nonNegativeNumber(dto.childCount),
    progressPercent: percentage(dto.progressPercent),
    plannedStartDate: optionalText(dto.plannedStartDate),
    plannedEndDate: optionalText(dto.plannedEndDate),
    primaryAssigneeUserId: optionalText(dto.primaryAssigneeUserId),
    primaryAssigneeLabel: requiredText(dto.primaryAssigneeLabel, 'card.primaryAssigneeLabel'),
    targetGroupId: optionalText(dto.targetGroupId),
    targetGroupLabel: requiredText(dto.targetGroupLabel, 'card.targetGroupLabel'),
    priority: priority(dto.priority),
    isBlocked: boolean(dto.isBlocked),
    version: positiveNumber(dto.version, 'card.version'),
    swimlaneKey: requiredText(dto.swimlaneKey, 'card.swimlaneKey'),
    swimlaneLabel: requiredText(dto.swimlaneLabel, 'card.swimlaneLabel'),
    canOpen: boolean(dto.uiPermissions?.canOpen),
    canMove: boolean(dto.uiPermissions?.canMove),
    allowedTargetWorkflowStageIds: (dto.uiPermissions?.allowedTargetWorkflowStageIds ?? []).map((value) => requiredText(value, 'allowedTargetWorkflowStageId'))
  };
}

function mapWarning(dto: ProjectKanbanWarningDto): ProjectKanbanWarning {
  return {
    code: requiredText(dto.code, 'warning.code'),
    message: requiredText(dto.message, 'warning.message'),
    workflowStageId: optionalText(dto.workflowStageId),
    currentCount: nullableNumber(dto.currentCount),
    limit: nullableNumber(dto.limit)
  };
}

function swimlane(value: unknown): ProjectKanbanSwimlane {
  const key = typeof value === 'string' ? value.replace(/^./, (item) => item.toLowerCase()) : value;
  const values: Record<string, ProjectKanbanSwimlane> = {
    '0': 'none', none: 'none',
    '1': 'primaryAssignee', primaryAssignee: 'primaryAssignee',
    '2': 'targetGroup', targetGroup: 'targetGroup',
    '3': 'priority', priority: 'priority',
    '4': 'parentTask', parentTask: 'parentTask'
  };
  const mapped = values[String(key)];
  if (!mapped) throw new Error('Kanban swimlane is invalid.');
  return mapped;
}

function stageCategory(value: unknown): ProjectKanbanStageCategory {
  const key = typeof value === 'string' ? value.replace(/^./, (item) => item.toLowerCase()) : String(value);
  const values: Record<string, ProjectKanbanStageCategory> = {
    '0': 'backlog', backlog: 'backlog',
    '1': 'todo', todo: 'todo',
    '2': 'inProgress', inProgress: 'inProgress',
    '3': 'review', review: 'review',
    '4': 'done', done: 'done',
    '5': 'cancelled', cancelled: 'cancelled'
  };
  const mapped = values[key];
  if (!mapped) throw new Error('Kanban Stage category is invalid.');
  return mapped;
}

function priority(value: unknown): string {
  const key = typeof value === 'string' ? value : String(value);
  return ({ '0': 'Low', Low: 'Low', '1': 'Medium', Medium: 'Medium', '2': 'High', High: 'High', '3': 'Critical', Critical: 'Critical' } as Record<string, string>)[key] ?? 'Unknown priority';
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Kanban ${field} is invalid.`);
  return value;
}
function optionalText(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function boolean(value: unknown): boolean { return value === true; }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function positiveNumber(value: unknown, field: string): number {
  const result = number(value);
  if (result <= 0) throw new Error(`Kanban ${field} is invalid.`);
  return result;
}
function nonNegativeNumber(value: unknown): number { return Math.max(0, number(value)); }
function percentage(value: unknown): number { return Math.min(100, nonNegativeNumber(value)); }
function nullableNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function nullablePositiveNumber(value: unknown): number | null {
  const result = nullableNumber(value);
  return result !== null && result > 0 ? result : null;
}
