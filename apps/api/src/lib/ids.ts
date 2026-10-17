import crypto from 'node:crypto';

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const URLSAFE = ALPHANUM + '-_';

function randomFrom(alphabet: string, length: number): string {
  // Rejection sampling keeps the distribution uniform.
  const out: string[] = [];
  const max = 256 - (256 % alphabet.length);
  while (out.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (const b of bytes) {
      if (b < max) out.push(alphabet[b % alphabet.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** Firestore-style 20 char document id. */
export const newId = (): string => randomFrom(ALPHANUM, 20);
/** Public chatbot id used in the embed snippet (not a secret). */
export const newPublicId = (): string => `cb_${randomFrom(URLSAFE, 16)}`;
export const newPreviewToken = (): string => `pv_${randomFrom(URLSAFE, 32)}`;
/** Stable uid derived from an email (dev auth only). */
export const devUidFromEmail = (email: string): string =>
  'dev_' + crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24);
export const sha1 = (s: string): string => crypto.createHash('sha1').update(s).digest('hex');
