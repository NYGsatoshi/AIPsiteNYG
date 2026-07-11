import { InviteRegistrationScenario, InviteRegistrationViewModel } from './invite-registration.types';

export const INVITE_REGISTRATION_SAFE_EMAIL = 'mock-invitee@example.invalid';

export const INVITE_REGISTRATION_STATES: Record<string, InviteRegistrationViewModel> = {
  missing: {
    status: 'missing',
    email: null,
    submitDisabled: true,
    bootstrapActions: []
  },
  validating: {
    status: 'validating',
    email: null,
    submitDisabled: true,
    bootstrapActions: []
  },
  valid: {
    status: 'valid',
    email: INVITE_REGISTRATION_SAFE_EMAIL,
    role: 'Member',
    tenantName: 'Mock Tenant',
    workspaceName: 'Mock Workspace',
    submitDisabled: false,
    bootstrapActions: []
  },
  invalid: {
    status: 'invalid',
    email: null,
    submitDisabled: true,
    bootstrapActions: []
  },
  expired: {
    status: 'expired',
    email: null,
    submitDisabled: true,
    bootstrapActions: []
  },
  revoked: {
    status: 'revoked',
    email: null,
    submitDisabled: true,
    bootstrapActions: []
  },
  alreadyAccepted: {
    status: 'alreadyAccepted',
    email: null,
    submitDisabled: true,
    bootstrapActions: []
  },
  backendTransactionGated: {
    status: 'backendTransactionGated',
    email: INVITE_REGISTRATION_SAFE_EMAIL,
    submitDisabled: true,
    bootstrapActions: []
  },
  registrationSuccessAutoSession: {
    status: 'registrationSuccessAutoSession',
    email: INVITE_REGISTRATION_SAFE_EMAIL,
    submitDisabled: true,
    targetWorkspacePath: '/workspaces',
    bootstrapActions: [
      'clearAnonymousState',
      'fetchCurrentUser',
      'fetchCurrentTenant',
      'fetchNavigation',
      'fetchCsrfToken',
      'navigateTargetWorkspace'
    ]
  },
  registrationSuccessLoginRequired: {
    status: 'registrationSuccessLoginRequired',
    email: INVITE_REGISTRATION_SAFE_EMAIL,
    submitDisabled: true,
    bootstrapActions: ['clearAnonymousState', 'navigateLogin']
  },
  registrationFailure: {
    status: 'registrationFailure',
    email: INVITE_REGISTRATION_SAFE_EMAIL,
    submitDisabled: false,
    requestId: 'REQ-MOCK-INVITE-001',
    bootstrapActions: []
  }
};

export const INVITE_REGISTRATION_SCENARIOS = {
  defaultValid: {
    initialState: INVITE_REGISTRATION_STATES['valid'],
    submitResult: INVITE_REGISTRATION_STATES['registrationSuccessAutoSession']
  },
  missingToken: {
    initialState: INVITE_REGISTRATION_STATES['missing'],
    submitResult: INVITE_REGISTRATION_STATES['missing']
  },
  validating: {
    initialState: INVITE_REGISTRATION_STATES['validating'],
    submitResult: INVITE_REGISTRATION_STATES['validating']
  },
  invalidToken: {
    initialState: INVITE_REGISTRATION_STATES['invalid'],
    submitResult: INVITE_REGISTRATION_STATES['invalid']
  },
  expiredToken: {
    initialState: INVITE_REGISTRATION_STATES['expired'],
    submitResult: INVITE_REGISTRATION_STATES['expired']
  },
  revokedToken: {
    initialState: INVITE_REGISTRATION_STATES['revoked'],
    submitResult: INVITE_REGISTRATION_STATES['revoked']
  },
  alreadyAccepted: {
    initialState: INVITE_REGISTRATION_STATES['alreadyAccepted'],
    submitResult: INVITE_REGISTRATION_STATES['alreadyAccepted']
  },
  backendTransactionGated: {
    initialState: INVITE_REGISTRATION_STATES['backendTransactionGated'],
    submitResult: INVITE_REGISTRATION_STATES['backendTransactionGated']
  },
  validationError: {
    initialState: INVITE_REGISTRATION_STATES['valid'],
    submitResult: INVITE_REGISTRATION_STATES['valid']
  },
  registrationSuccessAutoSession: {
    initialState: INVITE_REGISTRATION_STATES['registrationSuccessAutoSession'],
    submitResult: INVITE_REGISTRATION_STATES['registrationSuccessAutoSession']
  },
  registrationSuccessLoginRequired: {
    initialState: INVITE_REGISTRATION_STATES['registrationSuccessLoginRequired'],
    submitResult: INVITE_REGISTRATION_STATES['registrationSuccessLoginRequired']
  },
  serverErrorWithRequestId: {
    initialState: INVITE_REGISTRATION_STATES['registrationFailure'],
    submitResult: INVITE_REGISTRATION_STATES['registrationFailure']
  }
} satisfies Record<string, InviteRegistrationScenario>;
