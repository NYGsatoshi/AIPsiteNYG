import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { AppDataGridComponent } from '../../../shared/grid/app-data-grid/app-data-grid.component';
import { AIP_FILES_PAGE_MOCK } from '../files.facade';
import { DEFAULT_FILES, FILES_PAGE_SCENARIOS } from '../files.mock';
import { FileViewModel } from '../files.types';
import { FilesPageComponent } from './files-page.component';

const renderFilesPage = async (): Promise<ComponentFixture<FilesPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [FilesPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AIP_FILES_PAGE_MOCK, useValue: FILES_PAGE_SCENARIOS.default },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(FilesPageComponent);
  fixture.detectChanges();
  return fixture;
};

describe('FilesPageComponent issue #337', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('keeps the default file list focused on the primary columns', async () => {
    const fixture = await renderFilesPage();

    expect(fixture.componentInstance.columns().map((column) => column.headerName)).toEqual([
      'Name',
      'Modified',
      'Owner',
      'Status',
    ]);
    expect(fixture.componentInstance.isColumnVisible('type')).toBe(false);
    expect(fixture.componentInstance.isColumnVisible('size')).toBe(false);
    expect(fixture.componentInstance.isColumnVisible('scan')).toBe(false);
  });

  it('adds and removes secondary columns without changing the primary set', async () => {
    const fixture = await renderFilesPage();
    const component = fixture.componentInstance;

    component.toggleColumn('type', true);
    component.toggleColumn('size', true);
    fixture.detectChanges();

    expect(component.columns().map((column) => column.headerName)).toEqual([
      'Name',
      'Modified',
      'Owner',
      'Status',
      'Type',
      'Size',
    ]);

    component.toggleColumn('type', false);
    fixture.detectChanges();

    expect(component.columns().map((column) => column.headerName)).toEqual([
      'Name',
      'Modified',
      'Owner',
      'Status',
      'Size',
    ]);
  });

  it('separates opening a file from checkbox selection and keyboard focus', async () => {
    const fixture = await renderFilesPage();
    const file = DEFAULT_FILES[0];
    if (!file) {
      throw new Error('Expected the default file fixture.');
    }

    const grid = fixture.debugElement.query(By.directive(AppDataGridComponent))
      .componentInstance as AppDataGridComponent<FileViewModel>;
    const nameColumn = fixture.componentInstance.columns()[0];
    const actions = nameColumn?.actions?.(file) ?? [];
    const fallbackRenderer = grid.columnDefs[0]?.cellRenderer;

    expect(actions.map((action) => action.id)).toEqual(['open']);
    expect(typeof fallbackRenderer).toBe('function');
    if (typeof fallbackRenderer !== 'function') {
      throw new Error('Expected the AG Grid fallback action renderer.');
    }
    const renderedAction = fallbackRenderer({ data: file }) as HTMLElement;
    expect(renderedAction.querySelector('[data-grid-action="open"]')?.textContent).toBe(file.originalFileName);
    expect(grid.selectionMode).toBe('multiple');
    expect(grid.rowSelection).toMatchObject({
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false,
    });
    expect(grid.gridOptions.suppressCellFocus).toBe(false);
  });

  it('changes row density without changing selection state', async () => {
    const fixture = await renderFilesPage();
    const file = DEFAULT_FILES[0];
    if (!file) {
      throw new Error('Expected the default file fixture.');
    }

    const component = fixture.componentInstance;
    component.handleSelectionChanged({ rows: [file] });
    component.setDensity('compact');
    fixture.detectChanges();

    const grid = fixture.debugElement.query(By.directive(AppDataGridComponent))
      .componentInstance as AppDataGridComponent<FileViewModel>;
    const compactButton = (fixture.nativeElement as HTMLElement)
      .querySelector('.files-page__density button:nth-child(2)');

    expect(component.selectedCount()).toBe(1);
    expect(grid.rowHeight).toBe(36);
    expect(compactButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps each grid page bounded when the data source contains more than 1,000 rows', async () => {
    const fixture = await renderFilesPage();
    const grid = fixture.debugElement.query(By.directive(AppDataGridComponent))
      .componentInstance as AppDataGridComponent<FileViewModel>;
    const seed = DEFAULT_FILES[0];
    if (!seed) {
      throw new Error('Expected the default file fixture.');
    }

    grid.rows = Array.from({ length: 1_001 }, (_, index) => ({
      ...seed,
      id: `attachment-${index}`,
      canonicalFileId: `file-object-${index}`,
      originalFileName: `file-${index}.pdf`,
    }));

    expect(grid.rowData).toHaveLength(1_001);
    expect(grid.boundedPageSize).toBe(50);
    expect(grid.maximumPageSize).toBe(100);
  });
});
