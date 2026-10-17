import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import type { Logger } from '../lib/logger';

/** Maps every error to `{ error: { code, message, details } }` — never leaks stack traces. */
export function errorHandler(logger: Logger) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof ZodError) {
      const flat = err.flatten();
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: err.issues[0]?.message ? `Invalid request: ${err.issues[0].path.join('.') || 'body'} - ${err.issues[0].message}` : 'Invalid request',
          details: { fieldErrors: flat.fieldErrors, formErrors: flat.formErrors },
        },
      });
      return;
    }
    if (err instanceof AppError) {
      if (err.status >= 500) logger.error({ reqId: req.requestId, code: err.code }, err.message);
      res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } });
      return;
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } });
      return;
    }
    if (e?.type === 'entity.parse.failed' || e?.type === 'encoding.unsupported') {
      res.status(400).json({ error: { code: 'validation_error', message: 'Request body must be valid JSON.' } });
      return;
    }
    logger.error({ reqId: req.requestId, err: e?.message, stack: (err as Error)?.stack }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Please try again.', details: { requestId: req.requestId } } });
  };
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}
