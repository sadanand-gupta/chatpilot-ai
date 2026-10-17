import express, { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/logger';
import { errorHandler } from '../../src/middleware/errorHandler';
import { firebaseVerifier, requireAuth, type TokenVerifier } from '../../src/middleware/auth';
import type { UserService } from '../../src/services/users';

type Claims = { uid: string; email?: string; email_verified?: boolean };

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

const tokens: Record<string, Claims> = {
  unverified: { uid: 'pw-user', email: 'new@example.com', email_verified: false },
  verified: { uid: 'pw-verified', email: 'ok@example.com', email_verified: true },
  google: { uid: 'g-user', email: 'g@gmail.com', email_verified: true },
  noClaim: { uid: 'odd-user', email: 'odd@example.com' },
};
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('requireAuth email verification (firebase tokens)', () => {
  it('rejects unverified email/password users on owner endpoints with 403 email_not_verified', async () => {
    const { agent, ensureUser } = makeApp(tokens);
    for (const [method, path] of [
      ['get', '/api/chatbots'],
      ['post', '/api/chatbots'],
      ['delete', '/api/me'],
    ] as const) {
      const res = await agent[method](path).set(bearer('unverified'));
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe('email_not_verified');
    }
    // Rejected before a user record is created.
    expect(ensureUser).not.toHaveBeenCalled();
  });

  it('treats a missing email_verified claim as unverified', async () => {
    const { agent } = makeApp(tokens);
    const res = await agent.get('/api/chatbots').set(bearer('noClaim'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('email_not_verified');
  });

  it('allows GET and PATCH /me for unverified users (sign-up / verify flow)', async () => {
    const { agent } = makeApp(tokens);
    expect((await agent.get('/api/me').set(bearer('unverified'))).status).toBe(200);
    const patched = await agent.patch('/api/me').set(bearer('unverified')).send({ displayName: 'New' });
    expect(patched.status).toBe(200);
    expect(patched.body.uid).toBe('pw-user');
  });

  it('lets verified and Google users use owner endpoints', async () => {
    const { agent } = makeApp(tokens);
    expect((await agent.get('/api/chatbots').set(bearer('verified'))).status).toBe(200);
    expect((await agent.post('/api/chatbots').set(bearer('google')).send({})).status).toBe(201);
  });

  it('still returns 401 for missing or invalid tokens', async () => {
    const { agent } = makeApp(tokens);
    expect((await agent.get('/api/chatbots')).status).toBe(401);
    expect((await agent.get('/api/me').set(bearer('forged'))).status).toBe(401);
  });
});
