import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { AnnouncementDetailComponent } from '../announcement-detail/announcement-detail.component';
import { AnnouncementEditorComponent } from '../announcement-editor/announcement-editor.component';
import { AnnouncementListComponent } from '../announcement-list/announcement-list.component';
import { AnnouncementsFacade } from '../announcements.facade';
import { AnnouncementEditorSubmission, AnnouncementViewModel } from '../announcements.types';

@Component({
  selector: 'app-announcements-page',
  standalone: true,
  imports: [FormsModule, AnnouncementDetailComponent, AnnouncementEditorComponent, AnnouncementListComponent],
  templateUrl: './announcements-page.component.html',
  styleUrl: './announcements-page.component.scss'
})
export class AnnouncementsPageComponent implements OnDestroy {
  private readonly facade = inject(AnnouncementsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly routeAnnouncementId = this.route.snapshot.paramMap.get('announcementId');

  readonly page = this.facade.page;
  readonly searchValue = signal('');
  readonly selectedAnnouncementId = signal<string | null>(this.routeAnnouncementId ?? this.page().selectedAnnouncementId);
  readonly editorVisible = signal(false);

  readonly filteredAnnouncements = computed(() => this.filterAuthorizedAnnouncements(this.page().announcements, this.searchValue()));
  readonly selectedAnnouncement = computed(() => {
    const selectedId = this.page().selectedAnnouncementId ?? this.selectedAnnouncementId();
    if (selectedId) {
      return this.filteredAnnouncements().find((announcement) => announcement.id === selectedId) ?? null;
    }

    return this.filteredAnnouncements()[0] ?? null;
  });

  readonly hasReadPermission = computed(() => this.page().pageCapabilities.includes('readAnnouncement'));
  readonly canCreate = computed(() => this.page().pageCapabilities.includes('createAnnouncement'));
  readonly canEdit = computed(() => this.page().pageCapabilities.includes('editAnnouncement'));

  constructor() {
    if (this.routeAnnouncementId) {
      this.facade.selectAnnouncement(this.routeAnnouncementId);
    }
  }

  selectAnnouncement(announcementId: string): void {
    this.selectedAnnouncementId.set(announcementId);
    this.editorVisible.set(false);
    this.facade.setEditorActive(false);
    this.facade.selectAnnouncement(announcementId);
  }

  markRead(announcementId: string): void {
    this.facade.markAnnouncementRead(announcementId);
  }

  updateSearch(value: string): void {
    this.searchValue.set(value);
  }

  showCreateEditor(): void {
    if (this.canCreate() && this.facade.beginCreate()) {
      this.editorVisible.set(true);
    }
  }

  showEditEditor(): void {
    if (this.canEdit()) {
      this.editorVisible.set(true);
      this.facade.setEditorActive(true);
    }
  }

  publishAnnouncement(submission: AnnouncementEditorSubmission): void {
    this.facade.createAnnouncement(submission);
  }

  ngOnDestroy(): void {
    this.facade.setEditorActive(false);
  }

  private filterAuthorizedAnnouncements(
    announcements: readonly AnnouncementViewModel[],
    searchValue: string
  ): readonly AnnouncementViewModel[] {
    const readableAnnouncements = announcements.filter((announcement) =>
      announcement.capabilities.includes('readAnnouncement')
    );
    const query = searchValue.trim().toLocaleLowerCase('ja-JP');

    if (!query) {
      return readableAnnouncements;
    }

    return readableAnnouncements.filter((announcement) =>
      [
        announcement.title,
        announcement.body,
        announcement.publishedAtLabel,
        announcement.publicationState === 'draft' ? '下書き' : '公開'
      ]
        .join(' ')
        .toLocaleLowerCase('ja-JP')
        .includes(query)
    );
  }
}
