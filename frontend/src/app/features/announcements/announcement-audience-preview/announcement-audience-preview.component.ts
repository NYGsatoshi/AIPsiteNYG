import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

import { ANNOUNCEMENT_AUDIENCE_LABELS, AnnouncementAudienceScope } from '../announcements.types';

@Component({
  selector: 'app-announcement-audience-preview',
  standalone: true,
  templateUrl: './announcement-audience-preview.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './announcement-audience-preview.component.scss',
})
export class AnnouncementAudiencePreviewComponent {
  @Input({ required: true }) audienceScope!: AnnouncementAudienceScope;

  readonly labels = ANNOUNCEMENT_AUDIENCE_LABELS;
}
