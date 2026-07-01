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
});
