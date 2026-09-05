import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { AccountSessionViewModel } from '../account.types';

@Component({
  selector: 'app-session-list',
  standalone: true,
  templateUrl: './session-list.component.html',
  styleUrl: './session-list.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class SessionListComponent {
  readonly i18n = inject(I18nService);
  @Input({ required: true }) sessions!: readonly AccountSessionViewModel[];
}
