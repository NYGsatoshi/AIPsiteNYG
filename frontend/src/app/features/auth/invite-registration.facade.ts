import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import { INVITE_REGISTRATION_SCENARIOS, INVITE_REGISTRATION_STATES } from './invite-registration.mock';
import {
  InviteBootstrapAction,
  InviteRegistrationScenario,
  InviteRegistrationSubmitModel,
  InviteRegistrationViewModel
} from './invite-registration.types';

export const AIP_INVITE_REGISTRATION_SCENARIO = new InjectionToken<InviteRegistrationScenario>(
  'AIP_INVITE_REGISTRATION_SCENARIO'
);

@Injectable({
  providedIn: 'root'
})
export class InviteRegistrationFacade {
  private readonly scenario =
    inject(AIP_INVITE_REGISTRATION_SCENARIO, { optional: true }) ?? INVITE_REGISTRATION_SCENARIOS.defaultValid;
  private readonly submittedModelState = signal<InviteRegistrationSubmitModel | null>(null);
  private readonly bootstrapActionState = signal<readonly InviteBootstrapAction[]>([]);

  readonly submittedModel = this.submittedModelState.asReadonly();
  readonly bootstrapActions = this.bootstrapActionState.asReadonly();

  validateToken(token: string | null): InviteRegistrationViewModel {
    if (!token) {
      return INVITE_REGISTRATION_STATES['missing'];
    }

    return this.scenario.initialState;
  }

  register(model: InviteRegistrationSubmitModel): InviteRegistrationViewModel {
    this.submittedModelState.set(model);
    this.bootstrapActionState.set(this.scenario.submitResult.bootstrapActions);
    return this.scenario.submitResult;
  }
}
