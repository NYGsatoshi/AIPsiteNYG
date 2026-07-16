import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AipDataGridComponent } from './aip-adapter-shells.components';

@Component({
  standalone: true,
  imports: [AipDataGridComponent],
  template: '<aip-data-grid [contract]="contract" presentation="narrow" state="degraded" />'
})
class AdapterShellHostComponent {
  readonly contract = {
    ariaLabel: 'Members',
    columns: [],
    page: 1,
    pageSize: 25,
    presentation: 'desktop' as const,
    rowIdentity: (row: object) => JSON.stringify(row),
    rows: [],
    state: 'ready' as const
  };
}

describe('AIPsite complex adapter shells', () => {
  it('renders stable AIPsite selectors and consumes theme/density context without vendor DOM', async () => {
    document.documentElement.dataset['aipTheme'] = 'light';
    document.documentElement.dataset['aipDensity'] = 'comfortable';
    await TestBed.configureTestingModule({ imports: [AdapterShellHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AdapterShellHostComponent);
    fixture.detectChanges();

    const shell = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="aip-data-grid-adapter"]');
    expect(shell?.dataset['aipPresentation']).toBe('narrow');
    expect(shell?.dataset['aipState']).toBe('degraded');
    expect(shell?.getAttribute('aria-label')).toBe('Members');
    expect(shell?.querySelector('ejs-grid')).toBeNull();
  });
});
