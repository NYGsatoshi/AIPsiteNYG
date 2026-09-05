import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { LucideCircle } from '@lucide/angular';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { UploaderComponent, UploaderModule } from '@syncfusion/ej2-angular-inputs';
import { DialogComponent, DialogModule } from '@syncfusion/ej2-angular-popups';
import { firstValueFrom, map, of } from 'rxjs';

import { AppDataGridComponent } from '../../../grid/app-data-grid/app-data-grid.component';
import { SyncfusionDataGridComponent } from './syncfusion-data-grid.component';
import { SYNCFUSION_GANTT_THEME_ASSETS, SyncfusionGanttComponent } from './syncfusion-gantt.component';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-angular22-third-party-compat-host',
  imports: [DialogModule, LucideCircle, UploaderModule],
  standalone: true,
  template: `
    <svg lucideCircle aria-hidden="true" data-testid="lucide-circle"></svg>
    <ejs-uploader [autoUpload]="false" [multiple]="true" />
    <ejs-dialog [showCloseIcon]="true" [visible]="false" />
  `,
})
class Angular22ThirdPartyCompatibilityHostComponent {}

describe('Angular 22 third-party compatibility', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('instantiates the current Syncfusion Inputs and Popups Angular wrappers with Lucide', async () => {
    await TestBed.configureTestingModule({
      imports: [Angular22ThirdPartyCompatibilityHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(Angular22ThirdPartyCompatibilityHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const uploader = fixture.debugElement.query(By.directive(UploaderComponent));
    const dialog = fixture.debugElement.query(By.directive(DialogComponent));
    const icon = fixture.debugElement.query(By.directive(LucideCircle));

    expect(uploader).not.toBeNull();
    expect(dialog).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(uploader.componentInstance).toBeInstanceOf(UploaderComponent);
    expect(dialog.componentInstance).toBeInstanceOf(DialogComponent);

    fixture.destroy();
  });

  it('loads the production Gantt, Syncfusion Grid, and AG Grid Angular integration classes', () => {
    expect(SyncfusionGanttComponent).toBeDefined();
    expect(SyncfusionDataGridComponent).toBeDefined();
    expect(AppDataGridComponent).toBeDefined();
    expect(SYNCFUSION_GANTT_THEME_ASSETS).toContain('assets/vendor/syncfusion/popups/material3.css');
  });

  it('builds the SignalR client and preserves RxJS execution in the jsdom test runtime', async () => {
    const connection = new HubConnectionBuilder()
      .withUrl('https://example.invalid/hubs/realtime')
      .build();

    expect(connection.state).toBe(HubConnectionState.Disconnected);
    expect(await firstValueFrom(of(21).pipe(map((value) => value * 2)))).toBe(42);
    expect(window.document).toBe(document);
    expect(document.createElement('div')).toBeInstanceOf(HTMLElement);
  });

  it('loads the zone.js runtime used by the retained Storybook browser target', async () => {
    await import('zone.js');

    expect((globalThis as typeof globalThis & { Zone?: unknown }).Zone).toBeDefined();
  });
});
