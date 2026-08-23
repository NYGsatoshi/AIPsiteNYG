import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnnouncementEditorDraft, AnnouncementEditorSubmission } from '../announcements.types';
import { AnnouncementEditorComponent } from './announcement-editor.component';

const workspaceAudience = {
  key: 'workspace:11111111-1111-1111-1111-111111111111',
  scope: 'workspace' as const,
  displayName: 'School Workspace',
  recipientCount: 1248,
  workspaceId: '11111111-1111-1111-1111-111111111111',
};

const teacherGroupAudience = {
  key: 'group:22222222-2222-2222-2222-222222222222',
  scope: 'group' as const,
  displayName: 'School Workspace / Teachers',
  recipientCount: 86,
  workspaceId: '11111111-1111-1111-1111-111111111111',
  groupId: '22222222-2222-2222-2222-222222222222',
};

const createDraft = (overrides: Partial<AnnouncementEditorDraft> = {}): AnnouncementEditorDraft => ({
  title: 'School update',
  body: 'Announcement body',
  priority: 'normal',
  audienceKey: workspaceAudience.key,
  availableAudiences: [workspaceAudience, teacherGroupAudience],
  requiresReadConfirmation: false,
  ...overrides,
});

const renderEditor = async (draft: AnnouncementEditorDraft): Promise<ComponentFixture<AnnouncementEditorComponent>> => {
  await TestBed.configureTestingModule({
    imports: [AnnouncementEditorComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(AnnouncementEditorComponent);
  fixture.componentRef.setInput('draft', draft);
  fixture.detectChanges();
  return fixture;
};

describe('AnnouncementEditorComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders only authorized audience options and falls back from an unauthorized draft audience', async () => {
    const fixture = await renderEditor(
      createDraft({
        audienceKey: 'group:unauthorized',
        availableAudiences: [teacherGroupAudience],
      }),
    );

    const host = fixture.nativeElement as HTMLElement;
    const select = host.querySelector('[data-testid="announcement-editor-audience"]') as HTMLSelectElement;
    const options = Array.from(select.options);

    expect(options).toHaveLength(1);
    expect(options.map((option) => option.value)).toEqual([teacherGroupAudience.key]);
    expect(options.map((option) => option.textContent?.trim())).toEqual(['School Workspace / Teachers — 86名']);
    expect(select.value).toBe(teacherGroupAudience.key);
    expect(host.querySelector('[data-testid="announcement-audience-summary"]')?.textContent).toContain('School Workspace / Teachers');
    expect(host.querySelector('[data-testid="announcement-audience-summary"]')?.textContent).toContain('86名');
  });

  it('fails closed when no authorized audience is available', async () => {
    const fixture = await renderEditor(
      createDraft({
        audienceKey: '',
        availableAudiences: [],
      }),
    );

    const host = fixture.nativeElement as HTMLElement;
    const select = host.querySelector('[data-testid="announcement-editor-audience"]') as HTMLSelectElement;
    const publish = host.querySelector('[data-testid="announcement-publish-action"]') as HTMLButtonElement;

    expect(select.options).toHaveLength(0);
    expect(select.value).toBe('');
    expect(fixture.componentInstance.form.controls.audienceKey.invalid).toBe(true);
    expect(fixture.componentInstance.selectedAudience()).toBeNull();
    expect(host.querySelector('[data-testid="announcement-audience-unavailable"]')).toBeTruthy();
    expect(publish.disabled).toBe(true);
  });

  it('updates both immediate and review summaries when the selected audience changes', async () => {
    const fixture = await renderEditor(createDraft());

    fixture.componentInstance.form.controls.audienceKey.setValue(teacherGroupAudience.key);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const immediateSummary = host.querySelector('[data-testid="announcement-audience-summary"]')?.textContent ?? '';
    const reviewSummary = host.querySelector('[data-testid="announcement-review-summary"]')?.textContent ?? '';

    expect(immediateSummary).toContain('School Workspace / Teachers');
    expect(immediateSummary).toContain('86名');
    expect(reviewSummary).toContain('School Workspace / Teachers');
    expect(reviewSummary).toContain('86名');
  });

  it('emits the exact authorized audience object when publishing', async () => {
    const fixture = await renderEditor(createDraft());
    let emitted: AnnouncementEditorSubmission | undefined;
    fixture.componentInstance.publishRequested.subscribe((value) => {
      emitted = value;
    });

    fixture.componentInstance.form.patchValue({
      title: '  Safety update  ',
      body: '  Review this announcement  ',
      audienceKey: teacherGroupAudience.key,
      priority: 'important',
      requiresReadConfirmation: true,
    });
    fixture.componentInstance.publish();

    expect(emitted).toEqual({
      title: 'Safety update',
      body: 'Review this announcement',
      priority: 'important',
      audience: teacherGroupAudience,
      requiresReadConfirmation: true,
    });
  });

  it('uses the non-leaking count fallback when the authorized projection has no recipient estimate', async () => {
    const fixture = await renderEditor(
      createDraft({
        audienceKey: 'global',
        availableAudiences: [{ key: 'global', scope: 'global', displayName: 'Tenant-wide' }],
      }),
    );

    const host = fixture.nativeElement as HTMLElement;
    const immediateSummary = host.querySelector('[data-testid="announcement-audience-summary"]')?.textContent ?? '';
    const reviewSummary = host.querySelector('[data-testid="announcement-review-summary"]')?.textContent ?? '';

    expect(immediateSummary).toContain('受信者数は公開前の確認時に再計算されます。');
    expect(reviewSummary).toContain('未取得');
  });
});
