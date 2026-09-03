import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

export interface AnnouncementAnalyticsDto {
  readonly announcementId?: unknown;
  readonly recipientCount?: unknown;
  readonly readCount?: unknown;
  readonly readRate?: unknown;
  readonly acknowledgedCount?: unknown;
  readonly acknowledgementRate?: unknown;
  readonly ctaClickCount?: unknown;
  readonly ctaClickThroughRate?: unknown;
  readonly periodStartUtc?: unknown;
  readonly periodEndUtc?: unknown;
  readonly denominatorKind?: unknown;
  readonly ctaMetric?: unknown;
  readonly medianTimeToRecognitionSeconds?: unknown;
}

export interface AnnouncementAnalyticsViewModel {
  readonly announcementId: string;
  readonly recipientCount: number;
  readonly readCount: number;
  readonly readRate: number;
  readonly acknowledgedCount?: number;
  readonly acknowledgementRate?: number;
  readonly ctaClickCount?: number;
  readonly ctaClickThroughRate?: number;
  readonly periodStartLabel: string;
  readonly periodEndLabel: string;
  readonly denominatorKind: 'frozenDeliveryCohort' | 'currentAuthorizedAudience';
  readonly ctaMetric?: 'clickThrough';
  readonly medianTimeToRecognitionSeconds?: number;
}

@Injectable({ providedIn: 'root' })
export class AnnouncementEngagementClient {
  private readonly http = inject(HttpClient);

  analytics(announcementId: string): Observable<AnnouncementAnalyticsViewModel | null> {
    return this.http
      .get<AnnouncementAnalyticsDto>(`/api/announcements/${announcementId}/analytics`, {
        withCredentials: true,
      })
      .pipe(map((dto) => mapAnnouncementAnalytics(dto)));
  }

  acknowledge(announcementId: string): Observable<unknown> {
    return this.http.post(
      `/api/announcements/${announcementId}/acknowledge`,
      {},
      { withCredentials: true },
    );
  }

  trackCtaClick(announcementId: string): Observable<unknown> {
    return this.http.post(
      `/api/announcements/${announcementId}/cta-click`,
      {},
      { withCredentials: true },
    );
  }
}

export function mapAnnouncementAnalytics(
  dto: AnnouncementAnalyticsDto,
): AnnouncementAnalyticsViewModel | null {
  const announcementId = stringValue(dto.announcementId);
  const recipientCount = nonNegativeInteger(dto.recipientCount);
  const readCount = nonNegativeInteger(dto.readCount);
  const readRate = rateValue(dto.readRate);
  const periodStart = dateValue(dto.periodStartUtc);
  const periodEnd = dateValue(dto.periodEndUtc);
  const denominatorKind = denominatorValue(dto.denominatorKind);
  if (
    !announcementId ||
    recipientCount === undefined ||
    readCount === undefined ||
    readCount > recipientCount ||
    readRate === undefined ||
    !periodStart ||
    !periodEnd ||
    !denominatorKind
  ) {
    return null;
  }

  const acknowledgedCount = nullableCount(dto.acknowledgedCount, recipientCount);
  const acknowledgementRate = nullableRate(dto.acknowledgementRate);
  const ctaClickCount = nullableCount(dto.ctaClickCount, recipientCount);
  const ctaClickThroughRate = nullableRate(dto.ctaClickThroughRate);
  const ctaMetric = dto.ctaMetric === 'clickThrough' ? 'clickThrough' : undefined;
  const medianTimeToRecognitionSeconds = nonNegativeNumber(dto.medianTimeToRecognitionSeconds);

  if (
    (acknowledgedCount === undefined) !== (acknowledgementRate === undefined) ||
    (ctaClickCount === undefined) !== (ctaClickThroughRate === undefined) ||
    (ctaClickCount !== undefined && ctaMetric !== 'clickThrough')
  ) {
    return null;
  }

  return {
    announcementId,
    recipientCount,
    readCount,
    readRate,
    ...(acknowledgedCount !== undefined
      ? { acknowledgedCount, acknowledgementRate: acknowledgementRate! }
      : {}),
    ...(ctaClickCount !== undefined
      ? { ctaClickCount, ctaClickThroughRate: ctaClickThroughRate!, ctaMetric: 'clickThrough' as const }
      : {}),
    periodStartLabel: periodStart.toLocaleString(),
    periodEndLabel: periodEnd.toLocaleString(),
    denominatorKind,
    ...(medianTimeToRecognitionSeconds !== undefined ? { medianTimeToRecognitionSeconds } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function rateValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function nullableCount(value: unknown, maximum: number): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const count = nonNegativeInteger(value);
  return count !== undefined && count <= maximum ? count : undefined;
}

function nullableRate(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : rateValue(value);
}

function dateValue(value: unknown): Date | undefined {
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function denominatorValue(
  value: unknown,
): AnnouncementAnalyticsViewModel['denominatorKind'] | undefined {
  return value === 'frozenDeliveryCohort' || value === 'currentAuthorizedAudience'
    ? value
    : undefined;
}
