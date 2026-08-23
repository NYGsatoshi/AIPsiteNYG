import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { AnnouncementDetailComponent } from '../announcement-detail/announcement-detail.component';
import { AnnouncementEditorComponent } from '../announcement-editor/announcement-editor.component';
import { AnnouncementListComponent } from '../announcement-list/announcement-list.component';
import { AnnouncementsFacade } from '../announcements.facade';
import {
  ANNOUNCEMENT_PUBLICATION_STATE_LABELS,
  AnnouncementEditorDraft,
  AnnouncementViewModel
} from '../announcements.types';

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
  readonly editingAnnouncementId = signal<string | null>(null);

  readonly filteredAnnouncements = computed(() =>
    this.filterAuthorizedAnnouncements(this.page().announcements, this.searchValue())
  );
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
  readonly activeEditorDraft = computed<AnnouncementEditorDraft | null>(() => {
    const editingId = this.editingAnnouncementId();
    if (!editingId) {
      return this.page().editorDraft ?? null;
    }

    const announcement = this.page().announcements.find((item) => item.id === editingId);
    if (!announcement) {
      return null;
    }

    return {
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      priority: announcement.priority,
      audienceScope: announcement.audienceScope,
      requiresReadConfirmation: announcement.readState.requiresReadConfirmation,
      publicationState: announcement.publicationState,
      scheduledAtLabel: announcement.scheduledAtLabel,
      timeZoneLabel: announcement.timeZoneLabel
    };
  });

  constructor() {
    if (this.routeAnnouncementId) {
      this.facade.selectAnnouncement(this.routeAnnouncementId);
    }
  }

  selectAnnouncement(announcementId: string): void {
    this.selectedAnnouncementId.set(announcementId);
    this.editorVisible.set(false);
    this.editingAnnouncementId.set(null);
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
    if (this.canCreate()) {
      this.editingAnnouncementId.set(null);
      this.editorVisible.set(true);
      this.facade.setEditorActive(true);
    }
  }

  showEditEditor(): void {
    const selected = this.selectedAnnouncement();
    if (this.canEdit() && selected && selected.publicationState !== 'archived') {
      this.editingAnnouncementId.set(selected.id);
      this.editorVisible.set(true);
      this.facade.setEditorActive(true);
    }
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
        announcement.scheduledAtLabel ?? '',
        announcement.timeZoneLabel ?? '',
        ANNOUNCEMENT_PUBLICATION_STATE_LABELS[announcement.publicationState]
      ]
        .join(' ')
        .toLocaleLowerCase('ja-JP')
        .includes(query)
    );
  }
}
