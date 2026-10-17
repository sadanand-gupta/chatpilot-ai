import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

/** Validates and replaces req.body with the parsed value (ZodError -> 400 via errorHandler). */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.body ?? {});
    if (!r.success) return next(r.error);
    req.body = r.data as z.infer<S>;
    next();
  };
}

export function parseQuery<S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.query) as z.infer<S>;
}
