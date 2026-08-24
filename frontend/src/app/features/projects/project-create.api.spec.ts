import {
  canonicalizeProjectCreateInput,
  mapCreatedProjectConfirmation,
  mapProjectCreateOptions,
  mapProjectCreateSuccess,
  PROJECT_VISIBILITY_MEMBERS_ONLY,
  PROJECT_VISIBILITY_RESTRICTED,
  PROJECT_VISIBILITY_WORKSPACE_VISIBLE,
  ProjectCreateRequestDto,
} from './project-create.api';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const ownerUserId = '33333333-3333-4333-8333-333333333333';
const groupId = '44444444-4444-4444-8444-444444444444';

const request: ProjectCreateRequestDto = {
  title: 'Evidence review',
  description: 'Collect and review the supporting evidence.',
  groupId,
  visibility: PROJECT_VISIBILITY_MEMBERS_ONLY,
  startDate: '2026-08-24',
  endDate: '2026-08-28',
};

const successEnvelope = {
  requestId: 'request-project-create',
  data: {
    id: projectId,
    workspaceId,
    groupId,
    ownerUserId,
    title: request.title,
    description: request.description,
    status: 0,
    visibility: PROJECT_VISIBILITY_MEMBERS_ONLY,
    activationState: 1,
    startDate: request.startDate,
    endDate: request.endDate,
    versionNo: 1,
    createdAt: '2026-08-24T01:02:03Z',
  },
  warnings: [],
};

describe('Project create API contract mapping', () => {
  it('maps only server-owned create options for the expected Workspace', () => {
    expect(
      mapProjectCreateOptions(
        {
          requestId: 'request-options',
          data: {
            workspaceId,
            canCreateUngrouped: true,
            allowedVisibilities: [
              PROJECT_VISIBILITY_MEMBERS_ONLY,
              PROJECT_VISIBILITY_WORKSPACE_VISIBLE,
              PROJECT_VISIBILITY_RESTRICTED,
            ],
            groups: [{ id: groupId, name: 'Research Group' }],
          },
          warnings: [],
        },
        workspaceId,
      ),
    ).toEqual({
      requestId: 'request-options',
      workspaceId,
      canCreateUngrouped: true,
      allowedVisibilities: [
        PROJECT_VISIBILITY_MEMBERS_ONLY,
        PROJECT_VISIBILITY_WORKSPACE_VISIBLE,
        PROJECT_VISIBILITY_RESTRICTED,
      ],
      groups: [{ id: groupId, name: 'Research Group' }],
    });
  });

  it('fails closed for mismatched scope, duplicate Groups, or an invalid visibility set', () => {
    const base = {
      requestId: 'request-options',
      data: {
        workspaceId,
        canCreateUngrouped: true,
        allowedVisibilities: [PROJECT_VISIBILITY_MEMBERS_ONLY],
        groups: [{ id: groupId, name: 'Research Group' }],
      },
      warnings: [],
    };

    expect(() =>
      mapProjectCreateOptions(
        { ...base, data: { ...base.data, workspaceId: projectId } },
        workspaceId,
      ),
    ).toThrow(/different Workspace/u);
    expect(() =>
      mapProjectCreateOptions(
        { ...base, data: { ...base.data, groups: [...base.data.groups, ...base.data.groups] } },
        workspaceId,
      ),
    ).toThrow(/duplicate Groups/u);
    expect(() =>
      mapProjectCreateOptions(
        {
          ...base,
          data: { ...base.data, allowedVisibilities: [PROJECT_VISIBILITY_RESTRICTED] },
        },
        workspaceId,
      ),
    ).toThrow(/inconsistent visibility grant/u);
  });

  it('accepts an authoritative no-create result only with no visibility or Group grants', () => {
    expect(
      mapProjectCreateOptions(
        {
          requestId: 'request-options-denied',
          data: {
            workspaceId,
            canCreateUngrouped: false,
            allowedVisibilities: [],
            groups: [],
          },
          warnings: [],
        },
        workspaceId,
      ),
    ).toMatchObject({
      canCreateUngrouped: false,
      allowedVisibilities: [],
      groups: [],
    });

    expect(() =>
      mapProjectCreateOptions(
        {
          requestId: 'request-options-inconsistent',
          data: {
            workspaceId,
            canCreateUngrouped: false,
            allowedVisibilities: [PROJECT_VISIBILITY_MEMBERS_ONLY],
            groups: [],
          },
          warnings: [],
        },
        workspaceId,
      ),
    ).toThrow(/inconsistent visibility grant/u);
  });

  it('canonicalizes whitespace without putting Workspace scope into the body', () => {
    const canonical = canonicalizeProjectCreateInput({
      title: '  Evidence review  ',
      description: '   ',
      groupId: ` ${groupId} `,
      visibility: PROJECT_VISIBILITY_MEMBERS_ONLY,
      startDate: ' 2026-08-24 ',
      endDate: '',
    });

    expect(canonical).toEqual({
      title: 'Evidence review',
      description: null,
      groupId,
      visibility: PROJECT_VISIBILITY_MEMBERS_ONLY,
      startDate: '2026-08-24',
      endDate: null,
    });
    expect(canonical).not.toHaveProperty('workspaceId');
    expect(canonical).not.toHaveProperty('members');
  });

  it('accepts only a strict Planning and NeverActivated HTTP 201 matching the request', () => {
    expect(mapProjectCreateSuccess(201, successEnvelope, workspaceId, request)).toEqual({
      requestId: 'request-project-create',
      data: successEnvelope.data,
      warnings: [],
    });

    expect(() => mapProjectCreateSuccess(200, successEnvelope, workspaceId, request)).toThrow(
      /HTTP 201/u,
    );
    expect(() =>
      mapProjectCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, workspaceId: projectId } },
        workspaceId,
        request,
      ),
    ).toThrow(/different Workspace/u);
    expect(() =>
      mapProjectCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, status: 1 } },
        workspaceId,
        request,
      ),
    ).toThrow(/Planning/u);
    expect(() =>
      mapProjectCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, activationState: 2 } },
        workspaceId,
        request,
      ),
    ).toThrow(/NeverActivated/u);
    expect(() =>
      mapProjectCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, versionNo: 0 } },
        workspaceId,
        request,
      ),
    ).toThrow(/positive integer/u);
  });

  it('rejects response Group, visibility, values, and dates that differ from the request', () => {
    expect(() =>
      mapProjectCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, groupId: null } },
        workspaceId,
        request,
      ),
    ).toThrow(/Group/u);
    expect(() =>
      mapProjectCreateSuccess(
        201,
        {
          ...successEnvelope,
          data: { ...successEnvelope.data, visibility: PROJECT_VISIBILITY_RESTRICTED },
        },
        workspaceId,
        request,
      ),
    ).toThrow(/visibility/u);
    expect(() =>
      mapProjectCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, title: 'Other title' } },
        workspaceId,
        request,
      ),
    ).toThrow(/title/u);
    expect(() =>
      mapProjectCreateSuccess(
        201,
        { ...successEnvelope, data: { ...successEnvelope.data, endDate: '2026-08-29' } },
        workspaceId,
        request,
      ),
    ).toThrow(/dates/u);
  });

  it('confirms only the created Project in its authoritative Draft or activated state', () => {
    expect(
      mapCreatedProjectConfirmation(
        { id: projectId, workspaceId, status: 0, activationState: 1 },
        projectId,
        workspaceId,
      ),
    ).toEqual({ id: projectId, workspaceId, status: 0, activationState: 1 });
    expect(
      mapCreatedProjectConfirmation(
        { id: projectId, workspaceId, status: 1, activationState: 2 },
        projectId,
        workspaceId,
      ),
    ).toEqual({ id: projectId, workspaceId, status: 1, activationState: 2 });

    expect(() =>
      mapCreatedProjectConfirmation(
        { id: projectId, workspaceId, status: 1, activationState: 1 },
        projectId,
        workspaceId,
      ),
    ).toThrow(/Draft or activated/u);
    expect(() =>
      mapCreatedProjectConfirmation(
        { id: projectId, workspaceId: ownerUserId, status: 0, activationState: 1 },
        projectId,
        workspaceId,
      ),
    ).toThrow(/different scope/u);
  });
});
