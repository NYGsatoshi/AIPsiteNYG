import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { InviteRegistrationViewModel } from '../invite-registration.types';

@Component({
  selector: 'app-invite-token-state-panel',
  standalone: true,
  templateUrl: './invite-token-state-panel.component.html',
  styleUrl: './invite-token-state-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class InviteTokenStatePanelComponent {
  @Input({ required: true }) state!: InviteRegistrationViewModel;

  get isBlockingState(): boolean {
    return ['missing', 'invalid', 'expired', 'revoked', 'alreadyAccepted', 'backendTransactionGated'].includes(
      this.state.status
    );
  }
}
