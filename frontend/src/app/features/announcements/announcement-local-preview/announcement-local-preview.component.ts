import { ChangeDetectionStrategy, Component, ElementRef, Input, ViewChild, signal } from '@angular/core';

import { AnnouncementPriorityBadgeComponent } from '../announcement-priority-badge/announcement-priority-badge.component';
import { AnnouncementLocalPreview } from '../announcements.types';

/**
 * A deliberately inert local rendering of the current Announcement form.
 * It has no identifier, outputs, router dependency, or HTTP dependency, so it
 * cannot publish, deliver, navigate a CTA, mark a recipient read, or create
 * analytics data.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager
  selector: 'app-announcement-local-preview',
  standalone: true,
  imports: [AnnouncementPriorityBadgeComponent],
  templateUrl: './announcement-local-preview.component.html',
  styleUrl: './announcement-local-preview.component.scss',
})
export class AnnouncementLocalPreviewComponent {
  @Input({ required: true }) preview!: AnnouncementLocalPreview;

  @ViewChild('heading') private heading?: ElementRef<HTMLElement>;

  readonly viewport = signal<'desktop' | 'mobile'>('desktop');

  focusHeading(): void {
    this.heading?.nativeElement.focus();
  }

  setViewport(viewport: 'desktop' | 'mobile'): void {
    this.viewport.set(viewport);
  }
}
