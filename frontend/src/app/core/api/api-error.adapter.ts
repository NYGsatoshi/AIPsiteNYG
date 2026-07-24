import { HttpErrorResponse } from '@angular/common/http';

import { ApiErrorDisplayModel, FrontendApiError, FrontendApiErrorDetail } from './api-error.model';

interface ErrorEnvelope {
  readonly code?: unknown;
  readonly Code?: unknown;
  readonly message?: unknown;
  readonly Message?: unknown;
  readonly title?: unknown;
  readonly Title?: unknown;
  readonly detail?: unknown;
  readonly Detail?: unknown;
  readonly errors?: unknown;
  readonly Errors?: unknown;
  readonly target?: unknown;
  readonly Target?: unknown;
  readonly details?: unknown;
  readonly Details?: unknown;
  readonly requestId?: unknown;
  readonly RequestId?: unknown;
  readonly traceId?: unknown;
  readonly TraceId?: unknown;
  readonly redactionApplied?: unknown;
  readonly RedactionApplied?: unknown;
  readonly error?: unknown;
}

const STATUS_MESSAGES: Record<number, string> = {
  0: 'The request could not be completed.',
  400: 'The request could not be completed.',
  401: 'Authentication is required.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested resource was not found.',
  409: 'The request conflicts with the current server state.',
  429: 'Too many requests. Please try again later.',
  500: 'An unexpected server error occurred.'
};

export function normalizeApiError(input: unknown, explicitStatus?: number): FrontendApiError {
  if (isFrontendApiError(input)) {
    return input;
  }

  const httpError = input instanceof HttpErrorResponse ? input : null;
  const httpStatus = explicitStatus ?? httpError?.status ?? 0;
  const body = readErrorBody(httpError?.error ?? input);
  const nested = body.error && typeof body.error === 'object' ? readErrorBody(body.error) : {};
  const localErrorId = createLocalErrorId();
  const requestId = firstString(body.requestId, body.RequestId, body.traceId, body.TraceId, nested.requestId, nested.RequestId, nested.traceId, nested.TraceId);
  const code = firstString(body.code, body.Code, nested.code, nested.Code) ?? statusCodeToCode(httpStatus);
  const validationDetails = normalizeValidationErrors(body.errors ?? body.Errors);
  const message =
    firstString(body.message, body.Message, nested.message, nested.Message) ??
    firstString(body.detail, body.Detail) ??
    firstString(body.title, body.Title) ??
    readLegacyErrorMessage(body.error) ??
    httpError?.message ??
    STATUS_MESSAGES[httpStatus] ??
    'The request could not be completed.';

  return {
    code,
    message,
    target: firstString(body.target, body.Target),
    details: [...validationDetails, ...normalizeDetails(body.details ?? body.Details)],
    requestId,
    redactionApplied: firstBoolean(body.redactionApplied, body.RedactionApplied) ?? true,
    httpStatus,
    localErrorId
  };
}

function isFrontendApiError(input: unknown): input is FrontendApiError {
  if (!input || typeof input !== 'object') {
    return false;
  }

  const candidate = input as Partial<FrontendApiError>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.httpStatus === 'number' &&
    typeof candidate.localErrorId === 'string' &&
    Array.isArray(candidate.details)
  );
}

export function toApiErrorDisplayModel(error: FrontendApiError): ApiErrorDisplayModel {
  return {
    title: error.code,
    message: error.message,
    trackingId: error.requestId ?? error.localErrorId,
    httpStatus: error.httpStatus
  };
}

function readErrorBody(input: unknown): ErrorEnvelope {
  if (typeof input === 'string') {
    return { error: input };
  }

  if (input && typeof input === 'object') {
    return input as ErrorEnvelope;
  }

  return {};
}

function readLegacyErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === 'object') {
    const envelope = error as ErrorEnvelope;
    return firstString(envelope.message, envelope.Message);
  }

  return undefined;
}

function normalizeDetails(details: unknown): readonly FrontendApiErrorDetail[] {
  if (!Array.isArray(details)) {
    return [];
  }

  return details
    .map((detail): FrontendApiErrorDetail | null => {
      if (typeof detail === 'string') {
        return { message: detail };
      }

      if (!detail || typeof detail !== 'object') {
        return null;
      }

      const envelope = detail as ErrorEnvelope;
      const code = firstString(envelope.code, envelope.Code);
      const message = firstString(envelope.message, envelope.Message) ?? firstString(envelope.error) ?? code;
      if (!message) {
        return null;
      }

      return {
        code,
        message,
        target: firstString(envelope.target, envelope.Target)
      };
    })
    .filter((detail): detail is FrontendApiErrorDetail => detail !== null);
}

function normalizeValidationErrors(errors: unknown): readonly FrontendApiErrorDetail[] {
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) {
    return [];
  }

  return Object.entries(errors as Record<string, unknown>).flatMap(([target, messages]) => {
    const normalizedMessages = Array.isArray(messages) ? messages : [messages];

    return normalizedMessages
      .map((message): FrontendApiErrorDetail | null => {
        if (typeof message !== 'string' || message.trim().length === 0) {
          return null;
        }

        return {
          target,
          message
        };
      })
      .filter((detail): detail is FrontendApiErrorDetail => detail !== null);
  });
}

function statusCodeToCode(status: number): string {
  if (status === 0) {
    return 'NetworkError';
  }

  return `Http${status}`;
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function firstBoolean(...values: readonly unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }

  return undefined;
}

function createLocalErrorId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
