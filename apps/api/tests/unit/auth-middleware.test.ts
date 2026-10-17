import express, { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/logger';
import { errorHandler } from '../../src/middleware/errorHandler';
import { firebaseVerifier, requireAuth, type TokenVerifier } from '../../src/middleware/auth';
import type { UserService } from '../../src/services/users';

type Claims = { uid: string; email?: string; email_verified?: boolean; firebase?: { sign_in_provider?: string } };

/** Firebase verifier over a fake verifyIdToken: the bearer token selects the decoded claims. */
function makeApp(tokens: Record<string, Claims>) {
  const verifier: TokenVerifier = firebaseVerifier({
    verifyIdToken: async (token) => {
      const claims = tokens[token];
      if (!claims) throw new Error('invalid token');
      return claims;
    },
  });
  const ensureUser = vi.fn(async (uid: string, email: string) => ({ uid, email }));
  const users = { ensureUser } as unknown as UserService;
  const priv = Router();
  priv.use(requireAuth(verifier, users));
  priv.get('/me', (req, res) => res.json({ uid: req.user!.uid }));
  priv.patch('/me', (req, res) => res.json({ ok: true, uid: req.user!.uid }));
  priv.delete('/me', (_req, res) => res.json({ ok: true }));
  priv.get('/chatbots', (_req, res) => res.json({ items: [] }));
  priv.post('/chatbots', (_req, res) => res.status(201).json({ id: 'b1' }));
  const app = express();
  app.use(express.json());
  app.use('/api', priv);
  app.use(errorHandler(createLogger('silent')));
  return { agent: request(app), ensureUser };
}

const provider = (sign_in_provider: string) => ({ firebase: { sign_in_provider } });
const tokens: Record<string, Claims> = {
  google: { uid: 'g-user', email: 'g@gmail.com', email_verified: true, ...provider('google.com') },
  password: { uid: 'pw-user', email: 'old@example.com', email_verified: true, ...provider('password') },
  noProvider: { uid: 'odd-user', email: 'odd@example.com', email_verified: true },
  customVerified: { uid: 'smoke-ok', email: 'smoke@example.com', email_verified: true, ...provider('custom') },
  customUnverified: { uid: 'smoke-new', email: 'new@example.com', email_verified: false, ...provider('custom') },
  customNoClaim: { uid: 'smoke-odd', email: 'odd2@example.com', ...provider('custom') },
};
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('requireAuth sign-in provider (firebase tokens)', () => {
  it('lets Google users use owner endpoints', async () => {
    const { agent } = makeApp(tokens);
    expect((await agent.get('/api/chatbots').set(bearer('google'))).status).toBe(200);
    expect((await agent.post('/api/chatbots').set(bearer('google')).send({})).status).toBe(201);
    expect((await agent.get('/api/me').set(bearer('google'))).status).toBe(200);
  });

  it('rejects email/password and provider-less tokens everywhere with 403 google_sign_in_required', async () => {
    const { agent, ensureUser } = makeApp(tokens);
    for (const token of ['password', 'noProvider']) {
      for (const [method, path] of [
        ['get', '/api/me'],
        ['patch', '/api/me'],
        ['get', '/api/chatbots'],
        ['post', '/api/chatbots'],
      ] as const) {
        const res = await agent[method](path).set(bearer(token));
        expect(res.status, `${token} ${method} ${path}`).toBe(403);
        expect(res.body.error.code).toBe('google_sign_in_required');
      }
    }
    // Rejected before a user record is created.
    expect(ensureUser).not.toHaveBeenCalled();
  });

  it('accepts service-account custom tokens (smoke tests)', async () => {
    const { agent } = makeApp(tokens);
    expect((await agent.get('/api/chatbots').set(bearer('customVerified'))).status).toBe(200);
  });

  it('still requires a verified email, treating a missing claim as unverified', async () => {
    const { agent } = makeApp(tokens);
    for (const token of ['customUnverified', 'customNoClaim']) {
      const res = await agent.get('/api/chatbots').set(bearer(token));
      expect(res.status, token).toBe(403);
      expect(res.body.error.code).toBe('email_not_verified');
    }
    expect((await agent.get('/api/me').set(bearer('customUnverified'))).status).toBe(200);
  });

  it('still returns 401 for missing or invalid tokens', async () => {
    const { agent } = makeApp(tokens);
    expect((await agent.get('/api/chatbots')).status).toBe(401);
    expect((await agent.get('/api/me').set(bearer('forged'))).status).toBe(401);
  });
});
