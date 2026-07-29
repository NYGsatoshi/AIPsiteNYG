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

  it('opens the reason-required move form for a Cancelled drop and emits the preserved drag intent only after a reason is entered', async () => {
    await TestBed.configureTestingModule({ imports: [AipKanbanComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AipKanbanComponent);
    const moving = { id: 'task-1', stage: 'stage-todo', order: 1000, canMove: true };
    const cancelledNeighbor = { id: 'task-cancelled', stage: 'stage-cancelled', order: 2000, canMove: true };
    fixture.componentInstance.contract = { ...kanbanContract(), items: [moving, cancelledNeighbor] };
    const moves: AipKanbanMoveRequest<object>[] = [];
    const interactionStates: boolean[] = [];
    fixture.componentInstance.moveRequested.subscribe((value) => moves.push(value));
    fixture.componentInstance.interactionActiveChange.subscribe((value) => interactionStates.push(value));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLElement>('[data-kanban-card-id="task-1"]')!
      .dispatchEvent(new Event('dragstart', { bubbles: true }));
    host.querySelector<HTMLElement>('[data-kanban-card-id="task-cancelled"]')!
      .dispatchEvent(dropEvent());
    fixture.detectChanges();

    const form = host.querySelector<HTMLFormElement>('.aip-kanban__move')!;
    const selects = form.querySelectorAll<HTMLSelectElement>('select');
    const reason = form.querySelector<HTMLTextAreaElement>('textarea')!;
    const apply = Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Apply move')!;
    expect(moves).toEqual([]);
    expect(fixture.componentInstance.movingItemId).toBe('task-1');
    expect(selects[0].value).toBe('stage-cancelled');
    expect(selects[1].value).toBe('before:task-cancelled');
    expect(reason.required).toBe(true);
    expect(reason.value).toBe('');
    expect(apply.disabled).toBe(true);
    expect(interactionStates.at(-1)).toBe(true);

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(moves).toEqual([]);
    expect(fixture.componentInstance.movingItemId).toBe('task-1');
    expect(interactionStates.at(-1)).toBe(true);

    reason.value = '  Superseded by the approved approach.  ';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(apply.disabled).toBe(false);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      item: moving,
      targetStatus: 'stage-cancelled',
      targetBeforeItemId: 'task-cancelled',
      targetAfterItemId: null,
      reason: 'Superseded by the approved approach.',
      source: 'drag'
    });
    expect(interactionStates.at(-1)).toBe(false);
  });

  it('keeps a reason-required drag active until Escape or Cancel and restores focus without emitting a command', async () => {
    await TestBed.configureTestingModule({ imports: [AipKanbanComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AipKanbanComponent);
    fixture.componentInstance.contract = kanbanContract();
    const moves: AipKanbanMoveRequest<object>[] = [];
    const interactionStates: boolean[] = [];
    fixture.componentInstance.moveRequested.subscribe((value) => moves.push(value));
    fixture.componentInstance.interactionActiveChange.subscribe((value) => interactionStates.push(value));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLElement>('[data-kanban-card-id="task-1"]')!;
    const cancelledColumn = Array.from(host.querySelectorAll<HTMLElement>('.aip-kanban__column'))
      .find((column) => column.querySelector('h3')?.textContent?.trim() === 'Cancelled')!;
    card.dispatchEvent(new Event('dragstart', { bubbles: true }));
    cancelledColumn.dispatchEvent(dropEvent());
    card.dispatchEvent(new Event('dragend', { bubbles: true }));
    fixture.detectChanges();
    expect(interactionStates.at(-1)).toBe(true);

    host.querySelector<HTMLFormElement>('.aip-kanban__move')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await Promise.resolve();

    expect(moves).toEqual([]);
    expect(host.querySelector('.aip-kanban__move')).toBeNull();
    expect(document.activeElement).toBe(card);
    expect(interactionStates.at(-1)).toBe(false);

    card.dispatchEvent(new Event('dragstart', { bubbles: true }));
    cancelledColumn.dispatchEvent(dropEvent());
    fixture.detectChanges();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.aip-kanban__move button'))
      .find((button) => button.textContent?.trim() === 'Cancel')!.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(moves).toEqual([]);
    expect(host.querySelector('.aip-kanban__move')).toBeNull();
    expect(document.activeElement).toBe(card);
    expect(interactionStates.at(-1)).toBe(false);
  });

  it('emits a reason-free pointer drop directly with the canonical end-of-Stage intent', async () => {
    await TestBed.configureTestingModule({ imports: [AipKanbanComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AipKanbanComponent);
    fixture.componentInstance.contract = kanbanContract();
    let move: AipKanbanMoveRequest<object> | undefined;
    fixture.componentInstance.moveRequested.subscribe((value) => move = value);
    fixture.detectChanges();

    const moving = fixture.componentInstance.contract.items[0];
    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLElement>('[data-kanban-card-id="task-1"]')!;
    const doneColumn = Array.from(host.querySelectorAll<HTMLElement>('.aip-kanban__column'))
      .find((column) => column.querySelector('h3')?.textContent?.trim() === 'Done')!;
    card.dispatchEvent(new Event('dragstart', { bubbles: true }));
    doneColumn.dispatchEvent(dropEvent());
    fixture.detectChanges();

    expect(move).toMatchObject({
      item: moving,
      targetStatus: 'stage-done',
      targetBeforeItemId: null,
      targetAfterItemId: null,
      reason: null,
      source: 'drag'
    });
    expect((fixture.nativeElement as HTMLElement).querySelector('.aip-kanban__move')).toBeNull();
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

  it('uses canonical Stage rank for start and before while End stays null/null for a truncated presentation', async () => {
    await TestBed.configureTestingModule({ imports: [AipKanbanComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AipKanbanComponent);
    const moving = { id: 'task-1', stage: 'stage-todo', order: 1000, lane: 'Moving', canMove: true };
    const rankFirst = { id: 'task-2', stage: 'stage-done', order: 1000, lane: 'Zulu', canMove: true };
    const rankSecond = { id: 'task-3', stage: 'stage-done', order: 2000, lane: 'Alpha', canMove: true };
    const base = kanbanContract();
    fixture.componentInstance.contract = {
      ...base,
      items: [moving, rankFirst, rankSecond],
      columns: base.columns.map((column) =>
        column.id === 'stage-done' ? { ...column, cardCount: 500 } : column),
      itemIdentity: (item) => String((item as typeof moving).id),
      itemStatus: (item) => String((item as typeof moving).stage),
      itemOrder: (item) => Number((item as typeof moving).order),
      itemSwimlane: (item) => {
        const lane = String((item as typeof moving).lane);
        return { key: lane, label: lane };
      }
    };
    const moves: AipKanbanMoveRequest<object>[] = [];
    fixture.componentInstance.moveRequested.subscribe((value) => moves.push(value));
    fixture.detectChanges();

    fixture.componentInstance.openMove(moving);
    fixture.componentInstance.changeTarget('stage-done');
    fixture.componentInstance.movePosition = 'end';
    fixture.componentInstance.submitMove(moving, submitEvent());

    fixture.componentInstance.openMove(moving);
    fixture.componentInstance.changeTarget('stage-done');
    fixture.componentInstance.movePosition = 'start';
    fixture.componentInstance.submitMove(moving, submitEvent());

    fixture.componentInstance.openMove(moving);
    fixture.componentInstance.changeTarget('stage-done');
    fixture.componentInstance.movePosition = 'before:task-3';
    fixture.componentInstance.submitMove(moving, submitEvent());

    expect(moves).toHaveLength(3);
    expect(moves[0]).toMatchObject({
      targetBeforeItemId: null,
      targetAfterItemId: null,
      source: 'keyboard'
    });
    expect(moves[1]).toMatchObject({
      targetBeforeItemId: 'task-2',
      targetAfterItemId: null,
      source: 'keyboard'
    });
    expect(moves[2]).toMatchObject({
      targetBeforeItemId: 'task-3',
      targetAfterItemId: null,
      source: 'keyboard'
    });
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
      { id: 'stage-done', label: 'Done', category: 'done', cardCount: 0, wipWarningLimit: null, hasWipWarning: false },
      { id: 'stage-cancelled', label: 'Cancelled', category: 'cancelled', cardCount: 0, wipWarningLimit: null, hasWipWarning: false, requiresReason: true }
    ]
  };
}

function dropEvent(): DragEvent {
  return new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
}

function submitEvent(): Event {
  return new Event('submit', { bubbles: true, cancelable: true });
}
