import { TaskPriority, TaskStatus } from './projects.types';

export interface PagedResponseDto<T> {
  readonly items?: readonly T[];
  readonly page?: unknown;
  readonly pageSize?: unknown;
  readonly totalCount?: unknown;
}

export interface ProjectUiPermissionDto {
  readonly canCreateTask?: unknown;
}

export interface ProjectDto {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly startDate?: unknown;
  readonly endDate?: unknown;
  readonly uiPermissions?: ProjectUiPermissionDto | null;
}

export interface TaskUiPermissionDto {
  readonly canEdit?: unknown;
  readonly canAssign?: unknown;
  readonly canChangeStatus?: unknown;
  readonly canDelete?: unknown;
  readonly allowedTransitions?: unknown;
  readonly rowVersion?: unknown;
}

export interface TaskDto {
  readonly id?: unknown;
  readonly projectId?: unknown;
  readonly milestoneId?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly status?: unknown;
  readonly priority?: unknown;
  readonly startDate?: unknown;
  readonly dueDate?: unknown;
  readonly progressPercent?: unknown;
  readonly uiPermissions?: TaskUiPermissionDto | null;
}

export interface MyTaskDto {
  readonly taskId?: unknown;
  readonly projectId?: unknown;
  readonly projectTitle?: unknown;
  readonly title?: unknown;
  readonly dueDate?: unknown;
  readonly status?: unknown;
  readonly priority?: unknown;
  readonly isOverdue?: unknown;
}

export interface CreateTaskRequestDto {
  readonly milestoneId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly priority: number;
  readonly startDate: string | null;
  readonly dueDate: string | null;
}

export interface UpdateTaskRequestDto {
  readonly title: string;
  readonly description: string;
  readonly priority: number;
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
  readonly progressPercent: number;
  readonly status?: number;
}

const taskPriorityApiValues: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3
};

const taskStatusApiValues: Record<TaskStatus, number> = {
  notStarted: 0,
  inProgress: 1,
  review: 2,
  blocked: 3,
  done: 4,
  cancelled: 5
};

export function toCreateTaskRequestDto(input: {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly startDate: string;
  readonly dueDate: string;
}): CreateTaskRequestDto {
  return {
    milestoneId: null,
    title: input.title.trim(),
    description: input.description.trim().length > 0 ? input.description.trim() : null,
    priority: taskPriorityApiValues[input.priority],
    startDate: nullableDate(input.startDate),
    dueDate: nullableDate(input.dueDate)
  };
}

export function toUpdateTaskRequestDto(input: {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly startDate: string;
  readonly dueDate: string;
  readonly progressPercent: number;
  readonly status?: TaskStatus;
}): UpdateTaskRequestDto {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    priority: taskPriorityApiValues[input.priority],
    startDate: nullableDate(input.startDate),
    dueDate: nullableDate(input.dueDate),
    progressPercent: input.progressPercent,
    ...(input.status ? { status: taskStatusApiValues[input.status] } : {})
  };
}

function nullableDate(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
