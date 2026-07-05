import { inject, Injectable, InjectionToken, signal } from '@angular/core';

import {
  InviteBootstrapAction,
  InviteRegistrationScenario,
  InviteRegistrationSubmitModel,
  InviteRegistrationViewModel,
} from './invite-registration.types';

export const AIP_INVITE_REGISTRATION_SCENARIO = new InjectionToken<InviteRegistrationScenario>(
  'AIP_INVITE_REGISTRATION_SCENARIO',
);

@Injectable({
  providedIn: 'root',
})
export class InviteRegistrationFacade {
  private readonly scenario = inject(AIP_INVITE_REGISTRATION_SCENARIO, { optional: true });
  private readonly submittedModelState = signal<InviteRegistrationSubmitModel | null>(null);
  private readonly bootstrapActionState = signal<readonly InviteBootstrapAction[]>([]);

  readonly submittedModel = this.submittedModelState.asReadonly();
  readonly bootstrapActions = this.bootstrapActionState.asReadonly();

  validateToken(token: string | null): InviteRegistrationViewModel {
    if (!token) {
      return {
        status: 'missing',
        email: null,
        message: 'Invite token is missing.',
        submitDisabled: true,
        bootstrapActions: [],
      };
    }

    return (
      this.scenario?.initialState ?? {
        status: 'invalid',
        email: null,
        message: 'Invite token validation API is not implemented.',
        submitDisabled: true,
        bootstrapActions: [],
      }
    );
  }

  register(model: InviteRegistrationSubmitModel): InviteRegistrationViewModel {
    this.submittedModelState.set(model);
    if (this.scenario) {
      this.bootstrapActionState.set(this.scenario.submitResult.bootstrapActions);
      return this.scenario.submitResult;
    }

    this.bootstrapActionState.set([]);
    return {
      status: 'registrationFailure',
      email: model.email,
      message: 'Invite registration submit API is not wired to this synchronous screen yet.',
      submitDisabled: true,
      bootstrapActions: [],
    };
  }
}
