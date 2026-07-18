import { ChangeDetectionStrategy, Component, Directive, EventEmitter, Input, Output } from '@angular/core';

import {
  AipAdapterPresentation,
  AipAdapterState,
  AipDataGridContract,
  AipDateTimePickerContract,
  AipDialogContract,
  AipFileUploaderContract,
  AipGanttContract,
  AipKanbanContract,
  AipKanbanTransitionRequest,
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
    <div class="aip-kanban" [class.aip-kanban--narrow]="presentation === 'narrow'" data-testid="aip-kanban-board">
      @for (column of contract.columns; track column.id) { <section class="aip-kanban__column" [attr.aria-label]="column.label" (dragover)="allowDrop($event)" (drop)="drop(column.id, $event)">
        <h3>{{ column.label }}</h3><ul>
          @for (item of itemsFor(column.id); track contract.itemIdentity(item)) { <li [draggable]="canDrag(item)" (dragstart)="startDrag(item)"><strong>{{ contract.itemTitle(item) }}</strong>
            @if (contract.itemDescription) { <span>{{ contract.itemDescription(item) }}</span> }
            <select [value]="contract.itemStatus(item)" [attr.aria-label]="'Move ' + contract.itemTitle(item)" (change)="requestKeyboardMove(item, $any($event.target).value)">
              @for (target of contract.columns; track target.id) { <option [value]="target.id" [disabled]="target.id !== contract.itemStatus(item) && !contract.canRequestTransition(item, target.id)">{{ target.label }}</option> }
            </select></li> }
        </ul></section> }
    </div></aip-adapter-shell>`,
  styleUrl: './aip-adapter-shell.component.scss', changeDetection: ChangeDetectionStrategy.OnPush
})
export class AipKanbanComponent extends AipAdapterShellInput {
  @Input({ required: true }) contract!: AipKanbanContract<object>;
  @Output() readonly transitionRequested = new EventEmitter<AipKanbanTransitionRequest<object>>();
  private draggedItem: object | null = null;
  itemsFor(status: string): readonly object[] { return this.contract.items.filter((item) => this.contract.itemStatus(item) === status); }
  canDrag(item: object): boolean { return this.contract.columns.some((column) => this.contract.canRequestTransition(item, column.id)); }
  startDrag(item: object): void { this.draggedItem = item; }
  allowDrop(event: DragEvent): void { event.preventDefault(); }
  drop(status: string, event: DragEvent): void { event.preventDefault(); if (this.draggedItem) this.emit(this.draggedItem, status, 'drag'); this.draggedItem = null; }
  requestKeyboardMove(item: object, status: string): void { this.emit(item, status, 'keyboard'); }
  private emit(item: object, status: string, source: 'drag' | 'keyboard'): void { if (status !== this.contract.itemStatus(item) && this.contract.canRequestTransition(item, status)) this.transitionRequested.emit({ item, targetStatus: status, source }); }
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
