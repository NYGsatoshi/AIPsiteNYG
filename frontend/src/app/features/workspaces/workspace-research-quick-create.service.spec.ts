import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import {
  WorkspaceResearchQuickCreateService,
  mapCreatedProjectId,
} from './workspace-research-quick-create.service';

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
      service.createResearch('workspace-1', '  Research Alpha  ', 'workspace-research-request-001'),
    );

    const request = http.expectOne('/api/workspaces/workspace-1/projects');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ title: 'Research Alpha' });
    expect(request.request.headers.get('Idempotency-Key')).toBe('workspace-research-request-001');
    request.flush({
      requestId: 'request-1',
      data: { id: 'project-1', title: 'Research Alpha' },
      warnings: [],
    });

    await expect(result).resolves.toBe('project-1');
  });

  it('fails closed when a successful response omits the created Project id', () => {
    expect(() => mapCreatedProjectId({ data: { title: 'Missing id' } })).toThrow(
      'Project create response is missing an id.',
    );
  });
});
