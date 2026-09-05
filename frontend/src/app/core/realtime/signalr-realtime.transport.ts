import { Injectable } from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { firstValueFrom, Subject } from 'rxjs';

import { CsrfTokenService } from '../auth/csrf-token.service';
import { RealtimeSubscriptionRequest, RealtimeSubscriptionResult } from './realtime.models';
import { RealtimeTransport, RealtimeTransportStatus } from './realtime-transport';

const RECONNECT_DELAYS_MS = [0, 1_000, 3_000, 7_000];

/** The sole location where SignalR browser APIs are used. */
@Injectable({ providedIn: 'root' })
export class SignalrRealtimeTransport implements RealtimeTransport {
  private readonly durableEvents = new Subject<unknown>();
  private readonly authorizationInvalidations = new Subject<void>();
  private readonly statuses = new Subject<RealtimeTransportStatus>();
  private connection: HubConnection | null = null;

  constructor(private readonly csrfTokens: CsrfTokenService) {}

  readonly durableEvents$ = this.durableEvents.asObservable();
  readonly authorizationInvalidations$ = this.authorizationInvalidations.asObservable();
  readonly statuses$ = this.statuses.asObservable();

  async start(): Promise<void> {
    const connection = this.connection ?? await this.createConnection();
    if (connection.state === 'Connected' || connection.state === 'Connecting' || connection.state === 'Reconnecting') {
      return;
    }

    this.statuses.next('connecting');
    await connection.start();
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    if (!connection) {
      return;
    }

    this.connection = null;
    await connection.stop();
  }

  subscribe(request: RealtimeSubscriptionRequest): Promise<RealtimeSubscriptionResult> {
    return this.invokeSubscription('subscribe', request);
  }

  unsubscribe(request: RealtimeSubscriptionRequest): Promise<RealtimeSubscriptionResult> {
    if (request.subscriptionType === 'user' || request.subscriptionType === 'tenant') {
      // These targets are derived exclusively from the authenticated
      // connection and AppHub intentionally exposes no UnsubscribeUser or
      // UnsubscribeTenant method. Calling the subscribe method here would turn
      // a cleanup request into a grant; callers must stop the transport to
      // discard either server-derived group.
      return Promise.resolve({ allowed: false, code: 'TransportStopRequired' });
    }
    return this.invokeSubscription('unsubscribe', request);
  }

  private async createConnection(): Promise<HubConnection> {
    // SignalR negotiate is a POST. It must use the same antiforgery contract as
    // every other unsafe same-origin request; cookies alone are insufficient.
    const csrfToken = await firstValueFrom(this.csrfTokens.ensureToken());
    const connection = new HubConnectionBuilder()
      .withUrl('/hubs/app', {
        withCredentials: true,
        headers: { [csrfToken.headerName]: csrfToken.token }
      })
      .withAutomaticReconnect(RECONNECT_DELAYS_MS)
      .configureLogging(LogLevel.Warning)
      .build();

    // Hub callbacks are deliberately registered before start.
    // A stopped connection can still drain callbacks while its close Promise
    // settles. Scope every callback to the currently owned connection so an
    // obsolete frame/status cannot contaminate its replacement epoch.
    connection.on('DurableEvent', (event) => {
      if (this.connection === connection) {this.durableEvents.next(event);}
    });
    connection.on('AuthorizationInvalidated', () => {
      if (this.connection === connection) {this.authorizationInvalidations.next();}
    });
    connection.onreconnecting(() => {
      if (this.connection === connection) {this.statuses.next('reconnecting');}
    });
    connection.onreconnected(() => {
      if (this.connection === connection) {this.statuses.next('reconnected');}
    });
    connection.onclose(() => {
      if (this.connection === connection) {this.statuses.next('closed');}
    });
    this.connection = connection;
    return connection;
  }

  private async invokeSubscription(
    operation: 'subscribe' | 'unsubscribe',
    request: RealtimeSubscriptionRequest
  ): Promise<RealtimeSubscriptionResult> {
    const connection = this.connection;
    if (connection?.state !== 'Connected') {
      return { allowed: false, code: 'ConnectionUnavailable' };
    }

    const method = hubMethod(operation, request);
    const result = request.resourceId
      ? await connection.invoke<RealtimeSubscriptionResult>(method, request.resourceId)
      : await connection.invoke<RealtimeSubscriptionResult>(method);
    return result && typeof result.allowed === 'boolean' && typeof result.code === 'string'
      ? result
      : { allowed: false, code: 'InvalidSubscriptionResponse' };
  }
}

function hubMethod(operation: 'subscribe' | 'unsubscribe', request: RealtimeSubscriptionRequest): string {
  const prefix = operation === 'subscribe' ? 'Subscribe' : 'Unsubscribe';
  switch (request.subscriptionType) {
    case 'user':
      return 'SubscribeUser';
    case 'tenant':
      return 'SubscribeTenant';
    case 'workspace':
      return `${prefix}Workspace`;
    case 'conversation':
      return `${prefix}Conversation`;
    case 'project':
      return `${prefix}Project`;
  }
}
