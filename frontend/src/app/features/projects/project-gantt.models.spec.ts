import {
  ProjectGanttDependencyDto,
  ProjectGanttItemDto,
  ProjectGanttPermissionsDto,
  ProjectGanttSnapshotDto,
  ProjectGanttWarningDto
} from './projects.api';
import { mapProjectGanttCommandResponse, mapProjectGanttSnapshot } from './project-gantt.models';

describe('Project Gantt API mapping', () => {
  it('maps the bounded vendor-neutral snapshot without reinterpreting DateOnly values', () => {
    const snapshot = mapProjectGanttSnapshot(snapshotDto());

    expect(snapshot).toMatchObject({
      projectId: 'project-1',
      projectVersion: 11,
      workflowVersion: 5,
      calendarVersion: null,
      maximumItems: 10,
      totalItems: 4
    });
    expect(snapshot.calendar).toEqual({
      timeZone: 'Asia/Tokyo',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      holidaysAvailable: false,
      limitations: ['Holiday dates are not available.']
    });
    expect(snapshot.scheduledItems[1]).toMatchObject({
      taskId: 'task-child',
      parentTaskId: 'task-parent',
      plannedStartDate: '2026-07-02',
      plannedEndDate: '2026-07-10',
      kind: 'task',
      stageCategory: 'inProgress',
      priority: 'high'
    });
    expect(snapshot.unscheduledItems[0].warnings[0].code).toBe('UNSCHEDULED');
    expect(snapshot.milestones[0].milestoneDate).toBe('2026-07-31');
    expect(snapshot.dependencies[0]).toMatchObject({ type: 'finishToStart', editable: true });
  });

  it('validates real ISO calendar dates without using browser-local Date parsing', () => {
    const dto = snapshotDto();
    const invalid = {
      ...dto,
      scheduledItems: dto.scheduledItems.map((item) =>
        item.taskId === 'task-child' ? { ...item, plannedStartDate: '2026-02-30' } : item
      )
    };

    expect(() => mapProjectGanttSnapshot(invalid)).toThrowError(/plannedStartDate.*ISO yyyy-MM-dd/);
  });

  it('rejects duplicate task IDs across scheduled, unscheduled, and Milestone collections', () => {
    const dto = snapshotDto();
    const duplicate: ProjectGanttItemDto = {
      ...dto.scheduledItems[1],
      plannedStartDate: null,
      plannedEndDate: null,
      warnings: [warning('UNSCHEDULED', 'Task is unscheduled.', 'Task', 'task-child')]
    };

    expect(() => mapProjectGanttSnapshot({
      ...dto,
      unscheduledItems: [...dto.unscheduledItems, duplicate],
      totalItems: 5
    })).toThrowError(/duplicate taskId task-child/);
  });

  it('rejects unavailable parent references and hierarchy cycles', () => {
    const dto = snapshotDto();
    const missingParent = {
      ...dto,
      scheduledItems: dto.scheduledItems.map((item) =>
        item.taskId === 'task-child' ? { ...item, parentTaskId: 'hidden-task' } : item
      )
    };
    expect(() => mapProjectGanttSnapshot(missingParent)).toThrowError(/outside the authorized snapshot/);

    const cycle = {
      ...dto,
      scheduledItems: dto.scheduledItems.map((item) =>
        item.taskId === 'task-parent' ? { ...item, parentTaskId: 'task-child' } : item
      )
    };
    expect(() => mapProjectGanttSnapshot(cycle)).toThrowError(/parent cycle/);

    const grandchild = {
      ...dto,
      unscheduledItems: dto.unscheduledItems.map((item) => ({
        ...item,
        parentTaskId: 'task-child'
      }))
    };
    expect(() => mapProjectGanttSnapshot(grandchild)).toThrowError(/root-and-child hierarchy depth/);
  });

  it('rejects unknown dependency endpoints, duplicate edges, and dependency cycles', () => {
    const dto = snapshotDto();
    expect(() => mapProjectGanttSnapshot({
      ...dto,
      dependencies: [{ ...dto.dependencies[0], predecessorTaskId: 'hidden-task' }]
    })).toThrowError(/outside the authorized Project snapshot/);

    expect(() => mapProjectGanttSnapshot({
      ...dto,
      dependencies: [
        dto.dependencies[0],
        { ...dto.dependencies[0], dependencyId: 'dependency-2', version: 2 }
      ]
    })).toThrowError(/duplicate predecessor\/successor edge/);

    expect(() => mapProjectGanttSnapshot({
      ...dto,
      dependencies: [
        dto.dependencies[0],
        {
          ...dto.dependencies[0],
          dependencyId: 'dependency-2',
          predecessorTaskId: 'task-child',
          successorTaskId: 'task-parent',
          version: 2
        }
      ]
    })).toThrowError(/contains a cycle/);
  });

  it('requires positive safe versions and enforces the declared item bound', () => {
    const dto = snapshotDto();
    expect(() => mapProjectGanttSnapshot({ ...dto, projectVersion: 0 })).toThrowError(/projectVersion.*positive safe integer/);
    expect(() => mapProjectGanttSnapshot({ ...dto, workflowVersion: Number.MAX_SAFE_INTEGER + 1 })).toThrowError(/workflowVersion.*positive safe integer/);
    expect(() => mapProjectGanttSnapshot({ ...dto, maximumItems: 3 })).toThrowError(/maximumItems.*returned item count/);
    expect(() => mapProjectGanttSnapshot({ ...dto, totalItems: 3 })).toThrowError(/totalItems.*returned item count/);
    expect(() => mapProjectGanttSnapshot({ ...dto, totalItems: 5 })).toThrowError(/truncated Gantt snapshots/);
  });

  it('keeps legacy missing-date Milestones and non-FS dependencies only with structured read-only warnings', () => {
    const dto = snapshotDto();
    const legacyMilestone: ProjectGanttItemDto = {
      ...dto.milestones[0],
      milestoneDate: null,
      warnings: [
        warning('MILESTONE_DATE_REQUIRED', 'Milestone date is required.', 'Task', 'milestone-task')
      ]
    };
    const legacyDependency: ProjectGanttDependencyDto = {
      ...dto.dependencies[0],
      type: 'StartToStart',
      editable: false,
      warnings: [
        warning('LEGACY_DEPENDENCY_TYPE', 'Legacy dependency is read-only.', 'Dependency', 'dependency-1')
      ]
    };

    const snapshot = mapProjectGanttSnapshot({
      ...dto,
      milestones: [legacyMilestone],
      dependencies: [legacyDependency]
    });
    expect(snapshot.milestones[0].milestoneDate).toBeNull();
    expect(snapshot.dependencies[0]).toMatchObject({ type: 'startToStart', editable: false });

    expect(() => mapProjectGanttSnapshot({
      ...dto,
      dependencies: [{ ...legacyDependency, warnings: [] }]
    })).toThrowError(/LEGACY_DEPENDENCY_TYPE/);
  });

  it('renders a legacy non-FS inventory edge even when it closes a cycle with an FS edge', () => {
    const dto = snapshotDto();
    const legacyReverse: ProjectGanttDependencyDto = {
      ...dto.dependencies[0],
      dependencyId: 'legacy-reverse',
      predecessorTaskId: 'task-child',
      successorTaskId: 'task-parent',
      type: 'StartToStart',
      editable: false,
      version: 2,
      warnings: [
        warning('LEGACY_DEPENDENCY_TYPE', 'Legacy dependency is read-only.', 'Dependency', 'legacy-reverse')
      ]
    };

    const snapshot = mapProjectGanttSnapshot({
      ...dto,
      dependencies: [...dto.dependencies, legacyReverse]
    });

    expect(snapshot.dependencies).toHaveLength(2);
    expect(snapshot.dependencies[1]).toMatchObject({
      dependencyId: 'legacy-reverse',
      type: 'startToStart',
      editable: false
    });
  });

  it('maps the flat authoritative Task command response used before a full snapshot refetch', () => {
    const result = mapProjectGanttCommandResponse({
      taskId: 'task-child',
      kind: 'Task',
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-11',
      milestoneDate: null,
      progressPercent: 30,
      version: 3,
      warnings: [
        warning('DEPENDENCY_VIOLATION', 'The planned dates violate a dependency.', 'Task', 'task-child')
      ]
    });

    expect(result).toMatchObject({
      taskId: 'task-child',
      kind: 'task',
      plannedStartDate: '2026-07-03',
      plannedEndDate: '2026-07-11',
      progressPercent: 30,
      version: 3
    });
    expect(result.warnings[0].code).toBe('DEPENDENCY_VIOLATION');
  });
});

function snapshotDto(): ProjectGanttSnapshotDto {
  const editorPermissions: ProjectGanttPermissionsDto = {
    canEditSchedule: true,
    canEditProgress: true,
    canManageDependencies: true,
    canClearSchedule: true,
    canOpen: true
  };
  const parentPermissions: ProjectGanttPermissionsDto = {
    ...editorPermissions,
    canEditSchedule: false,
    canEditProgress: false,
    canClearSchedule: false
  };
  const milestonePermissions: ProjectGanttPermissionsDto = {
    ...editorPermissions,
    canEditProgress: false,
    canClearSchedule: false
  };

  return {
    projectId: 'project-1',
    projectTitle: 'Canonical delivery',
    projectVersion: 11,
    workflowVersion: 5,
    calendarVersion: null,
    calendar: {
      timeZone: 'Asia/Tokyo',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      holidaysAvailable: false,
      limitations: ['Holiday dates are not available.']
    },
    scheduledItems: [
      task({
        taskId: 'task-parent',
        title: 'Parent',
        plannedStartDate: '2026-07-01',
        plannedEndDate: '2026-07-31',
        progressPercent: 50,
        progressIsDerived: true,
        scheduleEditPermissions: parentPermissions,
        warnings: [warning('PARENT_DERIVED', 'Dates and progress are derived.', 'Task', 'task-parent')]
      }),
      task({
        taskId: 'task-child',
        parentTaskId: 'task-parent',
        milestoneId: 'milestone-1',
        title: 'Child',
        plannedStartDate: '2026-07-02',
        plannedEndDate: '2026-07-10',
        progressPercent: 25,
        workflowStageId: 'stage-progress',
        workflowStageName: 'In progress',
        stageCategory: 'InProgress',
        priority: 'High',
        version: 3
      })
    ],
    unscheduledItems: [
      task({
        taskId: 'task-unscheduled',
        title: 'Unscheduled',
        warnings: [warning('UNSCHEDULED', 'Task is unscheduled.', 'Task', 'task-unscheduled')],
        version: 2
      })
    ],
    milestones: [
      {
        taskId: 'milestone-task',
        kind: 'Milestone',
        parentTaskId: null,
        milestoneId: 'milestone-1',
        title: 'Launch',
        plannedStartDate: null,
        plannedEndDate: null,
        milestoneDate: '2026-07-31',
        progressPercent: 100,
        progressIsDerived: false,
        workflowStageId: 'stage-done',
        workflowStageName: 'Done',
        stageCategory: 'Done',
        priority: 'Critical',
        isBlocked: false,
        primaryAssignee: null,
        version: 4,
        scheduleEditPermissions: milestonePermissions,
        warnings: []
      }
    ],
    dependencies: [
      {
        dependencyId: 'dependency-1',
        predecessorTaskId: 'task-parent',
        successorTaskId: 'task-child',
        type: 'FinishToStart',
        editable: true,
        version: 1,
        warnings: []
      }
    ],
    warnings: [],
    permissions: editorPermissions,
    maximumItems: 10,
    totalItems: 4
  };
}

function task(overrides: Partial<ProjectGanttItemDto>): ProjectGanttItemDto {
  return {
    taskId: 'task-default',
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
    scheduleEditPermissions: {
      canEditSchedule: true,
      canEditProgress: true,
      canManageDependencies: true,
      canClearSchedule: true,
      canOpen: true
    },
    warnings: [],
    ...overrides
  };
}

function warning(
  code: string,
  message: string,
  targetType: string,
  targetId: string | null
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
