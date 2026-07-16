import { ChangeDetectionStrategy, Component, Directive, Input } from '@angular/core';

import {
  AipAdapterPresentation,
  AipAdapterState,
  AipDataGridContract,
  AipDateTimePickerContract,
  AipDialogContract,
  AipFileUploaderContract,
  AipGanttContract,
  AipKanbanContract,
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

@Component({ selector: 'aip-kanban', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="kanban" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Kanban fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipKanbanComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipKanbanContract<object>; }

@Component({ selector: 'aip-gantt', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="gantt" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Gantt fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipGanttComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipGanttContract<object>; }

@Component({ selector: 'aip-tree-grid', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="tree-grid" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Tree grid fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipTreeGridComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipTreeGridContract<object>; }

@Component({ selector: 'aip-scheduler', standalone: true, imports: [AipAdapterShellComponent], template: '<aip-adapter-shell adapter="scheduler" [ariaLabel]="contract.ariaLabel" [presentation]="presentation" [state]="state" label="Scheduler fallback" />', changeDetection: ChangeDetectionStrategy.OnPush })
export class AipSchedulerComponent extends AipAdapterShellInput { @Input({ required: true }) contract!: AipSchedulerContract<object>; }
