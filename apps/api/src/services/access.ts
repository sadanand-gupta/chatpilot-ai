import type { Chatbot } from '@chatpilot/shared';
import type { ChatbotRecord, Store } from '../data/store';
import { notFound } from '../lib/errors';

/** Loads a chatbot owned by ownerId or throws 404 (never reveals other tenants' resources). */
export async function requireOwnedBot(store: Store, ownerId: string, chatbotId: string): Promise<ChatbotRecord> {
  const bot = await store.getChatbotForOwner(ownerId, chatbotId);
  if (!bot || bot.isDemo) throw notFound('Chatbot');
  return bot;
}

/** Strips internal-only fields before returning a chatbot to its owner. */
export function toChatbotDto(bot: ChatbotRecord): Chatbot {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { demo, demoMessages, ...rest } = bot;
  return {
    ...rest,
    allowedOrigins: rest.allowedOrigins ?? [],
    knowledgeVersion: rest.knowledgeVersion ?? 0,
    stats: { sources: 0, chunks: 0, conversations: 0, leads: 0, ...(rest.stats ?? {}) },
  };
}
