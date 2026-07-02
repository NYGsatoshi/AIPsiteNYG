import { Injectable } from '@angular/core';

import { MessagingDraftScope } from './messaging.types';

@Injectable({ providedIn: 'root' })
export class DraftStorageService {
  private readonly prefix = 'aip.messaging.draft';

  readDraft(scope: MessagingDraftScope): string {
    return this.storage()?.getItem(this.keyFor(scope)) ?? '';
  }

  writeDraft(scope: MessagingDraftScope, value: string): void {
    const storage = this.storage();
    if (!storage) {
      return;
    }

    const key = this.keyFor(scope);
    if (value.length === 0) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, value);
  }

  clearDraft(scope: MessagingDraftScope): void {
    this.storage()?.removeItem(this.keyFor(scope));
  }

  clearAllDrafts(): void {
    const storage = this.storage();
    if (!storage) {
      return;
    }

    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => key?.startsWith(`${this.prefix}:`) ?? false
    );
    for (const key of keys) {
      storage.removeItem(key);
    }
  }

  keyFor(scope: MessagingDraftScope): string {
    const workspacePart = scope.workspaceId ?? 'dm';
    return `${this.prefix}:${scope.tenantId}:${workspacePart}:${scope.conversationId}`;
  }

  private storage(): Storage | null {
    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  }
}
