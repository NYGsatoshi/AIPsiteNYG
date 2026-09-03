import {
  mapProjectActivationState,
  mapMyTaskDtoToRecord,
  mapProjectDtoToRecord,
  mapProjectVisibility,
  mapTaskDtoToRecord,
  projectStatusLabel,
  projectWorkStatus,
  taskStageWorkStatus
} from './projects.mapper';
import { mapProjectActivationSuccess } from './projects.api';

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

  it.each([
    ['Backlog', 'backlog', 'notStarted', 'draft'],
    ['Todo', 'todo', 'notStarted', 'ready'],
    ['InProgress', 'inProgress', 'inProgress', 'running'],
    ['Review', 'review', 'review', 'needsReview'],
    ['Done', 'done', 'done', 'completed'],
    ['Cancelled', 'cancelled', 'cancelled', 'cancelled']
  ] as const)(
    'maps canonical category %s independently from the legacy numeric status',
    (apiCategory, category, status, workStatus) => {
      const task = mapTaskDtoToRecord({
        id: `task-${category}`,
        projectId: 'project-1',
        title: apiCategory,
        stageCategory: apiCategory,
        status: 3,
        priority: 'Medium'
      }, []);

      expect(task.stageCategory).toBe(category);
      expect(task.status).toBe(status);
      expect(taskStageWorkStatus(category)).toBe(workStatus);
    }
  );

  it('preserves unknown artifact availability when a compatible Task contract omits the projection', () => {
    const task = mapTaskDtoToRecord({
      id: 'task-compatible',
      projectId: 'project-1',
      title: 'Compatible task',
      stageCategory: 2,
      priority: 'Medium'
    }, []);

    expect(task.hasArtifact).toBeUndefined();
  });

  it('keeps Blocked independent and preserves authoritative list metadata', () => {
    const task = mapTaskDtoToRecord({
      id: 'task-review',
      projectId: 'project-1',
      title: 'Review task',
      workflowStageId: 'stage-review',
      workflowStageName: 'Editorial review',
      stageCategory: 'Review',
      status: 3,
      isBlocked: true,
      priority: 'High',
      createdAt: '2026-08-20T09:00:00Z',
      updatedAt: '2026-08-24T10:30:00Z',
      hasArtifact: true
    }, []);

    expect(task.status).toBe('review');
    expect(task.stageCategory).toBe('review');
    expect(task.isBlocked).toBe(true);
    expect(task.workflowStageName).toBe('Editorial review');
    expect(task.createdAt).toBe('2026-08-20T09:00:00Z');
    expect(task.updatedAt).toBe('2026-08-24T10:30:00Z');
    expect(task.hasArtifact).toBe(true);
  });

  it('never interprets a numeric list category as a category ordinal when legacy status is present', () => {
    const task = mapTaskDtoToRecord({
      id: 'task-legacy',
      projectId: 'project-1',
      title: 'Legacy task',
      stageCategory: 1,
      status: 4,
      priority: 1
    }, []);

    expect(task.status).toBe('done');
    expect(task.stageCategory).toBe('done');
  });

  it.each([
    [0, 'backlog', 'notStarted'],
    [1, 'todo', 'notStarted'],
    [2, 'inProgress', 'inProgress'],
    [3, 'review', 'review'],
    [4, 'done', 'done'],
    [5, 'cancelled', 'cancelled']
  ] as const)(
    'maps canonical numeric Task-detail category %s only when legacy status is absent',
    (apiCategory, category, status) => {
      const task = mapTaskDtoToRecord({
        id: `task-detail-${apiCategory}`,
        projectId: 'project-1',
        title: 'Canonical detail',
        stageCategory: apiCategory,
        priority: 'Medium'
      }, []);

      expect(task.stageCategory).toBe(category);
      expect(task.status).toBe(status);
    }
  );

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

  it('maps the canonical Draft projection and fails closed for activation affordances', () => {
    const project = mapProjectDtoToRecord({
      id: 'project-1',
      workspaceId: 'workspace-1',
      groupId: 'group-1',
      ownerUserId: 'owner-1',
      title: 'Canonical Draft',
      description: 'Draft description',
      status: 'Planning',
      visibility: 'MembersOnly',
      activationState: 'NeverActivated',
      activatedAtUtc: null,
      activationVersion: null,
      versionNo: 7,
      uiPermissions: { canCreateTask: true, canActivate: true }
    });

    expect(project).toEqual(expect.objectContaining({
      workspaceId: 'workspace-1',
      groupId: 'group-1',
      ownerUserId: 'owner-1',
      description: 'Draft description',
      statusLabel: 'Draft',
      visibility: 'membersOnly',
      visibilityLabel: 'Members only',
      activationState: 'neverActivated',
      versionNo: 7,
      isOperational: false,
      canCreateTask: false,
      canActivate: true
    }));
  });

  it.each([
    [{ versionNo: 0 }, 'invalid version'],
    [{ activationState: 'Unexpected' }, 'unknown activation state'],
    [{ status: 'Active', activationState: 'Activated' }, 'already active'],
    [{ uiPermissions: { canActivate: 'true' } }, 'non-boolean permission'],
    [{ visibility: null }, 'unknown visibility'],
    [{ activatedAtUtc: '2026-08-24T00:00:00Z' }, 'existing activation timestamp'],
    [{ activationVersion: 1 }, 'existing activation version']
  ])('does not expose activation for %s (%s)', (overrides, _case) => {
    const project = mapProjectDtoToRecord({
      id: 'project-1',
      title: 'Project',
      status: 'Planning',
      visibility: 'MembersOnly',
      activationState: 'NeverActivated',
      activatedAtUtc: null,
      activationVersion: null,
      versionNo: 2,
      uiPermissions: { canActivate: true },
      ...overrides
    });
    expect(project.canActivate).toBe(false);
    if (project.status === 'planning' && project.activationState === 'neverActivated')
      {expect(project.isOperational).toBe(false);}
  });

  it('maps only supported visibility and activation vocabularies', () => {
    expect(mapProjectVisibility(0)).toBe('workspaceVisible');
    expect(mapProjectVisibility('Restricted')).toBe('restricted');
    expect(mapProjectVisibility('unexpected')).toBe('unknown');
    expect(mapProjectActivationState(2)).toBe('activated');
    expect(mapProjectActivationState('unexpected')).toBe('legacyUnknown');
  });

  it.each([
    ['Review', 'Activated'],
    ['Completed', 'Activated'],
    ['Suspended', 'Activated'],
    ['Active', 'LegacyUnknown']
  ])('preserves established operational projections for %s / %s', (status, activationState) => {
    const project = mapProjectDtoToRecord({
      id: 'project-1',
      title: 'Existing Project',
      status,
      activationState,
      uiPermissions: { canCreateTask: true }
    });

    expect(project.isOperational).toBe(true);
    expect(project.canCreateTask).toBe(true);
  });

  it('strictly maps the exact Project activation envelope', () => {
    expect(mapProjectActivationSuccess({
      requestId: 'request-activate-1',
      data: { projectId: 'project-1' },
      warnings: []
    }, 'project-1', 200)).toEqual({
      requestId: 'request-activate-1',
      data: { projectId: 'project-1' },
      warnings: []
    });
  });

  it.each([
    ['wrong status', { requestId: 'request-1', data: { projectId: 'project-1' }, warnings: [] }, 201],
    ['missing request id', { data: { projectId: 'project-1' }, warnings: [] }, 200],
    ['missing warnings', { requestId: 'request-1', data: { projectId: 'project-1' } }, 200],
    ['mismatched Project', { requestId: 'request-1', data: { projectId: 'project-2' }, warnings: [] }, 200]
  ])('rejects an activation success with %s', (_case, response, status) => {
    expect(() => mapProjectActivationSuccess(response, 'project-1', status)).toThrow();
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
