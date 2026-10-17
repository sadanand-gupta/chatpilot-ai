import crypto from 'node:crypto';

/**
 * HMAC-SHA256 token binding a conversation to a chatbot's public id AND the
 * anonymous visitor id, so a leaked conversation id cannot be continued by
 * someone else.
 */
export function signConversationToken(secret: string, conversationId: string, publicId: string, visitorId: string): string {
  return crypto.createHmac('sha256', secret).update(`${conversationId}:${publicId}:${visitorId}`).digest('base64url');
}

export function verifyConversationToken(
  secret: string,
  conversationId: string,
  publicId: string,
  visitorId: string,
  token: string | undefined,
): boolean {
  if (!token || !conversationId || !visitorId) return false;
  const expected = Buffer.from(signConversationToken(secret, conversationId, publicId, visitorId));
  const given = Buffer.from(token);
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

/** Constant-time comparison of two secrets of any length. */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
