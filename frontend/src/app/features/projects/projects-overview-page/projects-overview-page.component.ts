import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AppEmptyStateComponent } from '../../../shared/empty-state/app-empty-state/app-empty-state.component';
import { AppErrorBannerComponent } from '../../../shared/error/app-error-banner/app-error-banner.component';
import { AppInlineLoadingComponent } from '../../../shared/loading/app-inline-loading/app-inline-loading.component';
import { AppPermissionDeniedComponent } from '../../../shared/permission/app-permission-denied/app-permission-denied.component';
import { ProjectsFacade } from '../projects.facade';
import { ProjectSummaryPanelComponent } from '../project-summary-panel/project-summary-panel.component';
import { FrontendFeatureFlagsService } from '../../../core/feature-flags/frontend-feature-flags.service';

@Component({
  selector: 'app-projects-overview-page',
  standalone: true,
  imports: [
    RouterLink,
    AppEmptyStateComponent,
    AppErrorBannerComponent,
    AppInlineLoadingComponent,
    AppPermissionDeniedComponent,
    ProjectSummaryPanelComponent
  ],
  templateUrl: './projects-overview-page.component.html',
  styleUrl: './projects-overview-page.component.scss'
})
export class ProjectsOverviewPageComponent {
  private readonly facade = inject(ProjectsFacade);
  private readonly flags = inject(FrontendFeatureFlagsService);
  readonly page = computed(() => this.facade.getProjectsOverview());
  readonly designSystemV04Enabled = this.flags.designSystemV04Enabled;
  retry(): void {
    this.facade.retryProjects();
  }
}
