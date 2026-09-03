import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AipFilterChipComponent } from './aip-filter-chip.component';

describe('AipFilterChipComponent', () => {
  let fixture: ComponentFixture<AipFilterChipComponent>;

  beforeEach(async () => {
    window.localStorage.setItem('aip.locale', 'en');
    await TestBed.configureTestingModule({ imports: [AipFilterChipComponent] }).compileComponents();
    fixture = TestBed.createComponent(AipFilterChipComponent);
    fixture.componentRef.setInput('label', 'Type');
    fixture.componentRef.setInput('value', 'PDF');
    fixture.detectChanges();
  });

  afterEach(() => {
    window.localStorage.removeItem('aip.locale');
    TestBed.resetTestingModule();
  });

  it('exposes a native keyboard-operable removal action with its filter context', () => {
    const removed = vi.fn();
    fixture.componentInstance.removed.subscribe(removed);
    const button = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;

    expect(button.getAttribute('aria-label')).toBe('Remove filter Type: PDF');
    button.click();
    expect(removed).toHaveBeenCalledOnce();
  });
});
