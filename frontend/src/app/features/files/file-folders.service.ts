import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, concatMap, finalize, forkJoin, from, map, of, switchMap, throwError, toArray } from 'rxjs';

export interface FileFolderViewModel {
  readonly id: string;
  readonly workspaceId: string;
  readonly parentFolderId: string | null;
  readonly name: string;
  readonly sortOrder: number;
  readonly version: number;
}

export interface FileFolderTreeNode {
  readonly id: string;
  readonly name: string;
  readonly children: readonly FileFolderTreeNode[];
}

@Injectable({ providedIn: 'root' })
export class FileFolderStore {
  private readonly http = inject(HttpClient);
  private readonly folderState = signal<readonly FileFolderViewModel[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal(false);
  private generation = 0;
  private workspaceId: string | null = null;

  readonly folders = this.folderState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly failed = this.errorState.asReadonly();
  readonly tree = computed<readonly FileFolderTreeNode[]>(() => buildFolderTree(this.folderState()));

  load(workspaceId: string | null | undefined): void {
    const generation = ++this.generation;
    this.workspaceId = workspaceId || null;
    this.errorState.set(false);
    if (!workspaceId) {
      this.folderState.set([]);
      this.loadingState.set(false);
      return;
    }

    this.loadingState.set(true);
    const params = new HttpParams().set('workspaceId', workspaceId);
    this.http.get<unknown>('/api/file-folders', { params, withCredentials: true }).pipe(
      map((response) => mapFolderList(response, workspaceId)),
      catchError(() => of(null)),
      finalize(() => {
        if (generation === this.generation) {
          this.loadingState.set(false);
        }
      }),
    ).subscribe((folders) => {
      if (generation !== this.generation || workspaceId !== this.workspaceId) {
        return;
      }
      if (!folders) {
        this.folderState.set([]);
        this.errorState.set(true);
        return;
      }
      this.folderState.set(folders);
    });
  }

  moveFiles(fileObjectIds: readonly string[], destinationFolderId: string | null): Observable<void> {
    const workspaceId = this.workspaceId;
    const ids = [...new Set(fileObjectIds.filter((id) => id.length > 0))];
    if (!workspaceId || ids.length === 0) {
      return throwError(() => new Error('File move context is unavailable.'));
    }
    if (destinationFolderId && !this.folderState().some((folder) => folder.id === destinationFolderId)) {
      return throwError(() => new Error('Destination folder is unavailable.'));
    }

    return forkJoin(ids.map((fileObjectId) =>
      this.http.get<unknown>(`/api/files/${encodeURIComponent(fileObjectId)}/location`, { withCredentials: true }).pipe(
        map((response) => mapLocation(response, fileObjectId, workspaceId)),
      ))).pipe(
      switchMap((locations) => from(locations).pipe(
        concatMap((location) => this.http.post<unknown>(
          `/api/files/${encodeURIComponent(location.fileObjectId)}/move`,
          {
            destinationFolderId,
            expectedVersion: location.version,
          },
          { withCredentials: true },
        )),
        toArray(),
      )),
      map(() => undefined),
      finalize(() => this.load(workspaceId)),
    );
  }

  moveFolder(folderId: string, destinationParentFolderId: string | null): Observable<void> {
    const workspaceId = this.workspaceId;
    const source = this.folderState().find((folder) => folder.id === folderId);
    if (!workspaceId || !source) {
      return throwError(() => new Error('Folder move context is unavailable.'));
    }
    if (destinationParentFolderId === folderId) {
      return throwError(() => new Error('A folder cannot be moved into itself.'));
    }
    if (destinationParentFolderId && !this.folderState().some((folder) => folder.id === destinationParentFolderId)) {
      return throwError(() => new Error('Destination folder is unavailable.'));
    }

    return this.http.post<unknown>(
      `/api/file-folders/${encodeURIComponent(folderId)}/move`,
      {
        destinationParentFolderId,
        expectedVersion: source.version,
      },
      { withCredentials: true },
    ).pipe(
      map(() => undefined),
      finalize(() => this.load(workspaceId)),
    );
  }
}

function mapFolderList(response: unknown, workspaceId: string): readonly FileFolderViewModel[] | null {
  if (!Array.isArray(response)) {
    return null;
  }
  const folders: FileFolderViewModel[] = [];
  for (const item of response) {
    const folder = mapFolder(item, workspaceId);
    if (!folder) {
      return null;
    }
    folders.push(folder);
  }
  return folders.sort((left, right) =>
    left.sortOrder - right.sortOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function mapFolder(value: unknown, workspaceId: string): FileFolderViewModel | null {
  if (!isObject(value)) {
    return null;
  }
  const id = stringValue(value['id']);
  const responseWorkspaceId = stringValue(value['workspaceId']);
  const parentFolderId = nullableStringValue(value['parentFolderId']);
  const name = stringValue(value['name']);
  const sortOrder = nonNegativeInteger(value['sortOrder']);
  const version = positiveInteger(value['version']);
  if (!id || responseWorkspaceId !== workspaceId || parentFolderId === undefined || !name || sortOrder === undefined || version === undefined) {
    return null;
  }
  return { id, workspaceId, parentFolderId, name, sortOrder, version };
}

function mapLocation(response: unknown, fileObjectId: string, workspaceId: string): {
  readonly fileObjectId: string;
  readonly version: number;
} {
  if (!isObject(response) || stringValue(response['fileObjectId']) !== fileObjectId ||
    stringValue(response['workspaceId']) !== workspaceId) {
    throw new Error('Invalid file location response.');
  }
  const version = nonNegativeInteger(response['version']);
  if (version === undefined) {
    throw new Error('Invalid file location version.');
  }
  return { fileObjectId, version };
}

function buildFolderTree(folders: readonly FileFolderViewModel[]): readonly FileFolderTreeNode[] {
  const byParent = new Map<string | null, FileFolderViewModel[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentFolderId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentFolderId, siblings);
  }
  const visited = new Set<string>();
  const build = (parentFolderId: string | null): readonly FileFolderTreeNode[] => {
    const result: FileFolderTreeNode[] = [];
    for (const folder of byParent.get(parentFolderId) ?? []) {
      if (visited.has(folder.id)) {
        continue;
      }
      visited.add(folder.id);
      result.push({ id: folder.id, name: folder.name, children: build(folder.id) });
    }
    return result;
  };
  return build(null);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nullableStringValue(value: unknown): string | null | undefined {
  return value === null ? null : stringValue(value);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
