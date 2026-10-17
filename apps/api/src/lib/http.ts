import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { badRequest } from './errors';

/** Wraps async route handlers so rejections reach the error handler. */
export const asyncHandler =
  <R extends Request = Request>(fn: (req: R, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req as R, res, next).catch(next);
  };

export interface CursorValue {
  v: string | number;
  id: string;
}

export function encodeCursor(v: string | number, id: string): string {
  return Buffer.from(JSON.stringify([v, id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorValue | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[1] === 'string' && ['string', 'number'].includes(typeof parsed[0])) {
      return { v: parsed[0], id: parsed[1] };
    }
  } catch {
    /* fallthrough */
  }
  throw badRequest('Invalid cursor', { fieldErrors: { cursor: ['Invalid cursor'] } });
}

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(500).optional(),
});

export const isoDateParam = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
  .transform((v) => new Date(v).toISOString());

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export const nowIso = (): string => new Date().toISOString();

export function monthPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodResetAt(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString();
}
