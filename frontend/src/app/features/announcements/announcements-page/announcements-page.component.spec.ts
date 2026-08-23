import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AIP_ANNOUNCEMENTS_PAGE_MOCK } from '../announcements.facade';
import {
  ANNOUNCEMENT_PAGE_SCENARIOS,
  DEFAULT_ANNOUNCEMENTS,
  HIDDEN_ANNOUNCEMENT_BODY,
  HIDDEN_ANNOUNCEMENT_TITLE
} from '../announcements.mock';
import { AnnouncementsPageViewModel } from '../announcements.types';
import { AnnouncementsPageComponent } from './announcements-page.component';

const renderAnnouncementsPage = async (
  page: AnnouncementsPageViewModel
): Promise<ComponentFixture<AnnouncementsPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [AnnouncementsPageComponent],
    providers: [provideRouter([]), { provide: AIP_ANNOUNCEMENTS_PAGE_MOCK, useValue: page }]
  }).compileComponents();

  const fixture = TestBed.createComponent(AnnouncementsPageComponent);
  fixture.detectChanges();
  return fixture;
};

const textContent = (fixture: ComponentFixture<AnnouncementsPageComponent>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

describe('AnnouncementsPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('hides create button without capability', async () => {
    const fixture = await renderAnnouncementsPage(ANNOUNCEMENT_PAGE_SCENARIOS.noCreatePermission);

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="create-announcement-action"]')).toBeNull();
  });

  it('does not show hidden announcement title or body in denied state', async () => {
    const fixture = await renderAnnouncementsPage({
      ...ANNOUNCEMENT_PAGE_SCENARIOS.permissionDenied,
      announcements: [
        {
          ...DEFAULT_ANNOUNCEMENTS[0],
          id: 'hidden-announcement',
          title: HIDDEN_ANNOUNCEMENT_TITLE,
          body: HIDDEN_ANNOUNCEMENT_BODY,
          capabilities: []
        }
      ]
    });

    const text = textContent(fixture);
    expect(text).toContain('このお知らせを表示する権限がありません。');
    expect(text).not.toContain(HIDDEN_ANNOUNCEMENT_TITLE);
    expect(text).not.toContain(HIDDEN_ANNOUNCEMENT_BODY);
  });

  it('renders body as text instead of unsafe html', async () => {
    const fixture = await renderAnnouncementsPage(ANNOUNCEMENT_PAGE_SCENARIOS.unsafeBody);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="announcement-body-text"]')?.textContent).toContain('<img src=x');
    expect(root.querySelector('[data-testid="announcement-body-text"] img')).toBeNull();
  });

  it('filters only already provided authorized announcements with page-local search', async () => {
    const fixture = await renderAnnouncementsPage({
      ...ANNOUNCEMENT_PAGE_SCENARIOS.default,
      announcements: [
        DEFAULT_ANNOUNCEMENTS[0],
        {
          ...DEFAULT_ANNOUNCEMENTS[1],
          title: '検索で表示されるお知らせ'
        },
        {
          ...DEFAULT_ANNOUNCEMENTS[2],
          title: '権限なしの検索対象',
          body: 'この本文は検索しても表示されません。',
          capabilities: []
        }
      ]
    });

    fixture.componentInstance.updateSearch('検索');
    fixture.detectChanges();

    const text = textContent(fixture);
    expect(text).toContain('検索で表示されるお知らせ');
    expect(text).not.toContain('権限なしの検索対象');
    expect(text).not.toContain('この本文は検索しても表示されません。');
  });

  it('renders the accessible priority label from frontend semantics', async () => {
    const fixture = await renderAnnouncementsPage(ANNOUNCEMENT_PAGE_SCENARIOS.default);
    const priority = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="announcement-priority-label"]'
    );

    expect(priority?.textContent).toContain('IMPORTANT');
  });

  it('wraps long title and body safely', async () => {
    const fixture = await renderAnnouncementsPage(ANNOUNCEMENT_PAGE_SCENARIOS.longBody);
    const title = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="announcement-detail-title"]');
    const body = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="announcement-body-text"]');

    expect(title?.textContent).toContain('とても長いタイトル');
    expect(body?.textContent?.length).toBeGreaterThan(300);
    expect(getComputedStyle(title as HTMLElement).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(body as HTMLElement).overflowWrap).toBe('anywhere');
  });

  it('does not expose hidden actions in mobile layout', async () => {
    const fixture = await renderAnnouncementsPage(ANNOUNCEMENT_PAGE_SCENARIOS.noCreatePermission);

    (fixture.nativeElement as HTMLElement).style.width = '320px';
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="create-announcement-action"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="edit-announcement-action"]')).toBeNull();
  });

  it('shows the reactive editor when create is allowed', async () => {
    const fixture = await renderAnnouncementsPage(ANNOUNCEMENT_PAGE_SCENARIOS.default);

    fixture.componentInstance.showCreateEditor();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="announcement-editor"]')).not.toBeNull();
  });
});
