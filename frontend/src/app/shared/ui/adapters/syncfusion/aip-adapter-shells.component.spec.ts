import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AipKanbanContract, AipKanbanMoveRequest } from '../../contracts/aip-complex-adapter.contracts';
import { AipDataGridComponent, AipKanbanComponent } from './aip-adapter-shells.components';

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

  it('uses the same vendor-neutral move intent for keyboard ordering and keeps detail activation separate', async () => {
    await TestBed.configureTestingModule({ imports: [AipKanbanComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AipKanbanComponent);
    fixture.componentInstance.contract = kanbanContract();
    let move: AipKanbanMoveRequest<object> | undefined;
    let opened: object | undefined;
    fixture.componentInstance.moveRequested.subscribe((value) => move = value);
    fixture.componentInstance.itemActivated.subscribe((value) => opened = value);
    fixture.detectChanges();

    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'));
    buttons.find((button) => button.textContent?.includes('Open details'))!.click();
    buttons.find((button) => button.textContent?.trim() === 'Move')!.click();
    fixture.detectChanges();
    const selects = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLSelectElement>('.aip-kanban__move select');
    selects[0].value = 'stage-done';
    selects[0].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('.aip-kanban__move')!
      .dispatchEvent(new Event('submit'));

    expect(opened).toMatchObject({ id: 'task-1' });
    expect(move).toMatchObject({
      targetStatus: 'stage-done',
      targetBeforeItemId: null,
      targetAfterItemId: null,
      source: 'keyboard'
    });
  });

  it('restores logical card focus and renders narrow grouped columns without exposing a vendor element', async () => {
    await TestBed.configureTestingModule({ imports: [AipKanbanComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AipKanbanComponent);
    fixture.componentInstance.presentation = 'narrow';
    fixture.componentInstance.contract = { ...kanbanContract(), focusItemId: 'task-1' };
    fixture.detectChanges();
    await Promise.resolve();

    const board = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="aip-kanban-board"]');
    const card = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-kanban-card-id="task-1"]');
    expect(board?.classList.contains('aip-kanban--narrow')).toBe(true);
    expect(board?.querySelector('.aip-kanban__swimlane')?.textContent).toContain('Unassigned');
    expect(card?.tabIndex).toBe(0);
    expect(document.activeElement).toBe(card);
    expect(board?.querySelector('ejs-kanban')).toBeNull();
  });

  it('cancels the keyboard move with Escape, restores focus, and hides denied move actions', async () => {
    await TestBed.configureTestingModule({ imports: [AipKanbanComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AipKanbanComponent);
    fixture.componentInstance.contract = kanbanContract();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Move')!.click();
    fixture.detectChanges();
    host.querySelector<HTMLFormElement>('.aip-kanban__move')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await Promise.resolve();

    const card = host.querySelector<HTMLElement>('[data-kanban-card-id="task-1"]');
    expect(host.querySelector('.aip-kanban__move')).toBeNull();
    expect(document.activeElement).toBe(card);

    fixture.componentRef.setInput('contract', { ...kanbanContract(), canMoveItem: () => false });
    fixture.detectChanges();
    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Move')).toBe(false);
  });

  it('uses Stage rank rather than swimlane label order for neighbor intents', async () => {
    await TestBed.configureTestingModule({ imports: [AipKanbanComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AipKanbanComponent);
    const moving = { id: 'task-1', stage: 'stage-todo', order: 1000, lane: 'Moving' };
    const rankFirst = { id: 'task-2', stage: 'stage-done', order: 1000, lane: 'Zulu' };
    const rankSecond = { id: 'task-3', stage: 'stage-done', order: 2000, lane: 'Alpha' };
    fixture.componentInstance.contract = {
      ...kanbanContract(),
      items: [moving, rankFirst, rankSecond],
      itemIdentity: (item) => String((item as typeof moving).id),
      itemStatus: (item) => String((item as typeof moving).stage),
      itemOrder: (item) => Number((item as typeof moving).order),
      itemSwimlane: (item) => {
        const lane = String((item as typeof moving).lane);
        return { key: lane, label: lane };
      }
    };
    fixture.componentInstance.moveTargetStatus = 'stage-done';

    expect(fixture.componentInstance.positionItems(moving).map((item) => (item as typeof moving).id))
      .toEqual(['task-2', 'task-3']);
  });
});

function kanbanContract(): AipKanbanContract<object> {
  const task = { id: 'task-1', stage: 'stage-todo', order: 1000, canMove: true };
  return {
    ariaLabel: 'Project board',
    presentation: 'desktop',
    state: 'ready',
    items: [task],
    itemIdentity: (item) => String((item as typeof task).id),
    itemTitle: () => 'Task one',
    itemStatus: (item) => String((item as typeof task).stage),
    itemOrder: (item) => Number((item as typeof task).order),
    itemDescription: () => 'Priority: High',
    itemMetadata: () => ['Not blocked'],
    itemKindLabel: () => 'Actionable leaf task',
    itemSwimlane: () => ({ key: 'unassigned', label: 'Unassigned' }),
    canOpenItem: () => true,
    canMoveItem: (item) => Boolean((item as typeof task).canMove),
    canRequestTransition: () => true,
    columns: [
      { id: 'stage-todo', label: 'Todo', category: 'todo', cardCount: 1, wipWarningLimit: null, hasWipWarning: false },
      { id: 'stage-done', label: 'Done', category: 'done', cardCount: 0, wipWarningLimit: null, hasWipWarning: false }
    ]
  };
}
