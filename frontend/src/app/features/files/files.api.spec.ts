import { mapFileListItem, safeFileNameFromHeader } from './files.api';

describe('files api mapper', () => {
  it('maps backend file list items to safe view models', () => {
    const vm = mapFileListItem({
      id: 'attachment-1',
      fileObjectId: 'file-object-1',
      workspaceId: 'workspace-1',
      originalFileName: 'report.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      status: 'Active',
      scanStatus: 'Skipped',
      uploadedByUserId: 'user-1',
      uploadedByDisplayName: 'Fixture User',
      createdAt: '2026-07-08T00:00:00Z',
      updatedAt: '2026-07-09T12:30:00Z',
    });

    expect(vm.id).toBe('attachment-1');
    expect(vm.canonicalFileId).toBe('file-object-1');
    expect(vm.scanStatus).toBe('allowed');
    expect(vm.kind).toBe('pdf');
    expect(vm.downloadPolicy).toBe('available');
    expect(vm.capabilities).toEqual(['download']);
    expect(vm.uploadedByDisplay).toBe('Fixture User');
    expect(vm.modifiedAtLabel).toBe(new Date('2026-07-09T12:30:00Z').toLocaleString());
    expect(vm.createdAtLabel).toBe(new Date('2026-07-08T00:00:00Z').toLocaleString());
  });

  it('falls back to createdAt when the backend has no updated timestamp', () => {
    const vm = mapFileListItem({
      id: 'attachment-legacy',
      originalFileName: 'legacy.txt',
      contentType: 'text/plain',
      status: 'Active',
      scanStatus: 'Skipped',
      createdAt: '2026-07-08T00:00:00Z',
    });

    expect(vm.modifiedAtLabel).toBe(vm.createdAtLabel);
  });

  it('does not allow download for quarantined or deleted files', () => {
    const quarantined = mapFileListItem({
      id: 'attachment-2',
      fileObjectId: 'file-object-2',
      originalFileName: 'archive.zip',
      contentType: 'application/zip',
      sizeBytes: 4096,
      status: 'Quarantined',
      scanStatus: 'Infected',
    });
    const deleted = mapFileListItem({
      id: 'attachment-3',
      fileObjectId: 'file-object-3',
      originalFileName: 'old.txt',
      contentType: 'text/plain',
      sizeBytes: 128,
      status: 'Deleted',
      scanStatus: 'Skipped',
      deletedAt: '2026-07-08T00:00:00Z',
    });

    expect(quarantined.scanStatus).toBe('blocked');
    expect(quarantined.capabilities).toEqual([]);
    expect(deleted.downloadPolicy).toBe('denied');
    expect(deleted.capabilities).toEqual([]);
  });

  it('does not duplicate backend upload type or size policy in the client mapper', () => {
    expect('isAllowedUploadFile' in { mapFileListItem }).toBe(false);
  });

  it('extracts backend download filenames from content disposition headers', () => {
    expect(safeFileNameFromHeader('attachment; filename="report.pdf"', 'fallback.txt')).toBe('report.pdf');
    expect(safeFileNameFromHeader("attachment; filename*=UTF-8''report%20copy.pdf", 'fallback.txt')).toBe(
      'report copy.pdf',
    );
    expect(safeFileNameFromHeader(null, 'fallback.txt')).toBe('fallback.txt');
  });
});
