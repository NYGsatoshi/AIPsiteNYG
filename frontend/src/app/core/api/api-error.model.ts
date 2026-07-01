export interface FrontendApiErrorDetail {
  readonly code?: string;
  readonly message: string;
  readonly target?: string;
}

export interface FrontendApiError {
  readonly code: string;
  readonly message: string;
  readonly target?: string;
  readonly details: readonly FrontendApiErrorDetail[];
  readonly requestId?: string;
  readonly redactionApplied: boolean;
  readonly httpStatus: number;
  readonly localErrorId: string;
}

export interface ApiErrorDisplayModel {
  readonly title: string;
  readonly message: string;
  readonly trackingId: string;
  readonly httpStatus: number;
}
