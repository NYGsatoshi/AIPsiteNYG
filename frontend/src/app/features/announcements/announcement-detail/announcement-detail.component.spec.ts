import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DEFAULT_ANNOUNCEMENTS } from '../announcements.mock';
import { AnnouncementViewModel } from '../announcements.types';
import { AnnouncementDetailComponent } from './announcement-detail.component';

const renderDetail = async (
  announcement: AnnouncementViewModel | null,
): Promise<ComponentFixture<AnnouncementDetailComponent>> => {
  await TestBed.configureTestingModule({ imports: [AnnouncementDetailComponent] }).compileComponents();
  const fixture = TestBed.createComponent(AnnouncementDetailComponent);
  fixture.componentRef.setInput('announcement', announcement);
  fixture.detectChanges();
  return fixture;
};

describe('AnnouncementDetailComponent', () => {
  const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');

  afterEach(() => {
    if (originalMatchMediaDescriptor) {
      Object.defineProperty(window, 'matchMedia', originalMatchMediaDescriptor);
    } else {
      Reflect.deleteProperty(window, 'matchMedia');
    }
    TestBed.resetTestingModule();
  });

  it('places priority, title, published/expiry facts, audience, and the read action before a long body', async () => {
    const fixture = await renderDetail({
      ...DEFAULT_ANNOUNCEMENTS[0],
      body: 'Long recipient-facing body. '.repeat(80),
    });
    const root = fixture.nativeElement as HTMLElement;
    const priority = root.querySelector('[data-testid="announcement-priority-label"]');
    const title = root.querySelector('[data-testid="announcement-detail-title"]');
    const published = root.querySelector('[data-testid="announcement-published-at"]');
    const expiry = root.querySelector('[data-testid="announcement-expires-at"]');
    const audience = root.querySelector('[data-testid="announcement-audience-label"]');
    const action = root.querySelector('[data-testid="announcement-mark-read-action"]');
    const body = root.querySelector('[data-testid="announcement-body-text"]');

    expect(priority?.compareDocumentPosition(title!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(title?.compareDocumentPosition(published!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(published?.compareDocumentPosition(expiry!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(expiry?.compareDocumentPosition(audience!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(action?.compareDocumentPosition(body!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(root.querySelector('app-message-composer')).toBeNull();
    expect((action as HTMLButtonElement | null)?.disabled).toBe(false);
  });

  it('disables an in-flight read action and moves focus to the stable confirmed status after server confirmation', async () => {
    const announcement = { ...DEFAULT_ANNOUNCEMENTS[0] };
    const fixture = await renderDetail(announcement);
    const root = fixture.nativeElement as HTMLElement;
    const action = root.querySelector<HTMLButtonElement>('[data-testid="announcement-mark-read-action"]');
    let requestedId: string | undefined;
    fixture.componentInstance.markReadRequested.subscribe((id) => {
      requestedId = id;
    });

    action?.click();
    fixture.componentRef.setInput('announcement', {
      ...announcement,
      readState: {
        ...announcement.readState,
        isMarkingRead: true,
      },
    });
    fixture.detectChanges();

    expect(requestedId).toBe(announcement.id);
    expect(root.querySelector<HTMLButtonElement>('[data-testid="announcement-mark-read-action"]')?.disabled).toBe(true);

    fixture.componentRef.setInput('announcement', {
      ...announcement,
      readState: {
        ...announcement.readState,
        isRead: true,
        isMarkingRead: false,
      },
    });
    fixture.detectChanges();
    await Promise.resolve();

    expect(root.querySelector('[data-testid="announcement-mark-read-action"]')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-testid="announcement-read-status"]'));
  });

  it('refocuses the title when an authorized direct detail arrives after the empty mobile state', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query === '(max-width: 860px)' }) as MediaQueryList,
    });
    const fixture = await renderDetail(null);
    fixture.componentRef.setInput('mobileFocusRequest', 1);
    fixture.detectChanges();
    await Promise.resolve();

    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="announcement-detail-empty"] h2'),
    );

    fixture.componentRef.setInput('announcement', DEFAULT_ANNOUNCEMENTS[0]);
    fixture.detectChanges();
    await Promise.resolve();

    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="announcement-detail-title"]'),
    );
  });
});
