import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';

import { WorkspacesFacade } from '../workspaces.facade';
import { OWNER_WORKSPACE, READ_ONLY_WORKSPACE } from '../workspaces.mock';
import { WorkspaceResearchQuickCreateService } from '../workspace-research-quick-create.service';
import { WorkspaceResearchQuickCreatePageComponent } from './workspace-research-quick-create-page.component';

const renderPage = async (
  workspace = OWNER_WORKSPACE,
  createResearch = vi.fn(() => of('project-created')),
): Promise<{
  readonly fixture: ComponentFixture<WorkspaceResearchQuickCreatePageComponent>;
  readonly createResearch: ReturnType<typeof vi.fn>;
  readonly router: Router;
}> => {
  await TestBed.configureTestingModule({
    imports: [WorkspaceResearchQuickCreatePageComponent],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ workspaceId: workspace.id }) } },
      },
      {
        provide: WorkspacesFacade,
        useValue: {
          dashboard: signal({
            status: 'ready',
            title: 'Workspace',
            subtitle: 'Workspace',
            workspaces: [workspace],
            pageCapabilities: [],
          }),
        },
      },
      { provide: WorkspaceResearchQuickCreateService, useValue: { createResearch } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(WorkspaceResearchQuickCreatePageComponent);
  fixture.detectChanges();
  return { fixture, createResearch, router: TestBed.inject(Router) };
};

describe('WorkspaceResearchQuickCreatePageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('fails closed before rendering the form when Project creation is not authorized', async () => {
    const { fixture, createResearch } = await renderPage(READ_ONLY_WORKSPACE);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="quick-create-permission-denied"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="quick-create-research-title"]')).toBeNull();
    expect(element.querySelector('[data-testid="quick-create-submit"]')).toBeNull();
    expect(createResearch).not.toHaveBeenCalled();
  });

  it('prevents duplicate submission while the same create request is in flight', async () => {
    const response = new Subject<string>();
    const createResearch = vi.fn(() => response.asObservable());
    const { fixture, router } = await renderPage(OWNER_WORKSPACE, createResearch);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture.componentInstance.updateTitle('Research Alpha');
    fixture.componentInstance.submit();
    fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(createResearch).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.submitting()).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '[data-testid="quick-create-submit"]',
      )?.disabled,
    ).toBe(true);

    response.next('project-created');
    response.complete();
    await fixture.whenStable();
  });

  it('reuses the same idempotency identity when retrying an unchanged title', async () => {
    const createResearch = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('network unavailable')))
      .mockReturnValueOnce(of('project-created'));
    const { fixture, router } = await renderPage(OWNER_WORKSPACE, createResearch);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture.componentInstance.updateTitle('Research Retry');
    fixture.componentInstance.submit();
    fixture.componentInstance.submit();

    expect(createResearch).toHaveBeenCalledTimes(2);
    const firstKey = createResearch.mock.calls[0]?.[2];
    const secondKey = createResearch.mock.calls[1]?.[2];
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
    expect(navigate).toHaveBeenCalledWith(['/projects', 'project-created']);
  });

  it('requires a non-empty title before issuing the mutation', async () => {
    const { fixture, createResearch } = await renderPage();

    fixture.componentInstance.updateTitle('   ');
    fixture.componentInstance.submit();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(createResearch).not.toHaveBeenCalled();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="quick-create-research-title"]',
    );
    const error = element.querySelector('[data-testid="quick-create-title-error"]');
    expect(error?.textContent?.trim()).toBe('リサーチ名を入力してください。');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toBe('research-title-error');
    expect(document.activeElement).toBe(input);
  });

  it.each([
    ['a false result', () => Promise.resolve(false)],
    ['a rejected navigation', () => Promise.reject(new Error('route unavailable'))],
  ])(
    'uses navigation-only recovery after a committed create returns %s',
    async (_label, result) => {
      const createResearch = vi.fn(() => of('project-created'));
      const { fixture, router } = await renderPage(OWNER_WORKSPACE, createResearch);
      const navigate = vi
        .spyOn(router, 'navigate')
        .mockImplementationOnce(result)
        .mockResolvedValueOnce(true);

      fixture.componentInstance.updateTitle('Research Committed');
      fixture.componentInstance.submit();
      await vi.waitFor(() => expect(fixture.componentInstance.navigating()).toBe(false));
      fixture.detectChanges();

      expect(createResearch).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.createdProjectId()).toBe('project-created');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-testid="quick-create-error"]')
          ?.textContent,
      ).toContain('リサーチは作成済みです');

      fixture.componentInstance.submit();
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
      expect(createResearch).toHaveBeenCalledTimes(1);
    },
  );

  it('presents Research as the minimal Draft Project workflow', async () => {
    const { fixture } = await renderPage();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('リサーチはWorkspace内のProjectとして作成されます');
    expect(text).toContain('下書き');
    expect(text).not.toContain('Planning');
  });
});
