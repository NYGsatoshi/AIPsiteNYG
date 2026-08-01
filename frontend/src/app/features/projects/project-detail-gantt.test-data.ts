import {
  ProjectGanttItemDto,
  ProjectGanttPermissionsDto,
  ProjectGanttSnapshotDto,
  ProjectGanttWarningDto
} from './projects.api';

const editorPermissions: ProjectGanttPermissionsDto = {
  canEditSchedule: true,
  canEditProgress: true,
  canManageDependencies: true,
  canClearSchedule: true,
  canOpen: true
};

export function ganttSnapshotDto(
  overrides: Partial<ProjectGanttSnapshotDto> = {}
): ProjectGanttSnapshotDto {
  return {
    projectId: 'project-1',
    projectTitle: 'Project',
    projectVersion: 11,
    workflowVersion: 5,
    calendarVersion: null,
    calendar: {
      timeZone: 'Asia/Tokyo',
      workingDays: [],
      holidaysAvailable: false,
      limitations: ['Holiday dates are unavailable.']
    },
    scheduledItems: [
      ganttTask({
        taskId: 'task-1',
        title: 'Canonical schedule task',
        plannedStartDate: '2026-07-01',
        plannedEndDate: '2026-07-10',
        progressPercent: 25,
        version: 3
      }),
      ganttTask({
        taskId: 'task-2',
        title: 'Predecessor task',
        plannedStartDate: '2026-06-20',
        plannedEndDate: '2026-06-30',
        version: 2
      })
    ],
    unscheduledItems: [
      ganttTask({
        taskId: 'task-3',
        title: 'Unscheduled task',
        version: 2,
        warnings: [ganttWarning('UNSCHEDULED', 'Task is unscheduled.', 'Task', 'task-3')]
      })
    ],
    milestones: [
      {
        ...ganttTask({
          taskId: 'milestone-1',
          title: 'Launch',
          version: 4,
          progressPercent: 0,
          workflowStageName: 'To do'
        }),
        kind: 'Milestone',
        milestoneDate: '2026-07-31',
        scheduleEditPermissions: {
          ...editorPermissions,
          canEditProgress: false,
          canClearSchedule: false,
          canManageDependencies: false
        }
      }
    ],
    dependencies: [
      {
        dependencyId: 'dependency-1',
        predecessorTaskId: 'task-2',
        successorTaskId: 'task-1',
        type: 'FinishToStart',
        editable: true,
        version: 3,
        warnings: []
      }
    ],
    warnings: [],
    permissions: editorPermissions,
    maximumItems: 20,
    totalItems: 4,
    ...overrides
  };
}

export function viewerGanttSnapshotDto(): ProjectGanttSnapshotDto {
  const permissions: ProjectGanttPermissionsDto = {
    canEditSchedule: false,
    canEditProgress: false,
    canManageDependencies: false,
    canClearSchedule: false,
    canOpen: true
  };
  const dto = ganttSnapshotDto();
  return {
    ...dto,
    permissions,
    scheduledItems: dto.scheduledItems.map((item) => ({
      ...item,
      scheduleEditPermissions: permissions
    })),
    unscheduledItems: dto.unscheduledItems.map((item) => ({
      ...item,
      scheduleEditPermissions: permissions
    })),
    milestones: dto.milestones.map((item) => ({
      ...item,
      scheduleEditPermissions: permissions
    }))
  };
}

function ganttTask(overrides: Partial<ProjectGanttItemDto>): ProjectGanttItemDto {
  return {
    taskId: 'task',
    kind: 'Task',
    parentTaskId: null,
    milestoneId: null,
    title: 'Task',
    plannedStartDate: null,
    plannedEndDate: null,
    milestoneDate: null,
    progressPercent: 0,
    progressIsDerived: false,
    workflowStageId: 'stage-todo',
    workflowStageName: 'To do',
    stageCategory: 'Todo',
    priority: 'Medium',
    isBlocked: false,
    primaryAssignee: { userId: 'user-1', displayName: 'Schedule Editor' },
    version: 1,
    scheduleEditPermissions: editorPermissions,
    warnings: [],
    ...overrides
  };
}

function ganttWarning(
  code: string,
  message: string,
  targetType: string,
  targetId: string
): ProjectGanttWarningDto {
  return {
    code,
    message,
    severity: 'Warning',
    targetType,
    targetId,
    field: null,
    blocking: false
  };
}
