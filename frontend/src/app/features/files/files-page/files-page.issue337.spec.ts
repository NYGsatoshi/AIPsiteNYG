import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AIP_FILES_PAGE_MOCK } from '../files.facade';
import { FILES_PAGE_SCENARIOS } from '../files.mock';
import { FilesPageComponent } from './files-page.component';

describe('FilesPageComponent issue #337', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows only the primary file-list columns by default', async () => {
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

    expect(fixture.componentInstance.columns().map((column) => column.headerName)).toEqual([
      'Name',
      'Modified',
      'Owner',
      'Status',
    ]);
  });

  it('adds and removes auxiliary columns without changing the primary set', async () => {
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

    fixture.componentInstance.toggleColumn('size', true);
    expect(fixture.componentInstance.columns().map((column) => column.headerName)).toContain('Size');

    fixture.componentInstance.toggleColumn('size', false);
    expect(fixture.componentInstance.columns().map((column) => column.headerName)).not.toContain('Size');
  });

  it('tracks density and checkbox selection independently', async () => {
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

    fixture.componentInstance.setDensity('compact');
    fixture.componentInstance.handleSelectionChanged({ rows: FILES_PAGE_SCENARIOS.default.recentFiles.slice(0, 1) });

    expect(fixture.componentInstance.density()).toBe('compact');
    expect(fixture.componentInstance.selectedCount()).toBe(1);
  });
});
