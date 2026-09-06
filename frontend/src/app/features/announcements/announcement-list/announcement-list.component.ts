import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';

import { AnnouncementAudiencePreviewComponent } from '../announcement-audience-preview/announcement-audience-preview.component';
import { AnnouncementPriorityBadgeComponent } from '../announcement-priority-badge/announcement-priority-badge.component';
import { AnnouncementPublicationStatusComponent } from '../announcement-publication-status/announcement-publication-status.component';
import { AnnouncementReadStateComponent } from '../announcement-read-state/announcement-read-state.component';
import { AnnouncementViewModel } from '../announcements.types';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-announcement-list',
  standalone: true,
  imports: [
    AnnouncementAudiencePreviewComponent,
    AnnouncementPriorityBadgeComponent,
    AnnouncementPublicationStatusComponent,
    AnnouncementReadStateComponent
  ],
  templateUrl: './announcement-list.component.html',
  styleUrl: './announcement-list.component.scss',
})
export class AnnouncementListComponent implements AfterViewChecked {
  @Input({ required: true }) announcements: readonly AnnouncementViewModel[] = [];
  @Input() selectedAnnouncementId: string | null = null;
  /** Monotonic route-return focus request. The target may no longer be present. */
  @Input() focusRequest = 0;
  @Input() focusAnnouncementId: string | null = null;
  @Output() readonly announcementSelected = new EventEmitter<string>();

  @ViewChild('listHeading') private listHeading?: ElementRef<HTMLElement>;
  @ViewChildren('announcementAction') private announcementActions?: QueryList<ElementRef<HTMLButtonElement>>;

  private handledFocusRequest = 0;

  ngAfterViewChecked(): void {
    if (this.focusRequest <= this.handledFocusRequest) {
      return;
    }

    const target = this.announcementActions?.toArray().find(
      (action) => action.nativeElement.dataset['announcementId'] === this.focusAnnouncementId,
    )?.nativeElement;
    (target ?? this.listHeading?.nativeElement)?.focus({ preventScroll: true });
    this.handledFocusRequest = this.focusRequest;
  }
}
