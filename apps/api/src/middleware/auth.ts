import type { NextFunction, Request, Response } from 'express';
import type { UserProfile } from '@chatpilot/shared';
import { jwtVerify, SignJWT } from 'jose';
import { AppError, unauthorized } from '../lib/errors';
import { devUidFromEmail } from '../lib/ids';
import type { UserService } from '../services/users';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserProfile;
      requestId?: string;
    }
  }
}

export interface VerifiedIdentity {
  uid: string;
  email: string;
  name?: string;
  /** Firebase `email_verified` claim. Dev tokens are always treated as verified. */
  emailVerified: boolean;
}

export interface TokenVerifier {
  readonly mode: 'firebase' | 'dev';
  verify(token: string): Promise<VerifiedIdentity>;
}

const DEV_ISSUER = 'chatpilot-dev';

/** Firebase ID tokens, verified with revocation check. The uid comes ONLY from the verified token. */
export function firebaseVerifier(auth: {
  verifyIdToken(token: string, checkRevoked?: boolean): Promise<{ uid: string; email?: string; name?: string; email_verified?: boolean }>;
}): TokenVerifier {
  return {
    mode: 'firebase',
    async verify(token) {
      const decoded = await auth.verifyIdToken(token, true);
      // Google and other OAuth providers set email_verified=true; email/password users only after
      // clicking the verification link (and refreshing their ID token).
      return { uid: decoded.uid, email: decoded.email ?? '', name: decoded.name, emailVerified: decoded.email_verified === true };
    },
  };
}

/** DEV ONLY: HS256 tokens issued by POST /api/dev/login. */
export function devVerifier(secret: string): TokenVerifier {
  const key = new TextEncoder().encode(secret);
  return {
    mode: 'dev',
    async verify(token) {
      const { payload } = await jwtVerify(token, key, { issuer: DEV_ISSUER, algorithms: ['HS256'] });
      if (!payload.sub) throw new Error('missing sub');
      return { uid: payload.sub, email: String(payload.email ?? ''), emailVerified: true };
    },
  };
}

export async function signDevToken(secret: string, email: string): Promise<{ token: string; uid: string; email: string }> {
  const normalized = email.trim().toLowerCase();
  const uid = devUidFromEmail(normalized);
  const token = await new SignJWT({ email: normalized })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(uid)
    .setIssuer(DEV_ISSUER)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
  return { token, uid, email: normalized };
}

export const emailNotVerified = () =>
  new AppError(403, 'email_not_verified', 'Please verify your email address before using your account. Check your inbox for the verification link.');

/**
 * Endpoints an unverified user may call: reading and updating their own profile (/me), which the
 * sign-up and verify-email flow needs. Everything else requires a verified email.
 */
export function allowUnverifiedDefault(req: Request): boolean {
  return req.path === '/me' && (req.method === 'GET' || req.method === 'PATCH' || req.method === 'HEAD' || req.method === 'OPTIONS');
}

export function requireAuth(
  verifier: TokenVerifier,
  users: UserService,
  opts: { allowUnverified?: (req: Request) => boolean } = {},
) {
  const allowUnverified = opts.allowUnverified ?? allowUnverifiedDefault;
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization ?? '';
      const m = /^Bearer\s+(.+)$/i.exec(header);
      if (!m) throw unauthorized();
      let identity: VerifiedIdentity;
      try {
        identity = await verifier.verify(m[1].trim());
      } catch {
        throw unauthorized('Your session is invalid or has expired. Please sign in again.');
      }
      if (!identity.emailVerified && !allowUnverified(req)) throw emailNotVerified();
      req.user = await users.ensureUser(identity.uid, identity.email, identity.name);
      next();
    } catch (e) {
      next(e);
    }
  };
}
