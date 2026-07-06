import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';

import {
  InviteBootstrapAction,
  InviteRegistrationScenario,
  InviteRegistrationSubmitModel,
  InviteRegistrationViewModel,
} from './invite-registration.types';

export const AIP_INVITE_REGISTRATION_SCENARIO = new InjectionToken<InviteRegistrationScenario>(
  'AIP_INVITE_REGISTRATION_SCENARIO',
);

interface InviteValidationDto {
  readonly valid?: unknown;
  readonly email?: unknown;
  readonly role?: unknown;
  readonly tenantName?: unknown;
  readonly expiresAt?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class InviteRegistrationFacade {
  private readonly http = inject(HttpClient, { optional: true });
  private readonly scenario = inject(AIP_INVITE_REGISTRATION_SCENARIO, { optional: true });
  private readonly submittedModelState = signal<InviteRegistrationSubmitModel | null>(null);
  private readonly bootstrapActionState = signal<readonly InviteBootstrapAction[]>([]);

  readonly submittedModel = this.submittedModelState.asReadonly();
  readonly bootstrapActions = this.bootstrapActionState.asReadonly();

  validateToken(token: string | null): Observable<InviteRegistrationViewModel> {
    if (!token) {
      return of({
        status: 'missing',
        email: null,
        message: 'Invite token is missing.',
        submitDisabled: true,
        bootstrapActions: [],
      });
    }

    if (this.scenario) {
      return of(this.scenario.initialState);
    }

    if (!this.http) {
      return of({
        status: 'invalid',
        email: null,
        message: 'Invite token validation API is not available.',
        submitDisabled: true,
        bootstrapActions: [],
      });
    }

    return this.http
      .get<InviteValidationDto>('/api/invites/validate', {
        params: { token },
        withCredentials: true,
      })
      .pipe(
        map((response) => toValidState(response)),
        catchError((error: HttpErrorResponse) => of(toInvalidState(error)))
      );
  }

  register(model: InviteRegistrationSubmitModel): Observable<InviteRegistrationViewModel> {
    this.submittedModelState.set(model);
    if (this.scenario) {
      this.bootstrapActionState.set(this.scenario.submitResult.bootstrapActions);
      return of(this.scenario.submitResult);
    }

    if (!this.http) {
      this.bootstrapActionState.set([]);
      return of({
        status: 'registrationFailure',
        email: model.email,
        message: 'Invite registration submit API is not available.',
        submitDisabled: true,
        bootstrapActions: [],
      });
    }

    return this.http
      .post(
        '/api/invites/accept',
        {
          token: model.token,
          displayName: model.displayName,
          password: model.password,
        },
        { withCredentials: true }
      )
      .pipe(
        map(() => {
          const bootstrapActions: readonly InviteBootstrapAction[] = [
            'clearAnonymousState',
            'fetchCurrentUser',
            'fetchCurrentTenant',
            'fetchNavigation',
            'fetchCsrfToken',
            'navigateTargetWorkspace',
          ];
          this.bootstrapActionState.set(bootstrapActions);
          return {
            status: 'registrationSuccessAutoSession',
            email: model.email,
            message: null,
            submitDisabled: true,
            bootstrapActions,
          } satisfies InviteRegistrationViewModel;
        }),
        catchError((error: HttpErrorResponse) => {
          this.bootstrapActionState.set([]);
          return of({
            status: 'registrationFailure',
            email: model.email,
            requestId: requestIdFrom(error),
            message: errorMessageFrom(error) || 'Invite registration failed.',
            submitDisabled: false,
            bootstrapActions: [],
          } satisfies InviteRegistrationViewModel);
        })
      );
  }
}

function toValidState(response: InviteValidationDto): InviteRegistrationViewModel {
  if (response.valid !== true || !stringValue(response.email)) {
    return {
      status: 'invalid',
      email: null,
      message: 'Invite link is invalid.',
      submitDisabled: true,
      bootstrapActions: [],
    };
  }

  return {
    status: 'valid',
    email: stringValue(response.email),
    role: stringValue(response.role),
    tenantName: stringValue(response.tenantName),
    expiresAt: stringValue(response.expiresAt),
    message: null,
    submitDisabled: false,
    bootstrapActions: [],
  };
}

function toInvalidState(error: HttpErrorResponse): InviteRegistrationViewModel {
  const message = errorMessageFrom(error) || 'Invite link is invalid.';
  return {
    status: inviteStatusFromMessage(message),
    email: null,
    requestId: requestIdFrom(error),
    message,
    submitDisabled: true,
    bootstrapActions: [],
  };
}

function inviteStatusFromMessage(message: string): InviteRegistrationViewModel['status'] {
  const normalized = message.toLowerCase();
  if (normalized.includes('expired')) {
    return 'expired';
  }

  if (normalized.includes('already') || normalized.includes('used')) {
    return 'alreadyAccepted';
  }

  return 'invalid';
}

function errorMessageFrom(error: HttpErrorResponse): string | null {
  const body = error.error as { error?: unknown; detail?: unknown; title?: unknown } | null;
  return stringValue(body?.error) || stringValue(body?.detail) || stringValue(body?.title) || error.message || null;
}

function requestIdFrom(error: HttpErrorResponse): string | null {
  const body = error.error as { requestId?: unknown; traceId?: unknown } | null;
  return stringValue(body?.requestId) || stringValue(body?.traceId) || null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
