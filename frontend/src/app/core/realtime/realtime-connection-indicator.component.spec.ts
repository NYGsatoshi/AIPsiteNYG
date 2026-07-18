import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RealtimeConnectionIndicatorComponent } from './realtime-connection-indicator.component';

describe('RealtimeConnectionIndicatorComponent', () => {
  let fixture: ComponentFixture<RealtimeConnectionIndicatorComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RealtimeConnectionIndicatorComponent] });
    fixture = TestBed.createComponent(RealtimeConnectionIndicatorComponent);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('uses a restrained aria-live announcement for each canonical state', () => {
    fixture.componentRef.setInput('state', 'Reconnecting');
    fixture.detectChanges();
    const indicator = fixture.nativeElement.querySelector('[data-testid="realtime-connection-state"]') as HTMLElement;

    expect(indicator.getAttribute('aria-live')).toBe('polite');
    expect(indicator.textContent).toContain('Reconnecting realtime updates.');

    fixture.componentRef.setInput('state', 'Degraded');
    fixture.detectChanges();
    expect(indicator.textContent).toContain('HTTP and manual refresh remain available.');
  });
});
