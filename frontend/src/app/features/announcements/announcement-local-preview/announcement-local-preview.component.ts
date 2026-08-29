import { Component, ElementRef, Input, ViewChild } from '@angular/core';

import { AnnouncementPriorityBadgeComponent } from '../announcement-priority-badge/announcement-priority-badge.component';
import { AnnouncementLocalPreview } from '../announcements.types';

/**
 * A deliberately inert local rendering of the current Announcement form.
 * It has no identifier, outputs, router dependency, or HTTP dependency, so it
 * cannot publish, deliver, mark a recipient read, or create analytics data.
 */
@Component({
  selector: 'app-announcement-local-preview',
  standalone: true,
  imports: [AnnouncementPriorityBadgeComponent],
  templateUrl: './announcement-local-preview.component.html',
  styleUrl: './announcement-local-preview.component.scss',
})
export class AnnouncementLocalPreviewComponent {
  @Input({ required: true }) preview!: AnnouncementLocalPreview;

  @ViewChild('heading') private heading?: ElementRef<HTMLElement>;

  focusHeading(): void {
    this.heading?.nativeElement.focus();
  }
}
