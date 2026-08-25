import { TestBed } from '@angular/core/testing';
import type { CellClickedEvent } from 'ag-grid-community';

import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';
import { AppDataGridComponent } from './app-data-grid.component';

interface TestRow {
  readonly id: string;
  readonly label: string;
}

describe('AppDataGrid adapter options', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('uses the bounded AG scroll surface and emits a row activation with its focus trigger', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: FrontendFeatureFlagsService, useValue: { syncfusionGridEnabled: () => false } }],
    });
    const component = TestBed.runInInjectionContext(() => new AppDataGridComponent<TestRow>());
    component.stickyHeader = true;
    const activations: unknown[] = [];
    component.rowActivated.subscribe((event) => activations.push(event));
    const cell = document.createElement('div');
    cell.className = 'ag-cell';
    document.body.append(cell);

    component.handleCellClicked({
      data: { id: 'ag-row', label: 'AG row' },
      event: { target: cell } as unknown as Event,
    } as CellClickedEvent<TestRow>);

    expect(component.gridOptions.domLayout).toBe('normal');
    expect(component.gridOptions).toBe(component.gridOptions);
    expect(activations).toEqual([{
      row: { id: 'ag-row', label: 'AG row' },
      trigger: cell,
    }]);
    cell.remove();
  });

  it('does not activate a row when its disabled AG action is clicked', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: FrontendFeatureFlagsService, useValue: { syncfusionGridEnabled: () => false } }],
    });
    const component = TestBed.runInInjectionContext(() => new AppDataGridComponent<TestRow>());
    const actions: unknown[] = [];
    const activations: unknown[] = [];
    component.actionInvoked.subscribe((event) => actions.push(event));
    component.rowActivated.subscribe((event) => activations.push(event));
    const action = document.createElement('button');
    action.dataset['gridAction'] = 'openAuditDetail';
    action.setAttribute('aria-disabled', 'true');
    document.body.append(action);

    component.handleCellClicked({
      data: { id: 'ag-row', label: 'AG row' },
      event: { target: action } as unknown as Event,
    } as CellClickedEvent<TestRow>);

    expect(actions).toEqual([]);
    expect(activations).toEqual([]);
    action.remove();
  });
});
