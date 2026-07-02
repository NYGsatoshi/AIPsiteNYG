import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { AnnouncementDetailComponent } from '../announcement-detail/announcement-detail.component';
import { AnnouncementEditorComponent } from '../announcement-editor/announcement-editor.component';
import { AnnouncementListComponent } from '../announcement-list/announcement-list.component';
import { AnnouncementsFacade } from '../announcements.facade';
import { AnnouncementViewModel } from '../announcements.types';

@Component({
  selector: 'app-announcements-page',
  standalone: true,
  imports: [FormsModule, AnnouncementDetailComponent, AnnouncementEditorComponent, AnnouncementListComponent],
  templateUrl: './announcements-page.component.html',
  styleUrl: './announcements-page.component.scss'
})
export class AnnouncementsPageComponent {
  private readonly facade = inject(AnnouncementsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly routeAnnouncementId = this.route.snapshot.paramMap.get('announcementId');

  readonly page = this.facade.page;
  readonly searchValue = signal('');
  readonly selectedAnnouncementId = signal<string | null>(this.routeAnnouncementId ?? this.page().selectedAnnouncementId);
  readonly editorVisible = signal(false);

  readonly filteredAnnouncements = computed(() => this.filterAuthorizedAnnouncements(this.page().announcements, this.searchValue()));
  readonly selectedAnnouncement = computed(() => {
    const selectedId = this.selectedAnnouncementId();
    if (selectedId) {
      return this.filteredAnnouncements().find((announcement) => announcement.id === selectedId) ?? null;
    }

    return this.filteredAnnouncements()[0] ?? null;
  });

  readonly hasReadPermission = computed(() => this.page().pageCapabilities.includes('readAnnouncement'));
  readonly canCreate = computed(() => this.page().pageCapabilities.includes('createAnnouncement'));
  readonly canEdit = computed(() => this.page().pageCapabilities.includes('editAnnouncement'));

  selectAnnouncement(announcementId: string): void {
    this.selectedAnnouncementId.set(announcementId);
    this.editorVisible.set(false);
  }

  updateSearch(value: string): void {
    this.searchValue.set(value);
  }

  showCreateEditor(): void {
    if (this.canCreate()) {
      this.editorVisible.set(true);
    }
  }

  showEditEditor(): void {
    if (this.canEdit()) {
      this.editorVisible.set(true);
    }
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
