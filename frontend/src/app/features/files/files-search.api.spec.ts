import { fileSearchParams, mapFileSearchResponse } from './files-search.api';
import { FileDisplayLocalizer } from './files.api';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DISPLAY_LOCALIZER: FileDisplayLocalizer = {
  untitledFile: '無題のファイル',
  unknownUser: '不明なユーザー',
  formatDate: (value) => value ? `表示日時: ${value}` : '',
};

describe('Files search API adapter', () => {
  it('builds one server-owned File query for name, type, modified, and current-user facets', () => {
    const params = fileSearchParams(
      WORKSPACE_ID,
      { query: '  report  ', kind: 'pdf', modified: 'last30Days', owner: 'me' },
      2,
      50,
      USER_ID,
      new Date('2026-08-29T12:00:00.000Z'),
    );

    expect(params.get('type')).toBe('File');
    expect(params.get('workspaceId')).toBe(WORKSPACE_ID);
    expect(params.get('q')).toBe('report');
    expect(params.get('fileKind')).toBe('Pdf');
    expect(params.get('fromDate')).toBe('2026-07-30T12:00:00.000Z');
    expect(params.get('authorUserId')).toBe(USER_ID);
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe('50');
  });

  it('maps only safe File-row metadata and never retains snippets or storage paths', () => {
    const result = mapFileSearchResponse({
      page: 1,
      pageSize: 50,
      totalCount: 1,
      items: [{
        type: 13,
        id: FILE_ID,
        title: 'report.pdf',
        workspaceId: WORKSPACE_ID,
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-28T00:00:00Z',
        authorDisplayName: 'Current User',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        status: 'Active',
        scanStatus: 'Allowed',
        snippet: 'secret body excerpt',
        storageKey: 'tenant/private/report.pdf',
        internalPath: '/srv/private/report.pdf',
      }],
    }, WORKSPACE_ID, DISPLAY_LOCALIZER);

    expect(result).not.toBeNull();
    expect(result?.totalCount).toBe(1);
    expect(result?.files[0]).toMatchObject({
      id: FILE_ID,
      canonicalFileId: FILE_ID,
      originalFileName: 'report.pdf',
      kind: 'pdf',
      uploadedByDisplay: 'Current User',
      canDelete: false,
    });
    expect(JSON.stringify(result)).not.toContain('secret body excerpt');
    expect(JSON.stringify(result)).not.toContain('tenant/private');
    expect(JSON.stringify(result)).not.toContain('/srv/private');
  });

  it.each([
    ['a non-File type', { type: 7 }],
    ['a mismatched Workspace', { workspaceId: OTHER_WORKSPACE_ID }],
    ['a malformed File identity', { id: 'not-a-file-id' }],
  ])('rejects the complete response when it contains %s', (_, patch) => {
    const result = mapFileSearchResponse({
      page: 1,
      pageSize: 50,
      totalCount: 1,
      items: [{
        type: 'File',
        id: FILE_ID,
        title: 'report.pdf',
        workspaceId: WORKSPACE_ID,
        createdAt: '2026-08-20T00:00:00Z',
        authorDisplayName: 'Current User',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        status: 'Active',
        scanStatus: 'Allowed',
        ...patch,
      }],
    }, WORKSPACE_ID, DISPLAY_LOCALIZER);

    expect(result).toBeNull();
  });
});
