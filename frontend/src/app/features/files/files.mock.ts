import { FILE_UPLOAD_MAX_BYTES, FilesPageViewModel, FileViewModel } from './files.types';

export const DEFAULT_FILES: readonly FileViewModel[] = [
  {
    id: 'file-row-001',
    canonicalFileId: 'canonical-file-001',
    originalFileName: 'sanitized-project-note.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2_440_192,
    scanStatus: 'allowed',
    uploadedByDisplay: 'サンプル利用者A',
    createdAtLabel: '2026-07-01 09:30',
    kind: 'pdf',
    downloadPolicy: 'available',
    capabilities: ['download'],
    internalStorageKey: 'tenant-a/private/raw/sanitized-project-note.pdf',
    internalPath: '/var/lib/aipsite/private/raw/sanitized-project-note.pdf',
    rawScanMetadata: 'engine=mock;signature=private-debug-value'
  },
  {
    id: 'file-row-002',
    canonicalFileId: 'canonical-file-002',
    originalFileName: 'classroom-photo.png',
    contentType: 'image/png',
    sizeBytes: 814_320,
    scanStatus: 'pending',
    uploadedByDisplay: 'サンプル利用者B',
    createdAtLabel: '2026-07-01 10:12',
    kind: 'image',
    downloadPolicy: 'available',
    capabilities: ['download']
  },
  {
    id: 'file-row-003',
    canonicalFileId: 'canonical-file-003',
    originalFileName: 'blocked-archive.zip',
    contentType: 'application/zip',
    sizeBytes: 18_982_144,
    scanStatus: 'blocked',
    uploadedByDisplay: 'サンプル利用者C',
    createdAtLabel: '2026-07-01 10:40',
    kind: 'zip',
    downloadPolicy: 'adminOverrideRequired',
    capabilities: ['adminOverrideBlockedDownload'],
    safeStatusLabel: '管理者の監査理由が必要です'
  },
  {
    id: 'file-row-004',
    canonicalFileId: null,
    originalFileName: 'pending-canonical-id.svg',
    contentType: 'image/svg+xml',
    sizeBytes: 44_220,
    scanStatus: 'allowed',
    uploadedByDisplay: 'サンプル利用者D',
    createdAtLabel: '2026-07-01 11:05',
    kind: 'svg',
    downloadPolicy: 'denied',
    capabilities: [],
    safeStatusLabel: '正規ファイルIDの確定待ち'
  },
  {
    id: 'file-row-005',
    canonicalFileId: 'canonical-file-005',
    originalFileName: 'lesson-recording.mp4',
    contentType: 'video/mp4',
    sizeBytes: 76_984_320,
    scanStatus: 'allowed',
    uploadedByDisplay: 'サンプル利用者E',
    createdAtLabel: '2026-07-01 11:28',
    kind: 'video',
    downloadPolicy: 'denied',
    capabilities: [],
    safeStatusLabel: 'このファイルをダウンロードする権限がありません。'
  }
];

const basePage = (overrides: Partial<FilesPageViewModel> = {}): FilesPageViewModel => ({
  title: 'ファイル',
  subtitle: '添付とダウンロードのP0モック',
  maxUploadBytes: FILE_UPLOAD_MAX_BYTES,
  upload: {
    state: 'idle',
    canUpload: false,
    message: 'File upload is not available in MVP0.'
  },
  quota: {
    state: 'available',
    usedBytes: 46 * 1024 * 1024,
    limitBytes: FILE_UPLOAD_MAX_BYTES,
    message: '100 MBまでアップロードできます。'
  },
  recentFiles: DEFAULT_FILES,
  pickerFiles: DEFAULT_FILES,
  ...overrides
});

export const FILES_PAGE_SCENARIOS = {
  default: basePage(),
  uploadPending: basePage({
    upload: {
      state: 'idle',
      canUpload: false,
      message: 'File upload is not available in MVP0.'
    }
  }),
  uploadProgress: basePage({
    upload: {
      state: 'idle',
      canUpload: false,
      message: 'File upload is not available in MVP0.'
    }
  }),
  uploadFailed: basePage({
    upload: {
      state: 'failed',
      selectedFileName: 'new-attachment.pdf',
      message: 'アップロードに失敗しました。'
    }
  }),
  fileTooLarge: basePage({
    upload: {
      state: 'tooLarge',
      selectedFileName: 'oversized-video.mp4',
      message: '100 MBを超えるファイルはアップロードできません。'
    }
  }),
  scanPending: basePage({
    recentFiles: [DEFAULT_FILES[1]]
  }),
  scanBlocked: basePage({
    recentFiles: [DEFAULT_FILES[2]]
  }),
  scanAllowed: basePage({
    recentFiles: [DEFAULT_FILES[0]]
  }),
  downloadDenied: basePage({
    recentFiles: [DEFAULT_FILES[4]]
  }),
  noCanonicalFileIdYet: basePage({
    pickerFiles: [DEFAULT_FILES[3], DEFAULT_FILES[0]],
    recentFiles: [DEFAULT_FILES[3]]
  }),
  quotaExceeded: basePage({
    upload: {
      state: 'quotaExceeded',
      message: '保存容量を超過しています。'
    },
    quota: {
      state: 'exceeded',
      usedBytes: 104 * 1024 * 1024,
      limitBytes: FILE_UPLOAD_MAX_BYTES,
      message: '保存容量を超過しています。例外申請が必要です。'
    }
  }),
  quotaExceptionRequested: basePage({
    upload: {
      state: 'quotaExceptionRequested',
      message: '容量例外を申請済みです。'
    },
    quota: {
      state: 'exceptionRequested',
      usedBytes: 104 * 1024 * 1024,
      limitBytes: FILE_UPLOAD_MAX_BYTES,
      message: '容量例外を申請済みです。'
    }
  }),
  quotaExceptionApproved: basePage({
    upload: {
      state: 'quotaExceptionApproved',
      message: '容量例外が承認されました。'
    },
    quota: {
      state: 'exceptionApproved',
      usedBytes: 104 * 1024 * 1024,
      limitBytes: FILE_UPLOAD_MAX_BYTES,
      message: '容量例外が承認されました。'
    }
  }),
  quotaExceptionRejected: basePage({
    upload: {
      state: 'quotaExceptionRejected',
      message: '容量例外が却下されました。'
    },
    quota: {
      state: 'exceptionRejected',
      usedBytes: 104 * 1024 * 1024,
      limitBytes: FILE_UPLOAD_MAX_BYTES,
      message: '容量例外が却下されました。'
    }
  }),
  adminOverrideRequired: basePage({
    recentFiles: [DEFAULT_FILES[2]]
  }),
  previewDisabled: basePage({
    recentFiles: [DEFAULT_FILES[0], DEFAULT_FILES[1], DEFAULT_FILES[2], DEFAULT_FILES[3], DEFAULT_FILES[4]]
  }),
  mobile: basePage({
    recentFiles: [DEFAULT_FILES[0], DEFAULT_FILES[1], DEFAULT_FILES[4]]
  })
} satisfies Record<string, FilesPageViewModel>;
