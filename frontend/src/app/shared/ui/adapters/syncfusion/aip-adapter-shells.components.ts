import { AfterViewChecked, ChangeDetectionStrategy, Component, Directive, ElementRef, EventEmitter, Input, Output, inject } from '@angular/core';

import {
  AipAdapterPresentation,
  AipAdapterState,
  AipDataGridContract,
  AipDateTimePickerContract,
  AipDialogContract,
  AipFileUploaderContract,
  AipGanttContract,
  AipKanbanContract,
  AipKanbanMoveRequest,
  AipSchedulerContract,
  AipTreeGridContract
} from '../../contracts/aip-complex-adapter.contracts';
import { AipAdapterShellComponent } from './aip-adapter-shell.component';

@Directive()
abstract class AipAdapterShellInput {
  @Input() presentation: AipAdapterPresentation = 'desktop';
  @Input() state: AipAdapterState = 'ready';
}

@Component({ selector: 'aip-data-grid', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="data-grid" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Data grid fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipDataGridComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipDataGridContract<object>; }

@Component({ selector: 'aip-dialog', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="dialog" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Dialog fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipDialogComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipDialogContract; }

@Component({ selector: 'aip-file-uploader', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="file-uploader" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="File uploader fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipFileUploaderComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipFileUploaderContract; }

@Component({ selector: 'aip-date-time-picker', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="date-time-picker" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Date and time picker fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipDateTimePickerComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipDateTimePickerContract; }

@Component({
  selector: 'aip-kanban', standalone: true, imports: [AipAdapterShellComponent],
  template: `<aip-adapter-shell adapter="kanban" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Kanban">
    <p class="aip-kanban__feedback" aria-live="polite" role="status">{{ contract.feedback }}</p>
    <div class="aip-kanban" [class.aip-kanban--narrow]="presentation === 'narrow'" data-testid="aip-kanban-board">
      @for (column of contract.columns; track column.id) {
        <section class="aip-kanban__column" [attr.aria-label]="column.label + ', ' + column.cardCount + ' cards'" (dragover)="allowDrop($event)" (drop)="dropAtEnd(column.id, $event)">
          <header><h3>{{ column.label }}</h3><span>{{ column.cardCount }} cards</span></header>
          @if (column.hasWipWarning) {
            <p class="aip-kanban__warning" role="status">Warning: WIP limit {{ column.wipWarningLimit }} exceeded.</p>
          }
          @let columnItems = itemsFor(column.id);
          <ul>
            @for (item of columnItems; track contract.itemIdentity(item); let itemIndex = $index) {
              @if (startsSwimlane(columnItems, itemIndex)) {
                <li class="aip-kanban__swimlane" role="presentation"><h4>{{ swimlaneLabel(item) }}</h4></li>
              }
              <li
                class="aip-kanban__card"
                tabindex="0"
                [attr.data-kanban-card-id]="contract.itemIdentity(item)"
                [attr.aria-label]="contract.itemTitle(item) + ', current stage ' + column.label"
                [class.aip-kanban__card--busy]="contract.busyItemId === contract.itemIdentity(item)"
                [draggable]="canDrag(item)"
                (dragstart)="startDrag(item)"
                (dragend)="endDrag()"
                (dragover)="allowDrop($event)"
                (drop)="dropBefore(item, column.id, $event)">
                @if (contract.itemKindLabel) { <span class="aip-kanban__kind">{{ contract.itemKindLabel(item) }}</span> }
                <strong>{{ contract.itemTitle(item) }}</strong>
                @if (contract.itemDescription) { <span>{{ contract.itemDescription(item) }}</span> }
                @if (contract.itemMetadata) {
                  <ul class="aip-kanban__metadata" aria-label="Task indicators">
                    @for (metadata of contract.itemMetadata(item); track metadata) { <li>{{ metadata }}</li> }
                  </ul>
                }
                <div class="aip-kanban__actions">
                  @if (contract.canOpenItem(item)) { <button type="button" (click)="activate(item)">Open details</button> }
                  @if (contract.canMoveItem(item) && contract.busyItemId !== contract.itemIdentity(item)) {
                    <button type="button" [attr.aria-expanded]="movingItemId === contract.itemIdentity(item)" (click)="openMove(item)">Move</button>
                  }
                  @if (contract.busyItemId === contract.itemIdentity(item)) { <span role="status">Saving move…</span> }
                </div>
                @if (movingItemId === contract.itemIdentity(item)) {
                  <form class="aip-kanban__move" (submit)="submitMove(item, $event)" (keydown.escape)="cancelMove(item, $event)">
                    <p>Current stage: <strong>{{ column.label }}</strong></p>
                    <label>Target stage
                      <select [value]="moveTargetStatus" (change)="changeTarget($any($event.target).value)">
                        @for (target of contract.columns; track target.id) {
                          <option [value]="target.id" [selected]="target.id === moveTargetStatus" [disabled]="!contract.canRequestTransition(item, target.id)">{{ target.label }}</option>
                        }
                      </select>
                    </label>
                    <label>Position
                      <select [value]="movePosition" (change)="movePosition = $any($event.target).value">
                        <option value="end" [selected]="movePosition === 'end'">End of stage</option>
                        <option value="start" [selected]="movePosition === 'start'">Start of stage</option>
                        @for (neighbor of positionItems(item); track contract.itemIdentity(neighbor)) {
                          <option [value]="'before:' + contract.itemIdentity(neighbor)" [selected]="movePosition === 'before:' + contract.itemIdentity(neighbor)">Before {{ contract.itemTitle(neighbor) }}</option>
                        }
                      </select>
                    </label>
                    @if (targetRequiresReason()) {
                      <label>Reason<textarea required maxlength="1000" [value]="moveReason" (input)="moveReason = $any($event.target).value"></textarea></label>
                    }
                    <div><button type="submit" [disabled]="targetRequiresReason() && !moveReason.trim()">Apply move</button><button type="button" (click)="cancelMove(item)">Cancel</button></div>
                  </form>
                }
              </li>
            }
          </ul>
        </section>
      }
    </div></aip-adapter-shell>`,
  styleUrl: './aip-adapter-shell.component.scss', changeDetection: ChangeDetectionStrategy.OnPush
})
export class AipKanbanComponent extends AipAdapterShellInput implements AfterViewChecked {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  @Input({ required: true }) contract!: AipKanbanContract<object>;
  @Output() readonly moveRequested = new EventEmitter<AipKanbanMoveRequest<object>>();
  @Output() readonly itemActivated = new EventEmitter<object>();
  @Output() readonly interactionActiveChange = new EventEmitter<boolean>();
  private draggedItem: object | null = null;
  movingItemId: string | null = null;
  moveTargetStatus = '';
  movePosition = 'end';
  moveReason = '';
  private moveSource: 'drag' | 'keyboard' = 'keyboard';
  private restoredFocusId: string | null = null;

  itemsFor(status: string): readonly object[] {
    return [...this.contract.items
      .filter((item) => this.contract.itemStatus(item) === status)]
      .sort((left, right) => {
        const leftLane = this.contract.itemSwimlane?.(left);
        const rightLane = this.contract.itemSwimlane?.(right);
        const laneOrder = leftLane && rightLane
          ? leftLane.label.localeCompare(rightLane.label) || leftLane.key.localeCompare(rightLane.key)
          : 0;
        return laneOrder || this.contract.itemOrder(left) - this.contract.itemOrder(right) || this.contract.itemIdentity(left).localeCompare(this.contract.itemIdentity(right));
      });
  }
  startsSwimlane(items: readonly object[], index: number): boolean {
    if (!this.contract.itemSwimlane) return false;
    if (index === 0) return true;
    return this.contract.itemSwimlane(items[index]).key !== this.contract.itemSwimlane(items[index - 1]).key;
  }
  swimlaneLabel(item: object): string { return this.contract.itemSwimlane?.(item).label ?? ''; }
  canDrag(item: object): boolean { return this.contract.canMoveItem(item) && !this.contract.busyItemId; }
  startDrag(item: object): void { this.draggedItem = item; this.interactionActiveChange.emit(true); }
  endDrag(): void {
    this.draggedItem = null;
    if (this.movingItemId === null) this.interactionActiveChange.emit(false);
  }
  allowDrop(event: DragEvent): void { event.preventDefault(); }
  dropAtEnd(status: string, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const draggedItem = this.draggedItem;
    if (draggedItem && this.contract.canRequestTransition(draggedItem, status)) {
      // An empty neighbor pair is the canonical "end of Stage" intent. It
      // remains correct when a swimlane changes visual grouping order.
      if (this.requiresReason(status)) {
        this.beginMove(draggedItem, status, 'end', 'drag');
      } else {
        this.emit(draggedItem, status, null, null, null, 'drag');
      }
    }
    this.endDrag();
  }
  dropBefore(neighbor: object, status: string, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const draggedItem = this.draggedItem;
    if (draggedItem && this.contract.itemIdentity(draggedItem) !== this.contract.itemIdentity(neighbor) && this.contract.canRequestTransition(draggedItem, status)) {
      const beforeItemId = this.contract.itemIdentity(neighbor);
      if (this.requiresReason(status)) {
        this.beginMove(draggedItem, status, `before:${beforeItemId}`, 'drag');
      } else {
        this.emit(draggedItem, status, beforeItemId, null, null, 'drag');
      }
    }
    this.endDrag();
  }
  activate(item: object): void { if (this.contract.canOpenItem(item)) this.itemActivated.emit(item); }
  openMove(item: object): void {
    this.beginMove(item, this.contract.itemStatus(item), 'end', 'keyboard');
  }
  changeTarget(status: string): void { this.moveTargetStatus = status; this.movePosition = 'end'; this.moveReason = ''; }
  positionItems(item: object): readonly object[] {
    // Ordering is Stage-wide even when swimlanes group the presentation.
    // Neighbor intents therefore use canonical rank order, not lane label order.
    return [...this.contract.items
      .filter((candidate) =>
        this.contract.itemStatus(candidate) === this.moveTargetStatus &&
        this.contract.itemIdentity(candidate) !== this.contract.itemIdentity(item))]
      .sort((left, right) =>
        this.contract.itemOrder(left) - this.contract.itemOrder(right) ||
        this.contract.itemIdentity(left).localeCompare(this.contract.itemIdentity(right)));
  }
  targetRequiresReason(): boolean { return this.requiresReason(this.moveTargetStatus); }
  submitMove(item: object, event: Event): void {
    event.preventDefault();
    if (!this.contract.canRequestTransition(item, this.moveTargetStatus)) return;
    if (this.targetRequiresReason() && !this.moveReason.trim()) return;
    const candidates = this.positionItems(item);
    const before = this.movePosition.startsWith('before:') ? this.movePosition.slice('before:'.length) : this.movePosition === 'start' ? (candidates[0] ? this.contract.itemIdentity(candidates[0]) : null) : null;
    // End of Stage is represented by the empty neighbor pair even when the
    // bounded board snapshot does not contain every card in the target Stage.
    this.emit(item, this.moveTargetStatus, before, null, this.moveReason.trim() || null, this.moveSource);
    this.closeMove();
  }
  cancelMove(item: object, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.restoredFocusId = null;
    const id = this.contract.itemIdentity(item);
    this.closeMove();
    queueMicrotask(() => this.focus(id));
  }
  ngAfterViewChecked(): void {
    const focusId = this.contract.focusItemId ?? null;
    if (!focusId) {
      this.restoredFocusId = null;
      return;
    }
    if (this.restoredFocusId === focusId) return;
    this.restoredFocusId = focusId;
    queueMicrotask(() => this.focus(focusId));
  }
  private beginMove(item: object, status: string, position: string, source: 'drag' | 'keyboard'): void {
    this.movingItemId = this.contract.itemIdentity(item);
    this.moveTargetStatus = status;
    this.movePosition = position;
    this.moveReason = '';
    this.moveSource = source;
    this.interactionActiveChange.emit(true);
  }
  private closeMove(): void {
    this.movingItemId = null;
    this.moveSource = 'keyboard';
    this.interactionActiveChange.emit(false);
  }
  private requiresReason(status: string): boolean {
    return this.contract.columns.find((column) => column.id === status)?.requiresReason === true;
  }
  private emit(item: object, status: string, before: string | null, after: string | null, reason: string | null, source: 'drag' | 'keyboard'): void {
    this.moveRequested.emit({ item, targetStatus: status, targetBeforeItemId: before, targetAfterItemId: after, reason, source });
  }
  private focus(itemId: string): void {
    const card = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-kanban-card-id]'))
      .find((element) => element.dataset['kanbanCardId'] === itemId);
    card?.focus();
  }
}

@Component({
  selector: 'aip-gantt', standalone: true, imports: [AipAdapterShellComponent],
  template: `<aip-adapter-shell adapter="gantt" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Gantt"><section class="aip-gantt" data-testid="aip-gantt-projection"><p data-testid="aip-gantt-readonly">{{ contract.readOnly ? 'Schedule is read-only because the current API does not provide an authorized versioned schedule-write contract.' : 'Schedule changes are available.' }}</p>@if (contract.milestones.length) { <h3>Milestones</h3><ul>@for (milestone of contract.milestones; track milestone.id) { <li><strong>{{ milestone.title }}</strong> {{ milestone.dueDate ?? 'No due date' }} · {{ milestone.status }}</li> }</ul> }<h3>Tasks</h3><ol>@for (task of contract.tasks; track contract.taskIdentity(task)) { <li>{{ contract.taskLabel(task) }}</li> }</ol></section></aip-adapter-shell>`,
  styleUrl: './aip-adapter-shell.component.scss', changeDetection: ChangeDetectionStrategy.OnPush
})
export class AipGanttComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipGanttContract<object>; }

@Component({ selector: 'aip-tree-grid', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="tree-grid" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Tree grid fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipTreeGridComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipTreeGridContract<object>; }

@Component({ selector: 'aip-scheduler', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="scheduler" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Scheduler fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipSchedulerComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipSchedulerContract<object>; }
