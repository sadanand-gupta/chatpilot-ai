import type { ChatMessage, Conversation, Lead, Paginated, UserProfile } from '@chatpilot/shared';
import type { ConversationQuery, ConversationRecord, LeadQuery, Page, Store } from '../data/store';
import { forbidden, notFound } from '../lib/errors';
import { encodeCursor } from '../lib/http';
import type { PlanService } from './plans';

/**
 * Conversations & leads (tenant-scoped). Text search `q` filters in memory over
 * a bounded window (at most SEARCH_SCAN_PAGES x 100 newest records per request);
 * the returned cursor continues the scan. Full-text search would need an
 * external index (e.g. Algolia/Typesense) — documented limitation.
 */

const SEARCH_SCAN_PAGES = 5;
const SEARCH_PAGE = 100;

export async function searchWindow<T extends { id: string }>(
  fetch: (limit: number, cursor?: string) => Promise<Page<T>>,
  match: (item: T) => boolean,
  sortValue: (item: T) => string,
  limit: number,
  cursor?: string,
): Promise<Page<T>> {
  const items: T[] = [];
  let cur = cursor;
  for (let i = 0; i < SEARCH_SCAN_PAGES; i++) {
    const page = await fetch(SEARCH_PAGE, cur);
    for (let j = 0; j < page.items.length; j++) {
      const it = page.items[j];
      if (!match(it)) continue;
      items.push(it);
      if (items.length === limit) {
        const more = j < page.items.length - 1 || page.nextCursor;
        return { items, nextCursor: more ? encodeCursor(sortValue(it), it.id) : null };
      }
    }
    if (!page.nextCursor) return { items, nextCursor: null };
    cur = page.nextCursor;
  }
  return { items, nextCursor: cur ?? null };
}

const norm = (s: string | undefined) => (s ?? '').toLowerCase();

export function toConversation(c: ConversationRecord): Conversation {
  return {
    id: c.id,
    chatbotId: c.chatbotId,
    ownerId: c.ownerId,
    visitorId: c.visitorId,
    channel: c.channel,
    messageCount: c.messageCount ?? 0,
    lastMessagePreview: c.lastMessagePreview ?? '',
    hasLead: !!c.hasLead,
    pageUrl: c.pageUrl,
    createdAt: c.createdAt,
    lastMessageAt: c.lastMessageAt,
  };
}

export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  // CSV/formula injection: neutralise cells spreadsheet apps would evaluate.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export class RecordsService {
  constructor(
    private readonly store: Store,
    private readonly plans: PlanService,
  ) {}

  async listConversations(ownerId: string, q: ConversationQuery & { q?: string }): Promise<Paginated<Conversation>> {
    if (q.chatbotId && !(await this.store.getChatbotForOwner(ownerId, q.chatbotId))) return { items: [], nextCursor: null };
    let page: Page<ConversationRecord>;
    if (q.q) {
      const needle = q.q.toLowerCase();
      page = await searchWindow(
        (limit, cursor) => this.store.listConversations(ownerId, { ...q, limit, cursor }),
        (c) => norm(c.lastMessagePreview).includes(needle) || norm(c.visitorId).includes(needle) || c.id === q.q || norm(c.pageUrl).includes(needle),
        (c) => c.lastMessageAt,
        q.limit,
        q.cursor,
      );
    } else {
      page = await this.store.listConversations(ownerId, q);
    }
    return { items: page.items.map(toConversation), nextCursor: page.nextCursor };
  }

  async getConversation(ownerId: string, id: string): Promise<{ conversation: Conversation; messages: ChatMessage[] }> {
    const conv = await this.store.getConversationForOwner(ownerId, id);
    if (!conv) throw notFound('Conversation');
    const messages = await this.store.listMessages(id);
    return {
      conversation: toConversation(conv),
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        sources: m.sources,
        fallback: m.fallback,
        createdAt: m.createdAt,
      })),
    };
  }

  async deleteConversation(ownerId: string, id: string): Promise<void> {
    const conv = await this.store.getConversationForOwner(ownerId, id);
    if (!conv) throw notFound('Conversation');
    await this.store.deleteConversationCascade(id);
  }

  async listLeads(ownerId: string, q: LeadQuery & { q?: string }): Promise<Paginated<Lead>> {
    if (q.chatbotId && !(await this.store.getChatbotForOwner(ownerId, q.chatbotId))) return { items: [], nextCursor: null };
    if (!q.q) return this.store.listLeads(ownerId, q);
    const needle = q.q.toLowerCase();
    return searchWindow(
      (limit, cursor) => this.store.listLeads(ownerId, { ...q, limit, cursor }),
      (l) => [l.name, l.email, l.phone, l.message].some((f) => norm(f).includes(needle)),
      (l) => l.createdAt,
      q.limit,
      q.cursor,
    );
  }

  async deleteLead(ownerId: string, id: string): Promise<void> {
    const lead = await this.store.getLeadForOwner(ownerId, id);
    if (!lead) throw notFound('Lead');
    await this.store.deleteLead(id);
  }

  async exportLeadsCsv(user: UserProfile, chatbotId?: string): Promise<string> {
    const plan = await this.plans.get(user.planId);
    if (!plan.features.csvExport) throw forbidden(`CSV export is not included in the ${plan.name} plan.`, { feature: 'csvExport' });
    const bots = await this.store.listAllChatbots(user.uid);
    const names = new Map(bots.map((b) => [b.id, b.name]));
    if (chatbotId && !names.has(chatbotId)) throw notFound('Chatbot');
    const rows: string[] = [['Created at', 'Chatbot', 'Name', 'Email', 'Phone', 'Message', 'Page URL', 'Conversation ID'].map(csvCell).join(',')];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const page = await this.store.listLeads(user.uid, { chatbotId, limit: 100, cursor });
      for (const l of page.items) {
        rows.push([l.createdAt, names.get(l.chatbotId) ?? l.chatbotId, l.name, l.email, l.phone, l.message, l.pageUrl, l.conversationId].map(csvCell).join(','));
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return '﻿' + rows.join('\r\n') + '\r\n';
  }
}
