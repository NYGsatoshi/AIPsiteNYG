import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AdminFacade } from '../admin.facade';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-export-diagnostics-page',
  standalone: true,
  imports: [
    AppEmptyStateComponent
  ],
  templateUrl: './export-diagnostics-page.component.html',
  styleUrl: './export-diagnostics-page.component.scss',
})
export class ExportDiagnosticsPageComponent {
  private readonly facade = inject(AdminFacade);

  readonly vm = computed(() => this.facade.getExportDiagnostics());
}
