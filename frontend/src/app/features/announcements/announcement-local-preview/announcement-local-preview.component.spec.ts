import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnnouncementLocalPreviewComponent } from './announcement-local-preview.component';

describe('AnnouncementLocalPreviewComponent', () => {
  let fixture: ComponentFixture<AnnouncementLocalPreviewComponent>;
  let component: AnnouncementLocalPreviewComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnnouncementLocalPreviewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AnnouncementLocalPreviewComponent);
    component = fixture.componentInstance;
    component.preview = {
      title: 'Application notice',
      body: 'Review the application details.',
      priority: 'important',
      audience: {
        key: 'workspace:school',
        scope: 'workspace',
        displayName: 'School Workspace',
        recipientCount: 1248,
      },
      requiresReadConfirmation: true,
      cta: { label: 'Open application', url: '/forms/application' },
      attachment: { label: 'Guide PDF', url: 'https://example.jp/guide.pdf' },
    };
    fixture.detectChanges();
  });

  it('renders title, body, priority metadata, CTA, and attachment without actionable links', () => {
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="announcement-preview-title"]')?.textContent).toContain(
      'Application notice',
    );
    expect(host.querySelector('[data-testid="announcement-preview-body"]')?.textContent).toContain(
      'Review the application details.',
    );
    expect(host.querySelector('[data-testid="announcement-preview-attachment-state"]')?.textContent).toContain(
      'Present',
    );

    const cta = host.querySelector('[data-testid="announcement-preview-content-cta-inert"]');
    const attachment = host.querySelector('[data-testid="announcement-preview-attachment"] [role="link"]');
    expect(cta?.textContent).toContain('Open application');
    expect(cta?.getAttribute('aria-disabled')).toBe('true');
    expect(cta?.getAttribute('href')).toBeNull();
    expect(attachment?.textContent).toContain('Guide PDF');
    expect(attachment?.getAttribute('aria-disabled')).toBe('true');
    expect(attachment?.getAttribute('href')).toBeNull();
  });

  it('switches to a bounded mobile preview without publishing or navigating', () => {
    const host = fixture.nativeElement as HTMLElement;
    const mobileButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="announcement-preview-mobile"]',
    );

    mobileButton?.click();
    fixture.detectChanges();

    expect(component.viewport()).toBe('mobile');
    expect(host.querySelector('.announcement-local-preview')?.classList).toContain(
      'announcement-local-preview--mobile',
    );
    expect(mobileButton?.getAttribute('aria-pressed')).toBe('true');
  });
});
