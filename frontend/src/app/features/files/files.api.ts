import { FileKind, FileScanStatus, FileViewModel } from './files.types';

export interface PagedResponseDto<T> {
  readonly items?: readonly T[];
}

export interface FileListItemDto {
  readonly id?: unknown;
  readonly fileObjectId?: unknown;
  readonly workspaceId?: unknown;
  readonly originalFileName?: unknown;
  readonly contentType?: unknown;
  readonly sizeBytes?: unknown;
  readonly status?: unknown;
  readonly scanStatus?: unknown;
  readonly uploadedByUserId?: unknown;
  readonly uploadedByDisplayName?: unknown;
  readonly createdAt?: unknown;
  readonly deletedAt?: unknown;
}

export interface AttachmentUploadResponseDto {
  readonly id?: unknown;
  readonly fileObjectId?: unknown;
  readonly originalFileName?: unknown;
}

export interface FileDownloadGrantDto {
  readonly fileDownloadGrantId?: unknown;
  readonly fileObjectId?: unknown;
  readonly expiresAt?: unknown;
  readonly token?: unknown;
}

export function mapFileListItem(dto: FileListItemDto): FileViewModel {
  const canonicalFileId = stringValue(dto.fileObjectId);
  const originalFileName = stringValue(dto.originalFileName) ?? 'Untitled file';
  const contentType = stringValue(dto.contentType) ?? 'application/octet-stream';
  const scanStatus = toScanStatus(dto.scanStatus, dto.status);
  const active = isActiveStatus(dto.status) && !stringValue(dto.deletedAt);
  const canDownload = active && scanStatus === 'allowed' && !!canonicalFileId;

  return {
    id: stringValue(dto.id) ?? canonicalFileId ?? '',
    canonicalFileId,
    originalFileName,
    contentType,
    sizeBytes: numberValue(dto.sizeBytes),
    scanStatus,
    uploadedByDisplay: stringValue(dto.uploadedByDisplayName) ?? 'Unknown user',
    createdAtLabel: formatDate(dto.createdAt),
    kind: fileKind(originalFileName, contentType),
    downloadPolicy: canDownload ? 'available' : 'denied',
    capabilities: canDownload ? ['download'] : [],
    downloadState: 'idle',
  };
}

export function safeFileNameFromHeader(headerValue: string | null, fallback: string): string {
  if (!headerValue) {
    return fallback;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replaceAll('"', '').trim());
  }

  const filenameMatch = /filename="?([^";]+)"?/i.exec(headerValue);
  return filenameMatch?.[1]?.trim() || fallback;
}

export function isAllowedUploadFile(file: File): boolean {
  const extension = extensionOf(file.name);
  return ALLOWED_UPLOAD_EXTENSIONS.has(extension) && ALLOWED_UPLOAD_CONTENT_TYPES.has(file.type);
}

export function uploadFileTypeMessage(file: File): string {
  const extension = extensionOf(file.name) || '(none)';
  const contentType = file.type || '(empty)';
  return `This file type is not allowed for MVP0 upload. Extension: ${extension}; content type: ${contentType}.`;
}

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.zip',
  '.txt',
  '.md',
]);

export const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'application/zip',
  'text/plain',
  'text/markdown',
]);

function toScanStatus(scanStatus: unknown, status: unknown): FileScanStatus {
  const normalizedScan = String(scanStatus ?? '').toLowerCase();
  if (normalizedScan === 'pending') {
    return 'pending';
  }

  if (['infected', 'failed', 'blocked', 'quarantined'].includes(normalizedScan)) {
    return 'blocked';
  }

  if (['clean', 'skipped', 'allowed'].includes(normalizedScan)) {
    return 'allowed';
  }

  const normalizedStatus = String(status ?? '').toLowerCase();
  if (normalizedStatus === 'quarantined') {
    return 'blocked';
  }

  return normalizedScan ? 'unavailable' : 'allowed';
}

function isActiveStatus(status: unknown): boolean {
  const normalized = String(status ?? 'active').toLowerCase();
  return normalized === 'active';
}

function fileKind(fileName: string, contentType: string): FileKind {
  const extension = extensionOf(fileName);
  if (extension === '.svg' || contentType === 'image/svg+xml') {
    return 'svg';
  }

  if (contentType.startsWith('image/')) {
    return 'image';
  }

  if (contentType === 'application/pdf') {
    return 'pdf';
  }

  if (extension === '.zip' || contentType === 'application/zip') {
    return 'zip';
  }

  if (contentType.startsWith('video/')) {
    return 'video';
  }

  return 'document';
}

function extensionOf(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatDate(value: unknown): string {
  const raw = stringValue(value);
  return raw ? new Date(raw).toLocaleString() : '';
}
