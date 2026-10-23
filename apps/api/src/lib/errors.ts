import type { ApiErrorCode, QuotaErrorDetails } from '@chatpilot/shared';

/** An error that is safe to show to API clients. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'validation_error', message, details);
export const invalidUrl = (message: string) => new AppError(400, 'invalid_url', message);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource', details?: unknown) =>
  new AppError(403, 'forbidden', message, details);
export const accountSuspended = () =>
  new AppError(403, 'account_suspended', 'This account has been suspended. Contact support if you think this is a mistake.');
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const rateLimited = (message = 'Too many requests, please slow down.') => new AppError(429, 'rate_limited', message);
export const aiUnavailable = (message = 'The AI service is temporarily unavailable. Please try again.') =>
  new AppError(503, 'ai_unavailable', message);
export const quotaExceeded = (details: QuotaErrorDetails, message?: string) =>
  new AppError(
    402,
    'quota_exceeded',
    message ?? `Monthly ${details.metric} limit reached (${details.used}/${details.limit}) on your plan. It resets on ${details.resetAt.slice(0, 10)}.`,
    details,
  );
