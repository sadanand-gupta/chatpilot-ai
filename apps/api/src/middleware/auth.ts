import type { NextFunction, Request, Response } from 'express';
import type { UserProfile } from '@chatpilot/shared';
import { jwtVerify, SignJWT } from 'jose';
import { unauthorized } from '../lib/errors';
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
}

export interface TokenVerifier {
  readonly mode: 'firebase' | 'dev';
  verify(token: string): Promise<VerifiedIdentity>;
}

const DEV_ISSUER = 'chatpilot-dev';

/** Firebase ID tokens, verified with revocation check. The uid comes ONLY from the verified token. */
export function firebaseVerifier(auth: { verifyIdToken(token: string, checkRevoked?: boolean): Promise<{ uid: string; email?: string; name?: string }> }): TokenVerifier {
  return {
    mode: 'firebase',
    async verify(token) {
      const decoded = await auth.verifyIdToken(token, true);
      return { uid: decoded.uid, email: decoded.email ?? '', name: decoded.name };
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
      return { uid: payload.sub, email: String(payload.email ?? '') };
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

export function requireAuth(verifier: TokenVerifier, users: UserService) {
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
      req.user = await users.ensureUser(identity.uid, identity.email, identity.name);
      next();
    } catch (e) {
      next(e);
    }
  };
}
