import { Component, EventEmitter, Input, Output } from '@angular/core';

import { AnnouncementAudiencePreviewComponent } from '../announcement-audience-preview/announcement-audience-preview.component';
import { AnnouncementPublicationStatusComponent } from '../announcement-publication-status/announcement-publication-status.component';
import { AnnouncementReadStateComponent } from '../announcement-read-state/announcement-read-state.component';
import { ANNOUNCEMENT_PRIORITY_LABELS, AnnouncementViewModel } from '../announcements.types';

@Component({
  selector: 'app-announcement-detail',
  standalone: true,
  imports: [AnnouncementAudiencePreviewComponent, AnnouncementPublicationStatusComponent, AnnouncementReadStateComponent],
  templateUrl: './announcement-detail.component.html',
  styleUrl: './announcement-detail.component.scss'
})
export class AnnouncementDetailComponent {
  @Input() announcement: AnnouncementViewModel | null = null;
  @Input() canEdit = false;
  @Output() readonly editRequested = new EventEmitter<string>();
  @Output() readonly markReadRequested = new EventEmitter<string>();

  readonly priorityLabels = ANNOUNCEMENT_PRIORITY_LABELS;
}
