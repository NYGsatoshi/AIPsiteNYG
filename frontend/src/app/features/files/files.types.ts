export const FILE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export type FileKind = 'image' | 'pdf' | 'zip' | 'video' | 'svg' | 'document';

export type FileScanStatus = 'pending' | 'allowed' | 'blocked' | 'unavailable';

export type FileDownloadPolicy = 'available' | 'denied' | 'adminOverrideRequired';

export type FileCapability = 'download' | 'requestQuotaException' | 'adminOverrideBlockedDownload';

export type FileUploadState =
  | 'idle'
  | 'pending'
  | 'progress'
  | 'failed'
  | 'tooLarge'
  | 'quotaExceeded'
  | 'quotaExceptionRequested'
  | 'quotaExceptionApproved'
  | 'quotaExceptionRejected';

export type FileQuotaState = 'available' | 'exceeded' | 'exceptionRequested' | 'exceptionApproved' | 'exceptionRejected';

export interface FileUploadViewModel {
  readonly state: FileUploadState;
  readonly canUpload?: boolean;
  readonly selectedFileName?: string;
  readonly progressPercent?: number;
  readonly message?: string;
}

export interface FileQuotaViewModel {
  readonly state: FileQuotaState;
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly message: string;
}

export interface FileViewModel {
  readonly id: string;
  readonly canonicalFileId?: string | null;
  readonly originalFileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly scanStatus: FileScanStatus;
  readonly uploadedByDisplay: string;
  readonly createdAtLabel: string;
  readonly kind: FileKind;
  readonly downloadPolicy: FileDownloadPolicy;
  readonly capabilities: readonly FileCapability[];
  readonly safeStatusLabel?: string;
  readonly internalStorageKey?: string;
  readonly internalPath?: string;
  readonly rawScanMetadata?: string;
}

export interface FilesPageViewModel {
  readonly title: string;
  readonly subtitle: string;
  readonly maxUploadBytes: number;
  readonly upload: FileUploadViewModel;
  readonly quota: FileQuotaViewModel;
  readonly recentFiles: readonly FileViewModel[];
  readonly pickerFiles: readonly FileViewModel[];
}

export const FILE_SCAN_STATUS_LABELS: Record<FileScanStatus, string> = {
  pending: '安全確認中です。',
  allowed: '安全確認済み',
  blocked: '安全確認でブロックされました',
  unavailable: '安全確認を利用できません'
};
