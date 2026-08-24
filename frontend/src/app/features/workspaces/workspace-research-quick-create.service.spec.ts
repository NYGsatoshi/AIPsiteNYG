import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import {
  QuickResearchCreateResponseError,
  WorkspaceResearchQuickCreateService,
  mapCreatedProjectId,
} from './workspace-research-quick-create.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';

const projectCreateEnvelope = {
  requestId: 'request-1',
  data: {
    id: projectId,
    workspaceId,
    groupId: null,
    ownerUserId: '33333333-3333-4333-8333-333333333333',
    title: 'Research Alpha',
    description: null,
    status: 0,
    visibility: 1,
    activationState: 1,
    startDate: null,
    endDate: null,
    versionNo: 1,
    createdAt: '2026-08-24T00:00:00Z',
  },
  warnings: [],
};

describe('WorkspaceResearchQuickCreateService', () => {
  let service: WorkspaceResearchQuickCreateService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkspaceResearchQuickCreateService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('uses the canonical Workspace-scoped Project create endpoint and caller-owned idempotency key', async () => {
    const result = firstValueFrom(
      service.createResearch(workspaceId, '  Research Alpha  ', 'workspace-research-request-001'),
    );

    const request = http.expectOne(`/api/workspaces/${workspaceId}/projects`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ title: 'Research Alpha' });
    expect(request.request.headers.get('Idempotency-Key')).toBe('workspace-research-request-001');
    expect(request.request.withCredentials).toBe(true);
    request.flush(projectCreateEnvelope, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toBe(projectId);
  });

  it('fails closed when a successful response omits the created Project id', () => {
    expect(() =>
      mapCreatedProjectId(
        201,
        { ...projectCreateEnvelope, data: { ...projectCreateEnvelope.data, id: undefined } },
        workspaceId,
      ),
    ).toThrow('Project create response data.id must be a UUID.');
  });

  it('rejects a non-201 response even when its body looks canonical', () => {
    expect(() => mapCreatedProjectId(200, projectCreateEnvelope, workspaceId)).toThrow(
      QuickResearchCreateResponseError,
    );
  });

  it('rejects a response for a different Workspace or non-Quick-Create defaults', () => {
    expect(() =>
      mapCreatedProjectId(
        201,
        {
          ...projectCreateEnvelope,
          data: {
            ...projectCreateEnvelope.data,
            workspaceId: '44444444-4444-4444-8444-444444444444',
          },
        },
        workspaceId,
      ),
    ).toThrow('Project create response belongs to a different Workspace.');

    expect(() =>
      mapCreatedProjectId(
        201,
        {
          ...projectCreateEnvelope,
          data: { ...projectCreateEnvelope.data, visibility: 0 },
        },
        workspaceId,
      ),
    ).toThrow('Quick create response data.visibility must be MembersOnly.');
  });
});
