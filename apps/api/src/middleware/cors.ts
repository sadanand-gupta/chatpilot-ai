import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';

/**
 * Public routes (/api/public/*, /widget.js, /health) are open to any origin
 * without credentials. Private /api/* routes only accept the dashboard origins
 * (FRONTEND_URLS) and the Authorization header.
 */
export function corsMiddleware(frontendUrls: string[]) {
  const publicCors = cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-Preview-Token'], maxAge: 600, credentials: false });
  const allowed = new Set(
    frontendUrls.map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return u.replace(/\/$/, '');
      }
    }),
  );
  const privateCors = cors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin) ? origin ?? false : false),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
    maxAge: 600,
    credentials: false,
  });
  return (req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (p.startsWith('/api/public/') || p === '/api/public' || p.startsWith('/widget') || p === '/health') return publicCors(req, res, next);
    return privateCors(req, res, next);
  };
}
