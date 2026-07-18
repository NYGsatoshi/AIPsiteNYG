import { DurableRealtimeEvent, REALTIME_EVENT_TYPES, RealtimeActor, RealtimeEventType } from './realtime.models';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Validates only the approved durable envelope before a Facade can observe it. */
export function validateDurableRealtimeEvent(value: unknown, expectedTenantId: string): DurableRealtimeEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const eventType = stringValue(value['eventType']);
  const eventId = stringValue(value['eventId']);
  const tenantId = stringValue(value['tenantId']);
  const aggregateId = stringValue(value['aggregateId']);
  const aggregateType = stringValue(value['aggregateType']);
  const occurredAt = stringValue(value['occurredAt']);
  const schemaVersion = value['payloadSchemaVersion'];
  const actor = toActor(value['actor']);

  if (
    !eventType ||
    !REALTIME_EVENT_TYPES.has(eventType) ||
    !UUID.test(eventId) ||
    !UUID.test(tenantId) ||
    tenantId !== expectedTenantId ||
    !UUID.test(aggregateId) ||
    !aggregateType ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion !== 1 ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    !actor ||
    !isRecord(value['payload'])
  ) {
    return null;
  }

  const aggregateVersion = value['aggregateVersion'];
  if (aggregateVersion !== null && aggregateVersion !== undefined &&
    (typeof aggregateVersion !== 'number' || !Number.isInteger(aggregateVersion) || aggregateVersion < 0)) {
    return null;
  }

  return {
    eventId,
    eventType: eventType as RealtimeEventType,
    payloadSchemaVersion: 1,
    occurredAt,
    tenantId,
    aggregateId,
    aggregateType,
    aggregateVersion: typeof aggregateVersion === 'number' ? aggregateVersion : null,
    actor,
    correlationId: nullableString(value['correlationId']),
    causationId: nullableString(value['causationId']),
    payload: value['payload']
  };
}

function toActor(value: unknown): RealtimeActor | null {
  if (!isRecord(value) || (value['actorType'] !== 'User' && value['actorType'] !== 'System')) {
    return null;
  }

  const actorId = value['actorId'];
  return actorId === null || actorId === undefined
    ? { actorType: value['actorType'], actorId: null }
    : typeof actorId === 'string' && UUID.test(actorId)
      ? { actorType: value['actorType'], actorId }
      : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
