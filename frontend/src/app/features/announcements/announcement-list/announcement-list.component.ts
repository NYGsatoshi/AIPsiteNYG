import { Component, EventEmitter, Input, Output } from '@angular/core';

import { AnnouncementAudiencePreviewComponent } from '../announcement-audience-preview/announcement-audience-preview.component';
import { AnnouncementPriorityBadgeComponent } from '../announcement-priority-badge/announcement-priority-badge.component';
import { AnnouncementPublicationStatusComponent } from '../announcement-publication-status/announcement-publication-status.component';
import { AnnouncementReadStateComponent } from '../announcement-read-state/announcement-read-state.component';
import { AnnouncementViewModel } from '../announcements.types';

@Component({
  selector: 'app-announcement-list',
  standalone: true,
  imports: [
    AnnouncementAudiencePreviewComponent,
    AnnouncementPriorityBadgeComponent,
    AnnouncementPublicationStatusComponent,
    AnnouncementReadStateComponent
  ],
  templateUrl: './announcement-list.component.html',
  styleUrl: './announcement-list.component.scss'
})
export class AnnouncementListComponent {
  @Input({ required: true }) announcements: readonly AnnouncementViewModel[] = [];
  @Input() selectedAnnouncementId: string | null = null;
  @Output() readonly announcementSelected = new EventEmitter<string>();
}
