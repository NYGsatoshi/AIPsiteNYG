import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { InviteRegistrationFacade } from '../invite-registration.facade';
import { InviteRegistrationFormSubmit, InviteRegistrationViewModel } from '../invite-registration.types';
import { InviteRegistrationFormComponent } from '../invite-registration-form/invite-registration-form.component';
import { InviteTokenStatePanelComponent } from '../invite-token-state-panel/invite-token-state-panel.component';

@Component({
  selector: 'app-invite-registration-page',
  standalone: true,
  imports: [InviteRegistrationFormComponent, InviteTokenStatePanelComponent],
  templateUrl: './invite-registration-page.component.html',
  styleUrl: './invite-registration-page.component.scss'
})
export class InviteRegistrationPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly facade = inject(InviteRegistrationFacade);
  private readonly inviteToken = this.route.snapshot.queryParamMap.get('token');
  private readonly state = signal<InviteRegistrationViewModel>(this.facade.validateToken(this.inviteToken));

  readonly viewState = this.state.asReadonly();
  readonly canShowForm = computed(() =>
    ['valid', 'backendTransactionGated', 'registrationFailure'].includes(this.state().status)
  );

  submitRegistration(model: InviteRegistrationFormSubmit): void {
    const currentState = this.state();
    if (!this.inviteToken || currentState.submitDisabled || !currentState.email) {
      return;
    }

    this.state.set(
      this.facade.register({
        token: this.inviteToken,
        email: currentState.email,
        displayName: model.displayName,
        password: model.password
      })
    );
  }
}

