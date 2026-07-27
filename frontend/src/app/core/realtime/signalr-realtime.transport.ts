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
    connection.on('DurableEvent', (event) => this.durableEvents.next(event));
    connection.on('AuthorizationInvalidated', () => this.authorizationInvalidations.next());
    connection.onreconnecting(() => this.statuses.next('reconnecting'));
    connection.onreconnected(() => this.statuses.next('reconnected'));
    connection.onclose(() => this.statuses.next('closed'));
    this.connection = connection;
    return connection;
  }

  private async invokeSubscription(
    operation: 'subscribe' | 'unsubscribe',
    request: RealtimeSubscriptionRequest
  ): Promise<RealtimeSubscriptionResult> {
    const connection = this.connection;
    if (!connection || connection.state !== 'Connected') {
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
