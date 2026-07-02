import { Component, EventEmitter, Input, Output } from '@angular/core';

import { AnnouncementAudiencePreviewComponent } from '../announcement-audience-preview/announcement-audience-preview.component';
import { AnnouncementReadStateComponent } from '../announcement-read-state/announcement-read-state.component';
import { ANNOUNCEMENT_PRIORITY_LABELS, AnnouncementViewModel } from '../announcements.types';

@Component({
  selector: 'app-announcement-list',
  standalone: true,
  imports: [AnnouncementAudiencePreviewComponent, AnnouncementReadStateComponent],
  templateUrl: './announcement-list.component.html',
  styleUrl: './announcement-list.component.scss'
})
export class AnnouncementListComponent {
  @Input({ required: true }) announcements: readonly AnnouncementViewModel[] = [];
  @Input() selectedAnnouncementId: string | null = null;
  @Output() readonly announcementSelected = new EventEmitter<string>();

  readonly priorityLabels = ANNOUNCEMENT_PRIORITY_LABELS;
}
