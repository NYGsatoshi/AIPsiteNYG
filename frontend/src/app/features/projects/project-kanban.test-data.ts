import { ProjectKanbanSnapshotDto } from './projects.api';

export function snapshotDto(overrides: Partial<ProjectKanbanSnapshotDto> = {}): ProjectKanbanSnapshotDto {
  return {
    board: {
      projectId: 'project-1',
      version: 7,
      timeZone: 'UTC',
      defaultSwimlane: 0,
      selectedSwimlane: 4,
      supportedSwimlanes: [0, 1, 2, 3, 4],
      supportedFilters: ['includeOlderCompleted'],
      includesOlderCompleted: false,
      doneWindowDays: 30,
      totalAuthorizedCardCount: 1,
      isTruncated: false,
      uiPermissions: { canConfigure: true },
      warnings: [{ code: 'KANBAN_WIP_LIMIT_EXCEEDED', message: 'Todo exceeds its warning limit.', workflowStageId: 'stage-todo', currentCount: 2, limit: 1 }]
    },
    columns: [
      { workflowStageId: 'stage-todo', displayName: 'Todo', category: 1, displayOrder: 1000, wipWarningLimit: 1, currentAuthorizedCardCount: 2, hasWipWarning: true, uiPermissions: { canConfigure: true } },
      { workflowStageId: 'stage-done', displayName: 'Done', category: 4, displayOrder: 2000, wipWarningLimit: null, currentAuthorizedCardCount: 0, hasWipWarning: false, uiPermissions: { canConfigure: true } }
    ],
    cards: [{
      taskId: 'task-1',
      summary: 'Canonical card',
      workflowStageId: 'stage-todo',
      boardOrder: 1000,
      parentTaskId: null,
      parentSummary: null,
      isParentSummary: true,
      isLeaf: false,
      completedChildCount: 1,
      childCount: 2,
      progressPercent: 50,
      plannedStartDate: '2026-07-01',
      plannedEndDate: '2026-07-31',
      primaryAssigneeUserId: 'user-1',
      primaryAssigneeLabel: 'Ada',
      targetGroupId: null,
      targetGroupLabel: 'Ungrouped',
      priority: 3,
      isBlocked: true,
      version: 3,
      swimlaneKey: 'no-parent',
      swimlaneLabel: 'No parent task',
      uiPermissions: { canOpen: true, canMove: true, allowedTargetWorkflowStageIds: ['stage-todo', 'stage-done'] }
    }],
    ...overrides
  };
}
