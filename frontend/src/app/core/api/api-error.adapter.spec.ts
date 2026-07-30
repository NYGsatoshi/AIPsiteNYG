import { HttpErrorResponse } from '@angular/common/http';

import { normalizeApiError, toApiErrorDisplayModel } from './api-error.adapter';

describe('api error adapter', () => {
  it('normalizes legacy error shape', () => {
    const error = normalizeApiError(new HttpErrorResponse({ status: 400, error: { error: 'Legacy failure' } }));

    expect(error.code).toBe('Http400');
    expect(error.message).toBe('Legacy failure');
    expect(error.httpStatus).toBe(400);
  });

  it('uses backend requestId before local error id in display models', () => {
    const error = normalizeApiError(
      new HttpErrorResponse({
        status: 500,
        error: {
          code: 'InternalServerError',
          message: 'An unexpected server error occurred.',
          requestId: 'request-123'
        }
      })
    );

    expect(error.requestId).toBe('request-123');
    expect(toApiErrorDisplayModel(error).trackingId).toBe('request-123');
  });

  it('supports existing ErrorResponse trace IDs as request IDs', () => {
    const error = normalizeApiError(
      new HttpErrorResponse({
        status: 500,
        error: {
          Code: 'InternalServerError',
          Message: 'An unexpected server error occurred.',
          TraceId: 'trace-abc'
        }
      })
    );

    expect(error.code).toBe('InternalServerError');
    expect(error.requestId).toBe('trace-abc');
  });

  it('preserves ProblemDetails validation errors as displayable details', () => {
    const error = normalizeApiError(
      new HttpErrorResponse({
        status: 400,
        error: {
          title: 'One or more validation errors occurred.',
          traceId: 'trace-validation',
          errors: {
            Role: ['The JSON value could not be converted to WorkspaceRole.'],
            Email: ['The Email field is required.']
          }
        }
      })
    );

    expect(error.message).toBe('One or more validation errors occurred.');
    expect(error.requestId).toBe('trace-validation');
    expect(error.details).toEqual([
      { target: 'Role', message: 'The JSON value could not be converted to WorkspaceRole.' },
      { target: 'Email', message: 'The Email field is required.' }
    ]);
  });

  it('normalizes stale-version codes from top-level, nested, HTTP-only, and details envelopes', () => {
    expect(normalizeApiError(new HttpErrorResponse({ status: 409, error: { code: 'TASK_STALE_VERSION' } })).code).toBe('TASK_STALE_VERSION');
    expect(normalizeApiError(new HttpErrorResponse({ status: 409, error: { error: { code: 'TASK_STALE_VERSION', message: 'Stale' } } })).code).toBe('TASK_STALE_VERSION');
    expect(normalizeApiError(new HttpErrorResponse({ status: 409, error: {} })).code).toBe('Http409');
    expect(normalizeApiError(new HttpErrorResponse({ status: 409, error: { details: [{ code: 'TASK_STALE_VERSION' }] } })).details).toContainEqual({ code: 'TASK_STALE_VERSION', message: 'TASK_STALE_VERSION', target: undefined });
  });

  it('preserves target, details, and redaction metadata from the nested safe error envelope', () => {
    const error = normalizeApiError(
      new HttpErrorResponse({
        status: 409,
        error: {
          requestId: 'gantt-conflict-1',
          error: {
            code: 'TASK_STALE_VERSION',
            message: 'The Task changed. Refetch the authoritative schedule.',
            target: 'expectedVersion',
            details: [
              {
                code: 'AUTHORITATIVE_REFETCH_REQUIRED',
                message: 'Reload the Task before retrying.',
                target: 'taskId'
              }
            ],
            redactionApplied: false
          }
        }
      })
    );

    expect(error).toMatchObject({
      code: 'TASK_STALE_VERSION',
      target: 'expectedVersion',
      requestId: 'gantt-conflict-1',
      redactionApplied: false
    });
    expect(error.details).toEqual([
      {
        code: 'AUTHORITATIVE_REFETCH_REQUIRED',
        message: 'Reload the Task before retrying.',
        target: 'taskId'
      }
    ]);
  });
});
