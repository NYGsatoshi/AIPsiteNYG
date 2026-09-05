import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { LucideCircle, LucideCircleAlert, LucideTriangleAlert } from '@lucide/angular';

import {
  ANNOUNCEMENT_PRIORITY_DEFINITIONS,
  AnnouncementPriority
} from '../announcements.types';

@Component({
  selector: 'app-announcement-priority-badge',
  standalone: true,
  imports: [LucideCircle, LucideCircleAlert, LucideTriangleAlert],
  templateUrl: './announcement-priority-badge.component.html',
  styleUrl: './announcement-priority-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class AnnouncementPriorityBadgeComponent {
  @Input({ required: true }) priority: AnnouncementPriority = 'normal';

  readonly definitions = ANNOUNCEMENT_PRIORITY_DEFINITIONS;
}
