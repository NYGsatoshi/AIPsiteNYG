import {
  canonicalizeTaskCreateInput,
  mapTaskCreateOptions,
  mapTaskCreateSuccess,
  TaskCreateInput,
  TaskCreateRequestDto,
} from './task-create.api';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const milestoneId = '33333333-3333-4333-8333-333333333333';
const assigneeId = '44444444-4444-4444-8444-444444444444';
const taskId = '55555555-5555-4555-8555-555555555555';
const workflowStageId = '66666666-6666-4666-8666-666666666666';

const input: TaskCreateInput = {
  title: '  Evidence review  ',
  description: '  Describe the authorized Task.  ',
  priority: 'high',
  milestoneId,
  startDate: '2026-08-24',
  dueDate: '2026-08-28',
  goal: 'Review evidence',
  deliverable: 'Decision note',
  constraints: 'No raw source persistence',
  primaryAssigneeUserId: assigneeId,
  sourceScopeMode: 'TaskOverride',
  taskOverridePolicy: { webEnabled: false, projectFilesEnabled: true },
};

const request: TaskCreateRequestDto = {
  title: 'Evidence review',
  description: 'Describe the authorized Task.',
  priority: 2,
  milestoneId,
  startDate: '2026-08-24',
  dueDate: '2026-08-28',
  goal: 'Review evidence',
  deliverable: 'Decision note',
  constraints: 'No raw source persistence',
  primaryAssigneeUserId: assigneeId,
  sourceScopeMode: 'TaskOverride',
  taskOverridePolicy: { webEnabled: false, projectFilesEnabled: true },
};

const successEnvelope = {
  requestId: 'task-create-201',
  data: {
    taskId,
    projectId,
    workspaceId,
    milestoneId,
    primaryAssigneeUserId: assigneeId,
    title: request.title,
    priority: request.priority,
    status: 0,
    workflowStageId,
    version: 1,
    sourceScopeMode: 'TaskOverride',
    taskOverridePolicy: request.taskOverridePolicy,
  },
  warnings: [],
};

describe('Task create API contract mapping', () => {
  it('maps only server-authorized Project options, including a fail-closed synthetic version zero', () => {
    expect(
      mapTaskCreateOptions(
        {
          requestId: 'task-create-options-200',
          data: {
            projectId,
            workspaceId,
            projectTitle: 'Evidence Project',
            canCreateTask: true,
            canManageProject: false,
            milestones: [{ id: milestoneId, title: 'Evidence milestone' }],
            assignees: [{ userId: assigneeId, displayName: 'Project member' }],
            projectScope: {
              policy: { webEnabled: false, projectFilesEnabled: false },
              version: 0,
              canSetTaskOverride: false,
            },
          },
          warnings: [],
        },
        projectId,
      ),
    ).toMatchObject({
      projectId,
      workspaceId,
      projectTitle: 'Evidence Project',
      milestones: [{ id: milestoneId, title: 'Evidence milestone' }],
      assignees: [{ userId: assigneeId, displayName: 'Project member' }],
      projectScope: { version: 0, canSetTaskOverride: false },
    });
  });

  it('fails closed for another Project or duplicate server-owned candidates', () => {
    const envelope = {
      requestId: 'task-create-options-200',
      data: {
        projectId,
        workspaceId,
        projectTitle: 'Evidence Project',
        canCreateTask: true,
        canManageProject: true,
        milestones: [{ id: milestoneId, title: 'Evidence milestone' }],
        assignees: [{ userId: assigneeId, displayName: 'Project member' }],
        projectScope: {
          policy: { webEnabled: false, projectFilesEnabled: false },
          version: 1,
          canSetTaskOverride: true,
        },
      },
      warnings: [],
    };

    expect(() =>
      mapTaskCreateOptions(
        { ...envelope, data: { ...envelope.data, projectId: workspaceId } },
        projectId,
      ),
    ).toThrow(/different Project/u);
    expect(() =>
      mapTaskCreateOptions(
        {
          ...envelope,
          data: {
            ...envelope.data,
            assignees: [...envelope.data.assignees, ...envelope.data.assignees],
          },
        },
        projectId,
      ),
    ).toThrow(/duplicate assignees/u);
  });

  it('canonicalizes user-entered values without putting Project or Workspace scope in the body', () => {
    expect(canonicalizeTaskCreateInput(input)).toEqual(request);
    expect(canonicalizeTaskCreateInput({
      ...input,
      description: '   ',
      milestoneId: '',
      primaryAssigneeUserId: ' ',
      sourceScopeMode: 'Inherit',
      taskOverridePolicy: { webEnabled: true, projectFilesEnabled: true },
    })).toEqual({
      title: 'Evidence review',
      priority: 2,
      startDate: '2026-08-24',
      dueDate: '2026-08-28',
      goal: 'Review evidence',
      deliverable: 'Decision note',
      constraints: 'No raw source persistence',
      sourceScopeMode: 'Inherit',
    });
  });

  it('accepts a strict 201 replay whose mutable Task values are now authoritative', () => {
    expect(mapTaskCreateSuccess(201, successEnvelope, projectId, workspaceId)).toEqual({
      requestId: 'task-create-201',
      data: successEnvelope.data,
      warnings: [],
    });

    const replay = {
      ...successEnvelope,
      data: {
        ...successEnvelope.data,
        milestoneId: null,
        primaryAssigneeUserId: null,
        title: 'Edited after the original create',
        priority: 3,
        version: 4,
        sourceScopeMode: 'Inherit',
        taskOverridePolicy: null,
      },
    };
    expect(mapTaskCreateSuccess(201, replay, projectId, workspaceId)).toEqual({
      requestId: 'task-create-201',
      data: replay.data,
      warnings: [],
    });
  });

  it('still rejects a non-201, cross-scope response, or an internally inconsistent source policy', () => {
    expect(() => mapTaskCreateSuccess(200, successEnvelope, projectId, workspaceId)).toThrow(
      /HTTP 201/u,
    );
    expect(() =>
      mapTaskCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, projectId: workspaceId } },
        projectId,
        workspaceId,
      ),
    ).toThrow(/different scope/u);
    expect(() =>
      mapTaskCreateSuccess(
        201,
        {
          ...successEnvelope,
          data: { ...successEnvelope.data, sourceScopeMode: 'Inherit' },
        },
        projectId,
        workspaceId,
      ),
    ).toThrow(/inconsistent/u);
    expect(() =>
      mapTaskCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, priority: 4 } },
        projectId,
        workspaceId,
      ),
    ).toThrow(/supported enum/u);
    expect(() =>
      mapTaskCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, status: 6 } },
        projectId,
        workspaceId,
      ),
    ).toThrow(/supported enum/u);
  });
});
