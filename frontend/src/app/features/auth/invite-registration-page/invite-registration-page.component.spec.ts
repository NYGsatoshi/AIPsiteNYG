import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { routes } from '../../../app.routes';
import { AIP_INVITE_REGISTRATION_SCENARIO, InviteRegistrationFacade } from '../invite-registration.facade';
import { INVITE_REGISTRATION_SCENARIOS } from '../invite-registration.mock';
import { InviteRegistrationScenario } from '../invite-registration.types';
import { InviteRegistrationFormComponent } from '../invite-registration-form/invite-registration-form.component';
import { InviteRegistrationPageComponent } from './invite-registration-page.component';

const routeWithToken = (token: string | null) => ({
  snapshot: {
    queryParamMap: convertToParamMap(token ? { token } : {})
  }
});

const renderPage = async (
  scenario: InviteRegistrationScenario = INVITE_REGISTRATION_SCENARIOS.defaultValid,
  token: string | null = 'safe-test-token'
): Promise<ComponentFixture<InviteRegistrationPageComponent>> => {
  await TestBed.configureTestingModule({
    imports: [InviteRegistrationPageComponent],
    providers: [
      { provide: AIP_INVITE_REGISTRATION_SCENARIO, useValue: scenario },
      { provide: ActivatedRoute, useValue: routeWithToken(token) }
    ]
  }).compileComponents();

  const fixture = TestBed.createComponent(InviteRegistrationPageComponent);
  fixture.detectChanges();
  return fixture;
};

const textContent = (fixture: ComponentFixture<InviteRegistrationPageComponent>): string =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

const getForm = (fixture: ComponentFixture<InviteRegistrationPageComponent>): InviteRegistrationFormComponent =>
  fixture.debugElement.query(By.directive(InviteRegistrationFormComponent)).componentInstance as InviteRegistrationFormComponent;

const renderPageWithApi = async (
  token: string | null = 'safe-api-token'
): Promise<{ fixture: ComponentFixture<InviteRegistrationPageComponent>; httpMock: HttpTestingController }> => {
  await TestBed.configureTestingModule({
    imports: [InviteRegistrationPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: routeWithToken(token) }
    ]
  }).compileComponents();

  const fixture = TestBed.createComponent(InviteRegistrationPageComponent);
  fixture.detectChanges();
  return { fixture, httpMock: TestBed.inject(HttpTestingController) };
};

describe('InviteRegistrationPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('configures the /register/invite route', () => {
    expect(routes.some((route) => route.path === 'register/invite')).toBe(true);
  });

  it('shows a safe unusable-link state when the token is absent', async () => {
    const fixture = await renderPage(INVITE_REGISTRATION_SCENARIOS.defaultValid, null);

    expect(textContent(fixture)).toContain('招待リンクを使用できません。');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="invite-registration-form"]')).toBeNull();
  });

  it('does not render the token value', async () => {
    const token = 'SENSITIVE-INVITE-TOKEN-123';
    const fixture = await renderPage(INVITE_REGISTRATION_SCENARIOS.defaultValid, token);

    expect((fixture.nativeElement as HTMLElement).innerHTML).not.toContain(token);
    expect(textContent(fixture)).not.toContain(token);
  });

  it('renders email as display-only', async () => {
    const fixture = await renderPage();

    const email = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-testid="invite-email"]');
    expect(email?.readOnly).toBe(true);
    expect(email?.value).toBe('mock-invitee@example.invalid');
  });

  it('validates a real invite token and renders the registration form', async () => {
    const { fixture, httpMock } = await renderPageWithApi('safe-api-token');

    const validateRequest = httpMock.expectOne((request) =>
      request.url === '/api/invites/validate' && request.params.get('token') === 'safe-api-token'
    );
    validateRequest.flush({
      valid: true,
      email: 'new-user@example.invalid',
      role: 'Member',
      tenantName: 'AIP Portal',
      expiresAt: '2026-07-13T00:00:00Z'
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="invite-registration-form"]')).not.toBeNull();
    expect(textContent(fixture)).toContain('new-user@example.invalid');
    expect(textContent(fixture)).toContain('Member');
    httpMock.verify();
  });

  it('accepts a valid invite without sending email from the form payload', async () => {
    const { fixture, httpMock } = await renderPageWithApi('safe-api-token');

    httpMock.expectOne('/api/invites/validate?token=safe-api-token').flush({
      valid: true,
      email: 'new-user@example.invalid',
      role: 'Member',
      tenantName: 'AIP Portal',
      expiresAt: '2026-07-13T00:00:00Z'
    });
    fixture.detectChanges();

    const form = getForm(fixture);
    form.form.setValue({
      displayName: 'New User',
      password: 'Password123',
      confirmPassword: 'Password123'
    });
    form.submit();

    const acceptRequest = httpMock.expectOne('/api/invites/accept');
    expect(acceptRequest.request.body).toEqual({
      token: 'safe-api-token',
      displayName: 'New User',
      password: 'Password123'
    });
    acceptRequest.flush({ userId: 'user-a', displayName: 'New User', email: 'new-user@example.invalid' });
    fixture.detectChanges();

    expect(textContent(fixture)).toContain('登録が完了しました。');
    httpMock.verify();
  });

  it('does not trim password before submit model construction', async () => {
    const fixture = await renderPage();
    const form = getForm(fixture);

    form.form.setValue({
      displayName: ' Mock Invitee ',
      password: '  mock-password  ',
      confirmPassword: '  mock-password  '
    });
    form.submit();
    fixture.detectChanges();

    expect(TestBed.inject(InviteRegistrationFacade).submittedModel()?.password).toBe('  mock-password  ');
    expect(TestBed.inject(InviteRegistrationFacade).submittedModel()?.displayName).toBe('Mock Invitee');
  });

  it('blocks submit when confirm password does not match', async () => {
    const fixture = await renderPage();
    const form = getForm(fixture);

    form.form.setValue({
      displayName: 'Mock Invitee',
      password: 'mock-password-a',
      confirmPassword: 'mock-password-b'
    });
    form.submit();
    fixture.detectChanges();

    expect(TestBed.inject(InviteRegistrationFacade).submittedModel()).toBeNull();
    expect(textContent(fixture)).toContain('パスワードが一致しません。');
  });

  it('does not render registration submit in legacy backend transaction gated state', async () => {
    const fixture = await renderPage(INVITE_REGISTRATION_SCENARIOS.backendTransactionGated);

    const submit = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="invite-submit"]');
    expect(submit).toBeNull();
    expect(textContent(fixture)).toContain('この招待登録は現在準備中です。');
  });

  it('does not reveal target tenant or workspace details in invalid and expired states', async () => {
    const invalid = await renderPage(INVITE_REGISTRATION_SCENARIOS.invalidToken);
    expect(textContent(invalid)).not.toContain('Mock Tenant');
    expect(textContent(invalid)).not.toContain('Mock Workspace');

    TestBed.resetTestingModule();
    const expired = await renderPage(INVITE_REGISTRATION_SCENARIOS.expiredToken);
    expect(textContent(expired)).not.toContain('Mock Tenant');
    expect(textContent(expired)).not.toContain('Mock Workspace');
  });

  it('records the anonymous/session bootstrap sequence after successful registration', async () => {
    const fixture = await renderPage();
    const form = getForm(fixture);

    form.form.setValue({
      displayName: 'Mock Invitee',
      password: 'mock-password',
      confirmPassword: 'mock-password'
    });
    form.submit();
    fixture.detectChanges();

    expect(TestBed.inject(InviteRegistrationFacade).bootstrapActions()).toEqual([
      'clearAnonymousState',
      'fetchCurrentUser',
      'fetchCurrentTenant',
      'fetchNavigation',
      'fetchCsrfToken',
      'navigateTargetWorkspace'
    ]);
    expect(textContent(fixture)).toContain('登録が完了しました。ワークスペースを準備しています。');
  });

  it('keeps mobile layout free of hidden alternate actions', async () => {
    const fixture = await renderPage();
    (fixture.nativeElement as HTMLElement).style.width = '320px';
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="invite-admin-action"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="invite-login-action"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('button').length).toBe(1);
  });
});
