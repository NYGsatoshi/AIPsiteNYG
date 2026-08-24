vi.mock('@syncfusion/ej2-angular-grids', async () => {
  const { Directive, Injectable, NgModule } = await import('@angular/core');
  class AggregateColumnDirective {}
  class AggregateColumnsDirective {}
  class AggregateDirective {}
  class AggregatesDirective {}
  class ColumnDirective {}
  class ColumnsDirective {}
  class FilterService {}
  class GridComponent {}
  class GridModule {}
  class PageService {}
  class SelectionService {}
  class StackedColumnDirective {}
  class StackedColumnsDirective {}
  class SortService {}
  Directive({ selector: 'e-aggregate-column' })(AggregateColumnDirective);
  Directive({ selector: 'e-aggregate-columns' })(AggregateColumnsDirective);
  Directive({ selector: 'e-aggregate' })(AggregateDirective);
  Directive({ selector: 'e-aggregates' })(AggregatesDirective);
  Directive({ selector: 'e-column' })(ColumnDirective);
  Directive({ selector: 'e-columns' })(ColumnsDirective);
  Directive({ selector: 'e-stacked-column' })(StackedColumnDirective);
  Directive({ selector: 'e-stacked-columns' })(StackedColumnsDirective);
  Injectable()(FilterService);
  Injectable()(PageService);
  Injectable()(SelectionService);
  Injectable()(SortService);
  NgModule({
    declarations: [
      AggregateColumnDirective,
      AggregateColumnsDirective,
      AggregateDirective,
      AggregatesDirective,
      ColumnDirective,
      ColumnsDirective,
      StackedColumnDirective,
      StackedColumnsDirective,
    ],
  })(GridModule);
  return {
    AggregateColumnDirective,
    AggregateColumnsDirective,
    AggregateDirective,
    AggregatesDirective,
    ColumnDirective,
    ColumnsDirective,
    FilterService,
    GridComponent,
    GridModule,
    PageService,
    SelectionService,
    StackedColumnDirective,
    StackedColumnsDirective,
    SortService,
  };
});

import { SyncfusionDataGridComponent } from './syncfusion-data-grid.component';

interface TestRow {
  readonly id: string;
  readonly label: string;
}

describe('SyncfusionDataGridComponent adapter options', () => {
  it('accepts the adapter-neutral sticky option and emits a row activation with its focus trigger', () => {
    const component = new SyncfusionDataGridComponent<TestRow>();
    component.stickyHeader = true;
    const activations: unknown[] = [];
    component.rowActivated.subscribe((event) => activations.push(event));
    const cell = document.createElement('td');
    cell.className = 'e-rowcell';
    document.body.append(cell);

    component.handleRecordClick({
      rowData: { id: 'syncfusion-row', label: 'Syncfusion row' },
      target: cell,
    });

    expect(component.stickyHeader).toBe(true);
    expect(activations).toEqual([{
      row: { id: 'syncfusion-row', label: 'Syncfusion row' },
      trigger: cell,
    }]);
    cell.remove();
  });
});
