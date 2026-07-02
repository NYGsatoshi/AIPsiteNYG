import { Component, Input } from '@angular/core';

import { AnnouncementReadStateViewModel } from '../announcements.types';

@Component({
  selector: 'app-announcement-read-state',
  standalone: true,
  templateUrl: './announcement-read-state.component.html',
  styleUrl: './announcement-read-state.component.scss'
})
export class AnnouncementReadStateComponent {
  @Input({ required: true }) readState!: AnnouncementReadStateViewModel;
}
