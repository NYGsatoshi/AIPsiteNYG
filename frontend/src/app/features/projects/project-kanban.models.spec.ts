import { mapProjectKanbanCommand, mapProjectKanbanSnapshot, swimlaneApiValue } from './project-kanban.models';
import { snapshotDto } from './project-kanban.test-data';

describe('Project Kanban API mapping', () => {
  it('maps a vendor-neutral authorized snapshot including hierarchy, warnings, and permissions', () => {
    const snapshot = mapProjectKanbanSnapshot(snapshotDto());

    expect(snapshot.projectId).toBe('project-1');
    expect(snapshot.boardVersion).toBe(7);
    expect(snapshot.columns[0].hasWipWarning).toBe(true);
    expect(snapshot.cards[0]).toMatchObject({
      taskId: 'task-1',
      isParentSummary: true,
      progressPercent: 50,
      plannedStartDate: '2026-07-01',
      plannedEndDate: '2026-07-31',
      priority: 'Critical',
      canMove: true,
      allowedTargetWorkflowStageIds: ['stage-todo', 'stage-done']
    });
    expect(snapshot.warnings[0].code).toBe('KANBAN_WIP_LIMIT_EXCEEDED');
  });

  it('rejects a card that references a Stage outside the authoritative column set', () => {
    const dto = snapshotDto();
    const invalid = { ...dto, cards: [{ ...dto.cards![0], workflowStageId: 'hidden-stage' }] };

    expect(() => mapProjectKanbanSnapshot(invalid)).toThrowError(/unavailable Workflow Stage/);
  });

  it('maps authoritative command responses and the stable swimlane wire values', () => {
    const response = mapProjectKanbanCommand({ snapshot: snapshotDto(), focusTaskId: 'task-1', warnings: [] });

    expect(response.focusTaskId).toBe('task-1');
    expect(response.snapshot.cards).toHaveLength(1);
    expect(swimlaneApiValue('parentTask')).toBe(4);
  });
});
