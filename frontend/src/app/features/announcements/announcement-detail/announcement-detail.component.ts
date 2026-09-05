import { DOCUMENT } from '@angular/common';
import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  inject,
  input,
  output,
} from '@angular/core';
import { LucideChevronLeft } from '@lucide/angular';

import { AnnouncementAudiencePreviewComponent } from '../announcement-audience-preview/announcement-audience-preview.component';
import { AnnouncementPriorityBadgeComponent } from '../announcement-priority-badge/announcement-priority-badge.component';
import { AnnouncementPublicationStatusComponent } from '../announcement-publication-status/announcement-publication-status.component';
import { AnnouncementReadStateComponent } from '../announcement-read-state/announcement-read-state.component';
import { AnnouncementViewModel } from '../announcements.types';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager
  selector: 'app-announcement-detail',
  standalone: true,
  imports: [
    LucideChevronLeft,
    AnnouncementAudiencePreviewComponent,
    AnnouncementPriorityBadgeComponent,
    AnnouncementPublicationStatusComponent,
    AnnouncementReadStateComponent
  ],
  templateUrl: './announcement-detail.component.html',
  styleUrl: './announcement-detail.component.scss',
})
export class AnnouncementDetailComponent implements AfterViewChecked {
  private readonly document = inject(DOCUMENT);

  @Input() announcement: AnnouncementViewModel | null = null;
  @Input() canEdit = false;
  // eslint-disable-next-line @typescript-eslint/member-ordering -- Issue #390 state stays next to the existing input contract.
  public readonly acknowledged = input(false);
  // eslint-disable-next-line @typescript-eslint/member-ordering -- Issue #390 state stays next to the existing input contract.
  public readonly acknowledgementPending = input(false);
  // eslint-disable-next-line @typescript-eslint/member-ordering -- Issue #390 state stays next to the existing input contract.
  public readonly acknowledgementError = input(false);
  /** Monotonic request from the route container; only handled at the mobile hierarchy breakpoint. */
  @Input() mobileFocusRequest = 0;
  /** Prevents a queued mobile focus callback from a previous route from stealing focus on Back. */
  @Input() mobileDetailActive = true;
  @Output() readonly editRequested = new EventEmitter<string>();
  @Output() readonly markReadRequested = new EventEmitter<string>();
  // eslint-disable-next-line @typescript-eslint/member-ordering -- Issue #390 output stays next to the existing output contract.
  public readonly acknowledgeRequested = output<string>();
  // eslint-disable-next-line @typescript-eslint/member-ordering -- Issue #390 output stays next to the existing output contract.
  public readonly ctaClicked = output<string>();
  @Output() readonly backRequested = new EventEmitter<void>();

  @ViewChild('detailTitle') private detailTitle?: ElementRef<HTMLElement>;
  @ViewChild('detailEmptyHeading') private detailEmptyHeading?: ElementRef<HTMLElement>;
  @ViewChild('readStateStatus') private readStateStatus?: ElementRef<HTMLElement>;

  private handledMobileFocusRequest = 0;
  private awaitingMobileTitleFocus = false;
  private pendingReadAnnouncementId: string | null = null;

  ngAfterViewChecked(): void {
    if (this.mobileFocusRequest > this.handledMobileFocusRequest) {
      this.handledMobileFocusRequest = this.mobileFocusRequest;
      if (this.isMobileHierarchy()) {
        this.focusMobileDetailHeading();
      }
    }

    if (
      this.awaitingMobileTitleFocus &&
      this.detailTitle &&
      this.mobileDetailActive &&
      this.isMobileHierarchy()
    ) {
      this.awaitingMobileTitleFocus = false;
      this.queueMobileFocus(() => this.detailTitle?.nativeElement.focus({ preventScroll: true }));
    }

    const announcement = this.announcement;
    if (
      announcement?.readState.isMarkingRead === false &&
      this.pendingReadAnnouncementId === announcement.id
    ) {
      this.pendingReadAnnouncementId = null;
      if (announcement.readState.isRead) {
        queueMicrotask(() => {
          if (this.mobileDetailActive) {
            this.readStateStatus?.nativeElement.focus({ preventScroll: true });
          }
        });
      }
    }
  }

  requestMarkRead(): void {
    const announcement = this.announcement;
    if (!announcement || announcement.readState.isRead || announcement.readState.isMarkingRead) {
      return;
    }

    this.pendingReadAnnouncementId = announcement.id;
    this.markReadRequested.emit(announcement.id);
  }

  public requestAcknowledgement(): void {
    const { announcement } = this;
    if (
      announcement === null ||
      !announcement.readState.requiresReadConfirmation ||
      this.acknowledged() ||
      this.acknowledgementPending()
    ) {
      return;
    }

    this.acknowledgeRequested.emit(announcement.id);
  }

  public recordCtaClick(): void {
    const { announcement } = this;
    if (announcement === null) {
      return;
    }
    if (typeof announcement.cta === 'undefined') {
      return;
    }

    this.ctaClicked.emit(announcement.id);
  }

  private isMobileHierarchy(): boolean {
    const window = this.document.defaultView;
    if (!window) {
      return false;
    }

    return window.matchMedia?.('(max-width: 860px)').matches ?? window.innerWidth <= 860;
  }

  private focusMobileDetailHeading(): void {
    if (this.detailTitle) {
      this.awaitingMobileTitleFocus = false;
      this.queueMobileFocus(() => this.detailTitle?.nativeElement.focus({ preventScroll: true }));
      return;
    }

    this.awaitingMobileTitleFocus = true;
    this.queueMobileFocus(() => this.detailEmptyHeading?.nativeElement.focus({ preventScroll: true }));
  }

  private queueMobileFocus(focus: () => void): void {
    queueMicrotask(() => {
      if (this.mobileDetailActive && this.isMobileHierarchy()) {
        focus();
      }
    });
  }
}
