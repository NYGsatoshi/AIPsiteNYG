import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnnouncementEditorDraft } from '../announcements.types';
import { AnnouncementEditorComponent } from './announcement-editor.component';

const createDraft = (overrides: Partial<AnnouncementEditorDraft> = {}): AnnouncementEditorDraft => ({
  title: 'School update',
  body: 'Announcement body',
  priority: 'normal',
  audienceScope: 'allWorkspaceMembers',
  availableAudiences: [
    { scope: 'allWorkspaceMembers', displayName: 'All students', recipientCount: 1248 },
    { scope: 'teachersOnly', displayName: 'Teachers', recipientCount: 86 },
  ],
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
        audienceScope: 'guardiansOnly',
        availableAudiences: [
          { scope: 'teachersOnly', displayName: 'Teachers', recipientCount: 42 },
          { scope: 'adminOnly', displayName: 'Administrators', recipientCount: 5 },
        ],
      }),
    );

    const host = fixture.nativeElement as HTMLElement;
    const select = host.querySelector('[data-testid="announcement-editor-audience"]') as HTMLSelectElement;
    const options = Array.from(select.options);

    expect(options).toHaveLength(2);
    expect(options.map((option) => option.value)).toEqual(['teachersOnly', 'adminOnly']);
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Teachers — 42名', 'Administrators — 5名']);
    expect(select.value).toBe('teachersOnly');
    expect(host.querySelector('[data-testid="announcement-audience-summary"]')?.textContent).toContain('Teachers');
    expect(host.querySelector('[data-testid="announcement-audience-summary"]')?.textContent).toContain('42名');
  });

  it('updates both immediate and review summaries when the selected audience changes', async () => {
    const fixture = await renderEditor(createDraft());

    fixture.componentInstance.form.controls.audienceScope.setValue('teachersOnly');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const immediateSummary = host.querySelector('[data-testid="announcement-audience-summary"]')?.textContent ?? '';
    const reviewSummary = host.querySelector('[data-testid="announcement-review-summary"]')?.textContent ?? '';

    expect(immediateSummary).toContain('Teachers');
    expect(immediateSummary).toContain('86名');
    expect(reviewSummary).toContain('Teachers');
    expect(reviewSummary).toContain('86名');
  });

  it('uses the non-leaking count fallback when the authorized projection has no recipient estimate', async () => {
    const fixture = await renderEditor(
      createDraft({
        availableAudiences: [{ scope: 'allWorkspaceMembers', displayName: 'Workspace members' }],
      }),
    );

    const host = fixture.nativeElement as HTMLElement;
    const immediateSummary = host.querySelector('[data-testid="announcement-audience-summary"]')?.textContent ?? '';
    const reviewSummary = host.querySelector('[data-testid="announcement-review-summary"]')?.textContent ?? '';

    expect(immediateSummary).toContain('受信者数は公開前の確認時に再計算されます。');
    expect(reviewSummary).toContain('未取得');
  });
});
