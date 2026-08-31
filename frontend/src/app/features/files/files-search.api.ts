import { HttpParams } from '@angular/common/http';

import { FileDisplayLocalizer, FileListItemDto, mapFileListItem } from './files.api';
import { FileSearchFilters, FileSearchPage } from './files.types';

interface FileSearchResponseDto {
  readonly page?: unknown;
  readonly pageSize?: unknown;
  readonly totalCount?: unknown;
  readonly items?: unknown;
}

interface FileSearchItemDto {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly title?: unknown;
  readonly workspaceId?: unknown;
  readonly createdAt?: unknown;
  readonly authorDisplayName?: unknown;
  readonly contentType?: unknown;
  readonly sizeBytes?: unknown;
  readonly status?: unknown;
  readonly scanStatus?: unknown;
  readonly updatedAt?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function fileSearchParams(
  workspaceId: string,
  filters: FileSearchFilters,
  page: number,
  pageSize: number,
  currentUserId: string | null,
  now = new Date(),
): HttpParams {
  let params = new HttpParams()
    .set('type', 'File')
    .set('workspaceId', workspaceId)
    .set('page', Math.max(1, Math.floor(page)))
    .set('pageSize', Math.max(1, Math.min(50, Math.floor(pageSize))));

  const query = filters.query.trim();
  if (query) {
    params = params.set('q', query);
  }
  if (filters.kind !== 'all') {
    params = params.set('fileKind', backendFileKind(filters.kind));
  }
  if (filters.modified !== 'any') {
    params = params.set('fromDate', fileSearchFromDate(filters.modified, now)!);
  }
  if (filters.owner === 'me' && currentUserId) {
    params = params.set('authorUserId', currentUserId);
  }
  return params;
}

/** The capture request reuses the exact relative-date boundary used by search. */
export function fileSearchFromDate(
  modified: FileSearchFilters['modified'],
  now = new Date(),
): string | undefined {
  if (modified === 'any') {
    return undefined;
  }

  const days = modified === 'last7Days' ? 7 : modified === 'last30Days' ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Parameters accepted by the server-owned all-search-results snapshot endpoint. */
export function fileSearchSelectionSnapshotParams(
  workspaceId: string,
  filters: FileSearchFilters,
  fromDate?: string,
): HttpParams {
  let params = new HttpParams().set('workspaceId', workspaceId);
  const query = filters.query.trim();
  if (query) {
    params = params.set('q', query);
  }
  if (filters.kind !== 'all') {
    params = params.set('fileKind', backendFileKind(filters.kind));
  }
  if (fromDate) {
    params = params.set('fromDate', fromDate);
  }
  if (filters.owner === 'me') {
    params = params.set('onlyMyUploads', 'true');
  }
  return params;
}

export function mapFileSearchResponse(
  value: unknown,
  expectedWorkspaceId: string,
  displayLocalizer: FileDisplayLocalizer,
): FileSearchPage | null {
  if (!isObject(value)) {
    return null;
  }

  const response = value as FileSearchResponseDto;
  const items = response.items;
  if (!Array.isArray(items)) {
    return null;
  }
  const page = positiveInteger(response.page);
  const pageSize = positiveInteger(response.pageSize);
  const totalCount = nonNegativeInteger(response.totalCount);
  if (!page || !pageSize || totalCount === null || pageSize > 50) {
    return null;
  }

  const expected = uuid(expectedWorkspaceId);
  if (!expected) {
    return null;
  }

  const files = [];
  for (const candidate of items) {
    const item = mapFileSearchItem(candidate, expected, displayLocalizer);
    if (!item) {
      return null;
    }
    files.push(item);
  }

  if (files.length > pageSize || totalCount < files.length) {
    return null;
  }

  return { files, page, pageSize, totalCount, hasMore: page * pageSize < totalCount };
}

function mapFileSearchItem(
  value: unknown,
  expectedWorkspaceId: string,
  displayLocalizer: FileDisplayLocalizer,
) {
  if (!isObject(value)) {
    return null;
  }
  const item = value as FileSearchItemDto;
  const type = typeof item.type === 'string' ? item.type.toLowerCase() : item.type;
  const fileObjectId = uuid(item.id);
  const workspaceId = uuid(item.workspaceId);
  const title = nonEmptyString(item.title);
  const contentType = nonEmptyString(item.contentType);
  const status = nonEmptyString(item.status);
  const createdAt = isoDate(item.createdAt);
  const updatedAt = item.updatedAt == null ? undefined : isoDate(item.updatedAt);
  const sizeBytes = nonNegativeNumber(item.sizeBytes);

  if (
    (type !== 13 && type !== 'file') ||
    !fileObjectId ||
    workspaceId !== expectedWorkspaceId ||
    !title ||
    !contentType ||
    !status ||
    !createdAt ||
    (item.updatedAt != null && !updatedAt) ||
    sizeBytes === null
  ) {
    return null;
  }

  const dto: FileListItemDto = {
    id: fileObjectId,
    fileObjectId,
    workspaceId,
    originalFileName: title,
    contentType,
    sizeBytes,
    status,
    scanStatus: nonEmptyString(item.scanStatus),
    uploadedByDisplayName: nonEmptyString(item.authorDisplayName),
    createdAt,
    updatedAt,
    // Search is a read surface. A mutation capability must come from the
    // canonical inventory projection, never be inferred from a result row.
    canDelete: false,
  };
  return mapFileListItem(dto, displayLocalizer);
}

function backendFileKind(kind: Exclude<FileSearchFilters['kind'], 'all'>): string {
  return kind[0]?.toUpperCase() + kind.slice(1);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function uuid(value: unknown): string | undefined {
  const normalized = nonEmptyString(value)?.toLowerCase();
  return normalized && UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function isoDate(value: unknown): string | undefined {
  const raw = nonEmptyString(value);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : undefined;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
