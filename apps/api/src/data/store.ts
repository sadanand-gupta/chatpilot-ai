import type {
  ActivityEvent,
  ActivityEventType,
  Chatbot,
  ChatbotConfig,
  ChatMessage,
  Conversation,
  CrawlJob,
  DemoStatus,
  KnowledgeChunk,
  KnowledgeSource,
  Lead,
  Plan,
  PublishedVersion,
  Usage,
  UsageMetric,
  UserProfile,
} from '@chatpilot/shared';
import { decodeCursor, encodeCursor } from '../lib/http';
import { increment, type BatchOp, type DocDB, type QuerySpec, type Where } from './docdb';

/**
 * Data access layer. Every query that serves a private (tenant) route takes an
 * ownerId and filters by it; subcollection reads (sources, chunks, crawl jobs)
 * are only reachable after the parent chatbot's ownership was verified with
 * getChatbotForOwner(). Records also carry ownerId and are double-checked.
 */

export const DEMO_OWNER = '__demo__';

export interface ChatbotRecord extends Chatbot {
  demo?: { status: DemoStatus; url: string; jobId?: string; error?: string; pagesProcessed: number };
  /** Messages answered by a demo bot (DEMO_MAX_MESSAGES cap). */
  demoMessages?: number;
}

/** publicConfigs/{publicId} — the only document the widget path reads. */
export interface PublicConfigDoc {
  publicId: string;
  chatbotId: string;
  ownerId: string;
  version: number;
  config: ChatbotConfig;
  businessName: string;
  status: 'published' | 'unpublished';
  allowedOrigins: string[];
  isDemo: boolean;
  expiresAt?: string;
  updatedAt: string;
}

export interface ConversationRecord extends Conversation {
  publicId: string;
  userMessageCount: number;
  /** Demo conversations expire with their bot (TTL). */
  expiresAt?: string;
}

export interface MessageRecord extends ChatMessage {
  chatbotId: string;
  ownerId: string;
}

export type UsageCounters = Omit<Usage, 'resetAt'>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListOpts {
  limit: number;
  cursor?: string;
}

export interface ConversationQuery extends ListOpts {
  chatbotId?: string;
  from?: string;
  to?: string;
}

export interface LeadQuery extends ListOpts {
  chatbotId?: string;
}

export interface ActivityQuery extends ListOpts {
  type?: ActivityEventType;
  uid?: string;
}

export interface SourceWithChunks {
  source: KnowledgeSource;
  chunks: KnowledgeChunk[];
}

export interface Store {
  readonly kind: 'firestore' | 'file';
  // users
  getUser(uid: string): Promise<UserProfile | null>;
  createUser(user: UserProfile): Promise<void>;
  updateUser(uid: string, patch: Partial<UserProfile>): Promise<void>;
  listUsers(limit: number, afterUid?: string): Promise<UserProfile[]>;
  /** Records activity: always bumps lastActiveAt; a new session also bumps lastSignInAt + signInCount. */
  touchUser(uid: string, at: string, newSession: boolean): Promise<void>;
  // activity log (admin console)
  addActivity(event: ActivityEvent): Promise<void>;
  updateActivity(id: string, patch: Record<string, unknown>): Promise<void>;
  listActivity(q: ActivityQuery): Promise<Page<ActivityEvent>>;
  activitySince(fromIso: string, max: number): Promise<Pick<ActivityEvent, 'type' | 'createdAt'>[]>;
  deleteActivityBefore(beforeIso: string): Promise<number>;
  // cross-tenant reads — ADMIN CONSOLE ONLY, never reachable from tenant routes
  listUsersNewest(opts: ListOpts): Promise<Page<UserProfile>>;
  countUsers(activeSinceIso?: string): Promise<number>;
  userCreatedDates(fromIso: string, max: number): Promise<string[]>;
  listTenantChatbots(opts: ListOpts): Promise<Page<ChatbotRecord>>;
  countTenantChatbots(status?: Chatbot['status']): Promise<number>;
  listAllConversations(q: ConversationQuery): Promise<Page<ConversationRecord>>;
  listAllLeads(opts: ListOpts): Promise<Page<Lead>>;
  countAll(collection: 'conversations' | 'leads'): Promise<number>;
  // plans
  listPlanDocs(): Promise<Partial<Plan>[]>;
  // chatbots
  createChatbot(bot: ChatbotRecord): Promise<void>;
  getChatbot(id: string): Promise<ChatbotRecord | null>;
  getChatbotForOwner(ownerId: string, id: string): Promise<ChatbotRecord | null>;
  findChatbotByPublicId(publicId: string): Promise<ChatbotRecord | null>;
  listChatbots(ownerId: string, opts: ListOpts): Promise<Page<ChatbotRecord>>;
  listAllChatbots(ownerId: string, max?: number): Promise<ChatbotRecord[]>;
  countChatbots(ownerId: string): Promise<number>;
  updateChatbot(id: string, patch: Record<string, unknown>): Promise<void>;
  deleteChatbotCascade(id: string): Promise<void>;
  listExpiredDemoBots(nowIso: string, limit: number): Promise<ChatbotRecord[]>;
  // publishing
  publishVersion(version: PublishedVersion, pointer: PublicConfigDoc, chatbotPatch: Record<string, unknown>): Promise<void>;
  getPublicConfig(publicId: string): Promise<PublicConfigDoc | null>;
  updatePublicConfig(publicId: string, patch: Partial<PublicConfigDoc>): Promise<void>;
  // sources & chunks
  writeSources(chatbotId: string, items: SourceWithChunks[]): Promise<void>;
  getSource(chatbotId: string, sourceId: string): Promise<KnowledgeSource | null>;
  listSources(chatbotId: string, opts: ListOpts): Promise<Page<KnowledgeSource>>;
  listAllSources(chatbotId: string): Promise<KnowledgeSource[]>;
  updateSource(chatbotId: string, sourceId: string, patch: Partial<KnowledgeSource>): Promise<void>;
  replaceSourceChunks(chatbotId: string, sourceId: string, chunks: KnowledgeChunk[], patch: Partial<KnowledgeSource>): Promise<void>;
  deleteSources(chatbotId: string, sourceIds: string[]): Promise<void>;
  getSourceChunks(chatbotId: string, sourceId: string): Promise<KnowledgeChunk[]>;
  listChunks(chatbotId: string): Promise<KnowledgeChunk[]>;
  // crawl jobs
  createCrawlJob(job: CrawlJob): Promise<void>;
  getCrawlJob(chatbotId: string, jobId: string): Promise<CrawlJob | null>;
  listCrawlJobs(chatbotId: string, opts: ListOpts): Promise<Page<CrawlJob>>;
  updateCrawlJob(chatbotId: string, jobId: string, patch: Partial<CrawlJob>): Promise<void>;
  listCrawlJobsByStatus(statuses: CrawlJob['status'][], limit: number): Promise<CrawlJob[]>;
  listRecentCrawlJobs(ownerId: string, limit: number): Promise<CrawlJob[]>;
  // conversations
  getConversation(id: string): Promise<ConversationRecord | null>;
  getConversationForOwner(ownerId: string, id: string): Promise<ConversationRecord | null>;
  listConversations(ownerId: string, q: ConversationQuery): Promise<Page<ConversationRecord>>;
  /** Creates the conversation when `create` is given, appends messages and patches it atomically. */
  appendMessages(
    conversationId: string,
    messages: MessageRecord[],
    patch: Record<string, unknown>,
    create?: ConversationRecord,
  ): Promise<void>;
  listMessages(conversationId: string, opts?: { last?: number }): Promise<MessageRecord[]>;
  deleteConversationCascade(id: string): Promise<void>;
  conversationCreatedDates(ownerId: string, fromIso: string, max: number): Promise<string[]>;
  countConversations(ownerId: string, fromIso?: string): Promise<number>;
  listConversationsBefore(ownerId: string, beforeIso: string, limit: number): Promise<ConversationRecord[]>;
  // leads
  createLead(lead: Lead, linkConversationId?: string): Promise<void>;
  getLeadForOwner(ownerId: string, id: string): Promise<Lead | null>;
  listLeads(ownerId: string, q: LeadQuery): Promise<Page<Lead>>;
  deleteLead(id: string): Promise<void>;
  countLeads(ownerId: string, fromIso?: string): Promise<number>;
  // usage
  getUsage(ownerId: string, period: string): Promise<UsageCounters | null>;
  incrementUsage(ownerId: string, period: string, deltas: Partial<Record<UsageMetric, number>>): Promise<void>;
  // tenant
  deleteOwnerData(ownerId: string): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

const MAX_SCAN = 2000;

export function createStore(db: DocDB): Store {
  const chatbotPath = (id: string) => `chatbots/${id}`;
  const sub = (id: string, name: string) => `chatbots/${id}/${name}`;

  async function page<T extends { id?: string }>(
    collection: string,
    where: Where[],
    orderField: string,
    dir: 'asc' | 'desc',
    opts: ListOpts,
    extra: Partial<QuerySpec> = {},
  ): Promise<Page<T>> {
    const cur = decodeCursor(opts.cursor);
    const rows = await db.query<T>(collection, {
      where: [...where, ...(extra.where ?? [])],
      orderBy: { field: orderField, dir },
      limit: opts.limit + 1,
      startAfter: cur ? { value: cur.v, id: cur.id } : undefined,
    });
    const items = rows.slice(0, opts.limit).map((r) => ({ ...r.data, id: r.id }) as T);
    let nextCursor: string | null = null;
    if (rows.length > opts.limit) {
      const last = rows[opts.limit - 1];
      const v = (last.data as Record<string, unknown>)[orderField] as string | number;
      nextCursor = encodeCursor(v, last.id);
    }
    return { items, nextCursor };
  }

  /** Deletes every doc matching a query, in batches. `beforeDelete` can add cascade ops. */
  async function deleteWhere(collection: string, where: Where[], perDoc?: (id: string) => Promise<void>): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await db.query<Record<string, unknown>>(collection, { where, limit: 300, select: [] });
      if (!rows.length) return total;
      if (perDoc) for (const r of rows) await perDoc(r.id);
      await db.batch(rows.map((r) => ({ type: 'delete' as const, path: r.path })));
      total += rows.length;
      if (rows.length < 300) return total;
    }
  }

  async function deleteCollection(collection: string): Promise<void> {
    await deleteWhere(collection, []);
  }

  async function deleteConversationCascade(id: string): Promise<void> {
    await deleteCollection(`conversations/${id}/messages`);
    await db.delete(`conversations/${id}`);
  }

  const store: Store = {
    kind: db.kind,

    // ---------- users
    getUser: (uid) => db.get<UserProfile>(`users/${uid}`),
    createUser: (user) => db.set(`users/${user.uid}`, { ...user }),
    updateUser: (uid, patch) => db.update(`users/${uid}`, { ...patch }),
    async listUsers(limit, afterUid) {
      const rows = await db.query<UserProfile>('users', { limit, startAfter: afterUid ? { value: afterUid, id: afterUid } : undefined });
      return rows.map((r) => ({ ...r.data, uid: r.id }));
    },
    touchUser: (uid, at, newSession) =>
      db.update(`users/${uid}`, newSession ? { lastActiveAt: at, lastSignInAt: at, signInCount: increment(1) } : { lastActiveAt: at }),

    // ---------- activity log
    addActivity: (event) => db.set(`activityEvents/${event.id}`, { ...event }),
    updateActivity: (id, patch) => db.update(`activityEvents/${id}`, patch),
    async listActivity(q) {
      const where: Where[] = [];
      if (q.type) where.push(['type', '==', q.type]);
      if (q.uid) where.push(['uid', '==', q.uid]);
      return page<ActivityEvent>('activityEvents', where, 'createdAt', 'desc', q);
    },
    async activitySince(fromIso, max) {
      const rows = await db.query<Pick<ActivityEvent, 'type' | 'createdAt'>>('activityEvents', {
        where: [['createdAt', '>=', fromIso]],
        orderBy: { field: 'createdAt', dir: 'desc' },
        limit: max,
        select: ['type', 'createdAt'],
      });
      return rows.map((r) => r.data);
    },
    deleteActivityBefore: (beforeIso) => deleteWhere('activityEvents', [['createdAt', '<', beforeIso]]),

    // ---------- admin (cross-tenant)
    async listUsersNewest(opts) {
      const res = await page<UserProfile & { id?: string }>('users', [], 'createdAt', 'desc', opts);
      return { items: res.items.map(({ id, ...u }) => ({ ...u, uid: id! })), nextCursor: res.nextCursor };
    },
    countUsers: (activeSinceIso) => db.count('users', activeSinceIso ? [['lastActiveAt', '>=', activeSinceIso]] : []),
    async userCreatedDates(fromIso, max) {
      const rows = await db.query<{ createdAt: string }>('users', {
        where: [['createdAt', '>=', fromIso]],
        orderBy: { field: 'createdAt', dir: 'desc' },
        limit: max,
        select: ['createdAt'],
      });
      return rows.map((r) => r.data.createdAt);
    },
    listTenantChatbots: (opts) => page<ChatbotRecord>('chatbots', [['isDemo', '==', false]], 'createdAt', 'desc', opts),
    countTenantChatbots(status) {
      const where: Where[] = [['isDemo', '==', false]];
      if (status) where.push(['status', '==', status]);
      return db.count('chatbots', where);
    },
    listAllConversations(q) {
      const where: Where[] = q.chatbotId ? [['chatbotId', '==', q.chatbotId]] : [];
      return page<ConversationRecord>('conversations', where, 'lastMessageAt', 'desc', q);
    },
    listAllLeads: (opts) => page<Lead>('leads', [], 'createdAt', 'desc', opts),
    countAll: (collection) => db.count(collection),

    // ---------- plans
    async listPlanDocs() {
      const rows = await db.query<Partial<Plan>>('plans', { limit: 20 });
      return rows.map((r) => ({ ...r.data, id: (r.data.id ?? r.id) as Plan['id'] }));
    },

    // ---------- chatbots
    createChatbot: (bot) => db.set(chatbotPath(bot.id), { ...bot }),
    async getChatbot(id) {
      if (!id || id.includes('/')) return null;
      const b = await db.get<ChatbotRecord>(chatbotPath(id));
      return b ? { ...b, id } : null;
    },
    async getChatbotForOwner(ownerId, id) {
      const b = await store.getChatbot(id);
      return b && b.ownerId === ownerId ? b : null;
    },
    async findChatbotByPublicId(publicId) {
      const rows = await db.query<ChatbotRecord>('chatbots', { where: [['publicId', '==', publicId]], limit: 1 });
      return rows[0] ? { ...rows[0].data, id: rows[0].id } : null;
    },
    listChatbots: (ownerId, opts) => page<ChatbotRecord>('chatbots', [['ownerId', '==', ownerId]], 'createdAt', 'desc', opts),
    async listAllChatbots(ownerId, max = 500) {
      const rows = await db.query<ChatbotRecord>('chatbots', {
        where: [['ownerId', '==', ownerId]],
        orderBy: { field: 'createdAt', dir: 'desc' },
        limit: max,
      });
      return rows.map((r) => ({ ...r.data, id: r.id }));
    },
    countChatbots: (ownerId) => db.count('chatbots', [['ownerId', '==', ownerId]]),
    updateChatbot: (id, patch) => db.update(chatbotPath(id), patch),
    async deleteChatbotCascade(id) {
      const bot = await store.getChatbot(id);
      for (const name of ['chunks', 'sources', 'crawlJobs', 'versions']) await deleteCollection(sub(id, name));
      await deleteWhere('conversations', [['chatbotId', '==', id]], (cid) => deleteCollection(`conversations/${cid}/messages`));
      await deleteWhere('leads', [['chatbotId', '==', id]]);
      const ops: BatchOp[] = [{ type: 'delete', path: chatbotPath(id) }];
      if (bot?.publicId) ops.push({ type: 'delete', path: `publicConfigs/${bot.publicId}` });
      await db.batch(ops);
    },
    async listExpiredDemoBots(nowIso, limit) {
      const rows = await db.query<ChatbotRecord>('chatbots', {
        where: [
          ['isDemo', '==', true],
          ['expiresAt', '<', nowIso],
        ],
        orderBy: { field: 'expiresAt', dir: 'asc' },
        limit,
      });
      return rows.map((r) => ({ ...r.data, id: r.id }));
    },

    // ---------- publishing
    async publishVersion(version, pointer, chatbotPatch) {
      // One atomic batch: immutable version doc + public pointer + chatbot state.
      await db.batch([
        { type: 'set', path: `${sub(version.chatbotId, 'versions')}/${version.version}`, data: { ...version } },
        { type: 'set', path: `publicConfigs/${pointer.publicId}`, data: { ...pointer } },
        { type: 'update', path: chatbotPath(version.chatbotId), data: chatbotPatch },
      ]);
    },
    getPublicConfig: (publicId) => (publicId && !publicId.includes('/') ? db.get<PublicConfigDoc>(`publicConfigs/${publicId}`) : Promise.resolve(null)),
    updatePublicConfig: (publicId, patch) => db.update(`publicConfigs/${publicId}`, { ...patch }),

    // ---------- sources & chunks
    async writeSources(chatbotId, items) {
      const ops: BatchOp[] = [];
      for (const { source, chunks } of items) {
        ops.push({ type: 'set', path: `${sub(chatbotId, 'sources')}/${source.id}`, data: { ...source } });
        for (const c of chunks) ops.push({ type: 'set', path: `${sub(chatbotId, 'chunks')}/${c.id}`, data: { ...c } });
      }
      await db.batch(ops);
    },
    async getSource(chatbotId, sourceId) {
      if (!sourceId || sourceId.includes('/')) return null;
      const s = await db.get<KnowledgeSource>(`${sub(chatbotId, 'sources')}/${sourceId}`);
      return s ? { ...s, id: sourceId } : null;
    },
    listSources: (chatbotId, opts) => page<KnowledgeSource>(sub(chatbotId, 'sources'), [], 'createdAt', 'asc', opts),
    async listAllSources(chatbotId) {
      const rows = await db.query<KnowledgeSource>(sub(chatbotId, 'sources'), { orderBy: { field: 'createdAt', dir: 'asc' }, limit: MAX_SCAN });
      return rows.map((r) => ({ ...r.data, id: r.id }));
    },
    updateSource: (chatbotId, sourceId, patch) => db.update(`${sub(chatbotId, 'sources')}/${sourceId}`, { ...patch }),
    async replaceSourceChunks(chatbotId, sourceId, chunks, patch) {
      await deleteWhere(sub(chatbotId, 'chunks'), [['sourceId', '==', sourceId]]);
      const ops: BatchOp[] = chunks.map((c) => ({ type: 'set', path: `${sub(chatbotId, 'chunks')}/${c.id}`, data: { ...c } }));
      ops.push({ type: 'update', path: `${sub(chatbotId, 'sources')}/${sourceId}`, data: { ...patch } });
      await db.batch(ops);
    },
    async deleteSources(chatbotId, sourceIds) {
      for (const id of sourceIds) await deleteWhere(sub(chatbotId, 'chunks'), [['sourceId', '==', id]]);
      await db.batch(sourceIds.map((id) => ({ type: 'delete' as const, path: `${sub(chatbotId, 'sources')}/${id}` })));
    },
    async getSourceChunks(chatbotId, sourceId) {
      const rows = await db.query<KnowledgeChunk>(sub(chatbotId, 'chunks'), {
        where: [['sourceId', '==', sourceId]],
        orderBy: { field: 'position', dir: 'asc' },
        limit: 5000,
      });
      return rows.map((r) => ({ ...r.data, id: r.id }));
    },
    async listChunks(chatbotId) {
      const out: KnowledgeChunk[] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await db.query<KnowledgeChunk>(sub(chatbotId, 'chunks'), { limit: 1000, startAfter: after ? { value: after, id: after } : undefined });
        out.push(...rows.map((r) => ({ ...r.data, id: r.id })));
        if (rows.length < 1000 || out.length >= 10_000) return out;
        after = rows[rows.length - 1].id;
      }
    },

    // ---------- crawl jobs
    createCrawlJob: (job) => db.set(`${sub(job.chatbotId, 'crawlJobs')}/${job.id}`, { ...job }),
    async getCrawlJob(chatbotId, jobId) {
      if (!jobId || jobId.includes('/')) return null;
      const j = await db.get<CrawlJob>(`${sub(chatbotId, 'crawlJobs')}/${jobId}`);
      return j ? { ...j, id: jobId } : null;
    },
    listCrawlJobs: (chatbotId, opts) => page<CrawlJob>(sub(chatbotId, 'crawlJobs'), [], 'createdAt', 'desc', opts),
    updateCrawlJob: (chatbotId, jobId, patch) => db.update(`${sub(chatbotId, 'crawlJobs')}/${jobId}`, { ...patch }),
    async listCrawlJobsByStatus(statuses, limit) {
      const rows = await db.queryGroup<CrawlJob>('crawlJobs', { where: [['status', 'in', statuses]], limit });
      return rows.map((r) => ({ ...r.data, id: r.id }));
    },
    async listRecentCrawlJobs(ownerId, limit) {
      const rows = await db.queryGroup<CrawlJob>('crawlJobs', {
        where: [['ownerId', '==', ownerId]],
        orderBy: { field: 'createdAt', dir: 'desc' },
        limit,
      });
      return rows.map((r) => ({ ...r.data, id: r.id }));
    },

    // ---------- conversations
    async getConversation(id) {
      if (!id || id.includes('/')) return null;
      const c = await db.get<ConversationRecord>(`conversations/${id}`);
      return c ? { ...c, id } : null;
    },
    async getConversationForOwner(ownerId, id) {
      const c = await store.getConversation(id);
      return c && c.ownerId === ownerId ? c : null;
    },
    listConversations(ownerId, q) {
      const where: Where[] = [['ownerId', '==', ownerId]];
      if (q.chatbotId) where.push(['chatbotId', '==', q.chatbotId]);
      if (q.from) where.push(['lastMessageAt', '>=', q.from]);
      if (q.to) where.push(['lastMessageAt', '<=', q.to]);
      return page<ConversationRecord>('conversations', where, 'lastMessageAt', 'desc', q);
    },
    async appendMessages(conversationId, messages, patch, create) {
      const ops: BatchOp[] = [];
      if (create) ops.push({ type: 'set', path: `conversations/${conversationId}`, data: { ...create } });
      for (const m of messages) ops.push({ type: 'set', path: `conversations/${conversationId}/messages/${m.id}`, data: { ...m } });
      ops.push({ type: 'update', path: `conversations/${conversationId}`, data: patch });
      await db.batch(ops);
    },
    async listMessages(conversationId, opts = {}) {
      if (opts.last) {
        const rows = await db.query<MessageRecord>(`conversations/${conversationId}/messages`, {
          orderBy: { field: 'createdAt', dir: 'desc' },
          limit: opts.last,
        });
        return rows.map((r) => ({ ...r.data, id: r.id })).reverse();
      }
      const rows = await db.query<MessageRecord>(`conversations/${conversationId}/messages`, {
        orderBy: { field: 'createdAt', dir: 'asc' },
        limit: 1000,
      });
      return rows.map((r) => ({ ...r.data, id: r.id }));
    },
    deleteConversationCascade,
    async conversationCreatedDates(ownerId, fromIso, max) {
      const rows = await db.query<{ createdAt: string }>('conversations', {
        where: [
          ['ownerId', '==', ownerId],
          ['createdAt', '>=', fromIso],
        ],
        orderBy: { field: 'createdAt', dir: 'desc' },
        limit: max,
        select: ['createdAt'],
      });
      return rows.map((r) => r.data.createdAt);
    },
    countConversations(ownerId, fromIso) {
      const where: Where[] = [['ownerId', '==', ownerId]];
      if (fromIso) where.push(['createdAt', '>=', fromIso]);
      return db.count('conversations', where);
    },
    async listConversationsBefore(ownerId, beforeIso, limit) {
      const rows = await db.query<ConversationRecord>('conversations', {
        where: [
          ['ownerId', '==', ownerId],
          ['lastMessageAt', '<', beforeIso],
        ],
        orderBy: { field: 'lastMessageAt', dir: 'asc' },
        limit,
      });
      return rows.map((r) => ({ ...r.data, id: r.id }));
    },

    // ---------- leads
    async createLead(lead, linkConversationId) {
      const ops: BatchOp[] = [{ type: 'set', path: `leads/${lead.id}`, data: { ...lead } }];
      if (linkConversationId) ops.push({ type: 'update', path: `conversations/${linkConversationId}`, data: { hasLead: true } });
      ops.push({ type: 'update', path: chatbotPath(lead.chatbotId), data: { 'stats.leads': increment(1) } });
      await db.batch(ops);
    },
    async getLeadForOwner(ownerId, id) {
      if (!id || id.includes('/')) return null;
      const l = await db.get<Lead>(`leads/${id}`);
      return l && l.ownerId === ownerId ? { ...l, id } : null;
    },
    listLeads(ownerId, q) {
      const where: Where[] = [['ownerId', '==', ownerId]];
      if (q.chatbotId) where.push(['chatbotId', '==', q.chatbotId]);
      return page<Lead>('leads', where, 'createdAt', 'desc', q);
    },
    deleteLead: (id) => db.delete(`leads/${id}`),
    countLeads(ownerId, fromIso) {
      const where: Where[] = [['ownerId', '==', ownerId]];
      if (fromIso) where.push(['createdAt', '>=', fromIso]);
      return db.count('leads', where);
    },

    // ---------- usage
    getUsage: (ownerId, period) => db.get<UsageCounters>(`usage/${ownerId}_${period}`),
    async incrementUsage(ownerId, period, deltas) {
      const data: Record<string, unknown> = { ownerId, period };
      for (const [k, v] of Object.entries(deltas)) if (v) data[k] = increment(v);
      await db.upsert(`usage/${ownerId}_${period}`, data);
    },

    // ---------- tenant deletion
    async deleteOwnerData(ownerId) {
      for (;;) {
        const bots = await store.listAllChatbots(ownerId, 50);
        if (!bots.length) break;
        for (const b of bots) await store.deleteChatbotCascade(b.id);
      }
      await deleteWhere('conversations', [['ownerId', '==', ownerId]], (cid) => deleteCollection(`conversations/${cid}/messages`));
      await deleteWhere('leads', [['ownerId', '==', ownerId]]);
      await deleteWhere('usage', [['ownerId', '==', ownerId]]);
      await db.delete(`users/${ownerId}`);
    },

    flush: () => db.flush(),
    close: () => db.close(),
  };
  return store;
}
