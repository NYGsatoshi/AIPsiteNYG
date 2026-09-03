import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import type { Observable } from 'rxjs';

import { AnnouncementEngagementClient } from '../announcement-engagement.client';
import type { AnnouncementAnalyticsViewModel } from '../announcement-engagement.client';
import { AnnouncementAnalyticsPanelComponent } from './announcement-analytics-panel.component';

const ANALYTICS: AnnouncementAnalyticsViewModel = {
  announcementId: 'announcement-390',
  recipientCount: 10,
  readCount: 7,
  readRate: 0.7,
  acknowledgedCount: 5,
  acknowledgementRate: 0.5,
  ctaClickCount: 3,
  ctaClickThroughRate: 0.3,
  periodStartLabel: '2026/9/3 10:00:00',
  periodEndLabel: '2026/9/3 17:00:00',
  denominatorKind: 'frozenDeliveryCohort',
  ctaMetric: 'clickThrough',
  medianTimeToRecognitionSeconds: 900,
};

const renderPanel = async (
  analytics: () => Observable<AnnouncementAnalyticsViewModel>,
  announcementId: string,
): Promise<ComponentFixture<AnnouncementAnalyticsPanelComponent>> => {
  await TestBed.configureTestingModule({
    imports: [AnnouncementAnalyticsPanelComponent],
    providers: [
      {
        provide: AnnouncementEngagementClient,
        useValue: { analytics },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AnnouncementAnalyticsPanelComponent);
  fixture.componentRef.setInput('announcementId', announcementId);
  fixture.detectChanges();
  return fixture;
};

describe('AnnouncementAnalyticsPanelComponent', () => {
  it('renders aggregate rates, denominator, period, and no recipient identities', async () => {
    const fixture = await renderPanel(() => of(ANALYTICS), ANALYTICS.announcementId);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="announcement-analytics"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="announcement-analytics-read"]')?.textContent).toContain('70%');
    expect(root.querySelector('[data-testid="announcement-analytics-acknowledgement"]')?.textContent).toContain('50%');
    expect(root.querySelector('[data-testid="announcement-analytics-cta"]')?.textContent).toContain('30%');
    expect(root.querySelector('[data-testid="announcement-analytics-denominator"]')?.textContent).toContain('delivery cohort');
    expect(root.querySelector('[data-testid="announcement-analytics-period"]')?.textContent).toContain('2026/9/3');
    expect(root.textContent).not.toContain('student@example.jp');
    expect(root.textContent).not.toContain('Recipient Name');
  });

  it('fails closed when aggregate analytics are not authorized', async () => {
    const fixture = await renderPanel(
      () => throwError(() => new Error('denied')),
      'announcement-denied',
    );

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="announcement-analytics"]')).toBeNull();
  });
});
