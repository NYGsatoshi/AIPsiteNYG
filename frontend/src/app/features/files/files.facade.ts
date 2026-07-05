import { computed, Injectable, InjectionToken, inject } from '@angular/core';

import { FILE_UPLOAD_MAX_BYTES, FilesPageViewModel } from './files.types';

export const AIP_FILES_PAGE_MOCK = new InjectionToken<FilesPageViewModel>('AIP_FILES_PAGE_MOCK');

@Injectable({ providedIn: 'root' })
export class FilesFacade {
  private readonly mockPage = inject(AIP_FILES_PAGE_MOCK, { optional: true });

  readonly page = computed<FilesPageViewModel>(() => this.mockPage ?? LIVE_FILES_PAGE);
}

const LIVE_FILES_PAGE: FilesPageViewModel = {
  title: 'Files',
  subtitle: 'File list API is not implemented for this screen.',
  maxUploadBytes: FILE_UPLOAD_MAX_BYTES,
  upload: {
    state: 'idle',
    message: 'Uploads use /api/files when submitted.',
  },
  quota: {
    state: 'available',
    usedBytes: 0,
    limitBytes: FILE_UPLOAD_MAX_BYTES,
    message: 'Quota summary API is not implemented.',
  },
  recentFiles: [],
  pickerFiles: [],
};
