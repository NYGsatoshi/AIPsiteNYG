import {
  mapMyTaskDtoToRecord,
  mapProjectDtoToRecord,
  mapTaskDtoToRecord,
  projectStatusLabel,
  projectWorkStatus
} from './projects.mapper';

describe('projects mapper', () => {
  it('maps numeric and string task enums from backend DTOs', () => {
    const numericTask = mapTaskDtoToRecord(
      {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Numeric task',
        status: 2,
        priority: 3,
        progressPercent: 45,
        uiPermissions: {
          canEdit: true,
          canAssign: false,
          canChangeStatus: true,
          allowedTransitions: [3, 'Completed']
        }
      },
      [{ ...mapProjectDtoToRecord({ id: 'project-1', title: 'Project', status: 'Active' }) }]
    );
    const stringTask = mapTaskDtoToRecord(
      {
        id: 'task-2',
        projectId: 'project-1',
        title: 'String task',
        status: 'Blocked',
        priority: 'High',
        progressPercent: 10,
        uiPermissions: {
          canEdit: false,
          canAssign: false,
          canChangeStatus: false,
          allowedTransitions: []
        }
      },
      [{ ...mapProjectDtoToRecord({ id: 'project-1', title: 'Project', status: 'Active' }) }]
    );

    expect(numericTask.status).toBe('review');
    expect(numericTask.priority).toBe('urgent');
    expect(numericTask.allowedTransitions).toEqual(['blocked', 'done']);
    expect(numericTask.capabilities).toContain('editTask');
    expect(numericTask.capabilities).toContain('changeTaskStatus');
    expect(stringTask.status).toBe('blocked');
    expect(stringTask.priority).toBe('high');
    expect(stringTask.capabilities).not.toContain('changeTaskStatus');
  });

  it('retains the canonical Task primary assignee rather than substituting a placeholder', () => {
    const task = mapTaskDtoToRecord({
      id: 'task-1', projectId: 'project-1', title: 'Detailed task', stageCategory: 1, priority: 'Medium',
      primaryAssignee: { userId: 'user-1', displayName: 'Canonical assignee' }, version: 7
    }, [mapProjectDtoToRecord({ id: 'project-1', title: 'Project', status: 'Active' })]);

    expect(task.assignee).toBe('Canonical assignee');
    expect(task.rowVersion).toBe('7');
  });

  it('maps project create permission, canonical work status, and authoritative update time', () => {
    const project = mapProjectDtoToRecord({
      id: 'project-1',
      title: 'Project',
      status: 1,
      createdAt: '2026-08-20T09:00:00Z',
      updatedAt: '2026-08-22T11:30:00Z',
      uiPermissions: { canCreateTask: true }
    });

    expect(project.canCreateTask).toBe(true);
    expect(project.status).toBe('active');
    expect(project.statusLabel).toBe('Running');
    expect(project.updatedAt).toBe('2026-08-22T11:30:00Z');
    expect(projectWorkStatus('planning')).toBe('draft');
    expect(projectWorkStatus('review')).toBe('needsReview');
    expect(projectWorkStatus('atRisk')).toBe('needsAttention');
    expect(projectStatusLabel('complete')).toBe('Completed');
  });

  it('falls back to project creation time when no update time exists', () => {
    const project = mapProjectDtoToRecord({
      id: 'project-1',
      title: 'Project',
      status: 'Planning',
      createdAt: '2026-08-20T09:00:00Z'
    });

    expect(project.updatedAt).toBe('2026-08-20T09:00:00Z');
    expect(project.statusLabel).toBe('Draft');
  });

  it('maps my-task rows without fake progress', () => {
    const myTask = mapMyTaskDtoToRecord({
      taskId: 'task-1',
      projectId: 'project-1',
      projectTitle: 'Project',
      title: 'Assigned task',
      status: 'InProgress',
      priority: 'Normal'
    });

    expect(myTask.assignee).toBe('Assigned to you');
    expect(myTask.progressPercent).toBeNull();
  });

  it('rejects missing required identifiers instead of fabricating IDs', () => {
    expect(() => mapProjectDtoToRecord({ title: 'Missing ID', status: 1 })).toThrow(/project\.id/);
    expect(() =>
      mapTaskDtoToRecord(
        {
          id: 'task-1',
          title: 'Missing project ID',
          status: 1,
          priority: 1
        },
        []
      )
    ).toThrow(/task\.projectId/);
    expect(() =>
      mapMyTaskDtoToRecord({
        projectId: 'project-1',
        title: 'Missing task ID',
        status: 1,
        priority: 1
      })
    ).toThrow(/myTask\.taskId/);
  });
});
