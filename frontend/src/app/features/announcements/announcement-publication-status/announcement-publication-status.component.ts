import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import {
  ANNOUNCEMENT_PUBLICATION_STATE_LABELS,
  AnnouncementPublicationState
} from '../announcements.types';

@Component({
  selector: 'app-announcement-publication-status',
  standalone: true,
  templateUrl: './announcement-publication-status.component.html',
  styleUrl: './announcement-publication-status.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class AnnouncementPublicationStatusComponent {
  @Input({ required: true }) state!: AnnouncementPublicationState;
  @Input() scheduledAtLabel?: string;
  @Input() timeZoneLabel?: string;

  readonly labels = ANNOUNCEMENT_PUBLICATION_STATE_LABELS;
}
