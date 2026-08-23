export type FileKind = 'image' | 'pdf' | 'zip' | 'video' | 'svg' | 'document';

export type FileScanStatus = 'pending' | 'allowed' | 'blocked' | 'unavailable';

export type FileDownloadPolicy = 'available' | 'denied' | 'adminOverrideRequired';

export type FileCapability = 'download' | 'requestQuotaException' | 'adminOverrideBlockedDownload';

export type FileUploadState =
  | 'idle'
  | 'pending'
  | 'succeeded'
  | 'progress'
  | 'failed'
  | 'cancelled'
  | 'tooLarge'
  | 'invalidType'
  | 'quotaExceeded'
  | 'quotaExceptionRequested'
  | 'quotaExceptionApproved'
  | 'quotaExceptionRejected';

export type FileDownloadState = 'idle' | 'pending' | 'succeeded' | 'failed';

export type FileQuotaState = 'available' | 'exceeded' | 'exceptionRequested' | 'exceptionApproved' | 'exceptionRejected';

export interface FileUploadViewModel {
  readonly state: FileUploadState;
  readonly canUpload?: boolean;
  readonly selectedFileName?: string;
  readonly progressPercent?: number;
  readonly message?: string;
}

export interface FileUploadQueueItem {
  readonly clientRequestId: string;
  readonly fileName: string;
  readonly state: 'pending' | 'uploading' | 'succeeded' | 'failed' | 'cancelled';
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
  readonly modifiedAtLabel: string;
  readonly kind: FileKind;
  readonly downloadPolicy: FileDownloadPolicy;
  readonly capabilities: readonly FileCapability[];
  readonly downloadState?: FileDownloadState;
  readonly downloadMessage?: string;
  readonly safeStatusLabel?: string;
  readonly internalStorageKey?: string;
  readonly internalPath?: string;
  readonly rawScanMetadata?: string;
}

/** Query state owned by the Task-detail attachment picker, never by the Files page. */
export interface TaskFilePickerState {
  readonly status: 'idle' | 'loading' | 'ready' | 'empty' | 'permissionDenied' | 'error';
  readonly workspaceId: string | null;
  readonly files: readonly FileViewModel[];
  readonly message?: string;
  readonly requestId?: string;
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly hasMore: boolean;
  readonly failedPage?: number;
}

export interface FilesPageViewModel {
  readonly title: string;
  readonly subtitle: string;
  readonly upload: FileUploadViewModel;
  readonly uploadQueue: readonly FileUploadQueueItem[];
  readonly quota: FileQuotaViewModel;
  readonly recentFiles: readonly FileViewModel[];
  readonly pickerFiles: readonly FileViewModel[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly hasMore: boolean;
}

export const FILE_SCAN_STATUS_LABELS: Record<FileScanStatus, string> = {
  pending: 'Scan pending',
  allowed: 'Allowed',
  blocked: 'Blocked',
  unavailable: 'Scan unavailable',
};
/** Legacy story fixture only; live upload validation is backend-authoritative. */
export const FILE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
