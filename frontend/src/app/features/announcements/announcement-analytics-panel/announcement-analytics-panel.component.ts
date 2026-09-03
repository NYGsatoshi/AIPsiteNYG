import { Component, inject, Input, OnChanges, OnDestroy, SimpleChanges, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import {
  AnnouncementAnalyticsViewModel,
  AnnouncementEngagementClient,
} from '../announcement-engagement.client';

@Component({
  selector: 'app-announcement-analytics-panel',
  standalone: true,
  templateUrl: './announcement-analytics-panel.component.html',
  styleUrl: './announcement-analytics-panel.component.scss',
})
export class AnnouncementAnalyticsPanelComponent implements OnChanges, OnDestroy {
  private readonly engagement = inject(AnnouncementEngagementClient);
  private request: Subscription | null = null;

  @Input() announcementId: string | null = null;

  readonly analytics = signal<AnnouncementAnalyticsViewModel | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['announcementId'] === undefined) {
      return;
    }

    this.request?.unsubscribe();
    this.request = null;
    this.analytics.set(null);
    const announcementId = this.announcementId;
    if (announcementId === null || announcementId.length === 0) {
      return;
    }

    this.request = this.engagement.analytics(announcementId).subscribe({
      next: (analytics) => this.analytics.set(analytics),
      // Authorization denial and unavailable analytics intentionally render no
      // panel. Do not surface backend detail or turn absence into a capability
      // oracle for ordinary recipients.
      error: () => this.analytics.set(null),
    });
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
  }

  percentage(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  duration(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}秒`;
    }
    if (seconds < 3600) {
      return `${Math.round(seconds / 60)}分`;
    }
    return `${Math.round((seconds / 3600) * 10) / 10}時間`;
  }
}
