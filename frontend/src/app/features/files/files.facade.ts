import { computed, Injectable, InjectionToken, inject } from '@angular/core';

import { FILES_PAGE_SCENARIOS } from './files.mock';
import { FilesPageViewModel } from './files.types';

export const AIP_FILES_PAGE_MOCK = new InjectionToken<FilesPageViewModel>('AIP_FILES_PAGE_MOCK');

@Injectable({ providedIn: 'root' })
export class FilesFacade {
  private readonly mockPage = inject(AIP_FILES_PAGE_MOCK, { optional: true });

  readonly page = computed<FilesPageViewModel>(() => this.mockPage ?? FILES_PAGE_SCENARIOS.default);
}
