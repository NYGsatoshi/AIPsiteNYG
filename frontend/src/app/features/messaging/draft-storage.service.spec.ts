import { TestBed } from '@angular/core/testing';

import { DraftStorageService } from './draft-storage.service';

describe('DraftStorageService', () => {
  const scope = {
    tenantId: 'tenant-a',
    userId: 'user-a',
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
  };

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('partitions drafts by authenticated user as well as Tenant and Workspace', () => {
    const service = TestBed.inject(DraftStorageService);
    const otherUserScope = { ...scope, userId: 'user-b' };

    service.writeDraft(scope, 'User A private draft');

    expect(service.readDraft(scope)).toBe('User A private draft');
    expect(service.readDraft(otherUserScope)).toBe('');
    expect(service.keyFor(scope)).not.toBe(service.keyFor(otherUserScope));
  });

  it('fails closed when individual storage operations are denied', () => {
    const service = TestBed.inject(DraftStorageService);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => service.writeDraft(scope, 'not persisted')).not.toThrow();
    expect(service.readDraft(scope)).toBe('');
    expect(() => service.clearDraft(scope)).not.toThrow();
    expect(() => service.clearAllDrafts()).not.toThrow();
  });

  it('continues a session-boundary clear when one draft removal fails', () => {
    const service = TestBed.inject(DraftStorageService);
    const otherScope = { ...scope, conversationId: 'conversation-b' };
    service.writeDraft(scope, 'A');
    service.writeDraft(otherScope, 'B');
    const originalRemove = Storage.prototype.removeItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key: string) {
      calls++;
      if (calls === 1) {
        throw new DOMException('denied once', 'SecurityError');
      }
      originalRemove.call(this, key);
    });

    expect(() => service.clearAllDrafts()).not.toThrow();
    expect(calls).toBe(2);
  });
});
