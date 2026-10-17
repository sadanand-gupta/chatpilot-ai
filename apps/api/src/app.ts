import crypto from 'node:crypto';
import compression from 'compression';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { buildContext, type AppContext, type AppDeps } from './context';
import { requireAuth } from './middleware/auth';
import { corsMiddleware } from './middleware/cors';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createRateLimiters } from './middleware/rateLimit';
import { accountRoutes } from './routes/account';
import { chatbotRoutes } from './routes/chatbots';
import { publicRoutes } from './routes/public';
import { adminRoutes, devRoutes, healthRoutes, widgetRoutes } from './routes/system';

export interface CreatedApp {
  app: Express;
  ctx: AppContext;
  /** Stops background work (cleanup timer, crawl jobs) and flushes the store. */
  shutdown(): Promise<void>;
}

export function createApp(deps: AppDeps): CreatedApp {
  const ctx = buildContext(deps);
  const { env, logger } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  app.set('etag', false);

  // Request id + access log (method, route template, status, latency — never bodies).
  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    req.requestId = typeof incoming === 'string' && /^[\w-]{6,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched';
      // Successful /health hits (Render health checks, dashboard keep-warm pings) are debug-only noise.
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : req.path === '/health' ? 'debug' : 'info';
      logger[level]({ reqId: req.requestId, method: req.method, route, status: res.statusCode, ms: Math.round(ms) }, 'request');
    });
    next();
  });

  app.use(
    helmet({
      // The API and widget are consumed cross-origin (dashboard, customer websites).
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: { useDefaults: true, directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] } },
    }),
  );
  app.use(corsMiddleware([...env.FRONTEND_URLS, env.PUBLIC_APP_URL]));
  app.use(compression());
  app.use(express.json({ limit: '64kb' }));

  const rl = createRateLimiters(env);

  app.use(healthRoutes(ctx));
  app.use(widgetRoutes(ctx));

  // Global per-IP limiter for anonymous traffic. Authenticated private requests use a
  // per-user limiter after auth; demo polling has its own limiter.
  app.use('/api', (req, res, next) => {
    const isPublic = req.path.startsWith('/public/');
    if (!isPublic && /^Bearer\s+\S+/i.test(req.headers.authorization ?? '')) return next();
    if (req.method === 'GET' && /^\/public\/demo\/[^/]+$/.test(req.path)) return next();
    return rl.global(req, res, next);
  });
  app.use('/api/public', publicRoutes(ctx, rl), notFoundHandler);

  if (env.AUTH_MODE === 'dev' && env.NODE_ENV !== 'production') {
    app.use('/api/dev', devRoutes(ctx, rl), notFoundHandler);
  }
  app.use('/api/admin', adminRoutes(ctx), notFoundHandler);

  const priv = Router();
  priv.use(requireAuth(ctx.verifier, ctx.users));
  priv.use(rl.privateUser);
  priv.use(accountRoutes(ctx));
  priv.use('/chatbots', chatbotRoutes(ctx, rl));
  app.use('/api', priv);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return {
    app,
    ctx,
    async shutdown() {
      ctx.cleanup.stop();
      ctx.queue.abortAll();
      ctx.crawls.demoQueue.abortAll();
      await Promise.race([Promise.all([ctx.queue.idle(), ctx.crawls.demoQueue.idle()]), new Promise((r) => setTimeout(r, 5000))]);
      await ctx.store.flush();
    },
  };
}
