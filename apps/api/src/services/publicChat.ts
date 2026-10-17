import {
  chatbotConfigSchema,
  type ChatbotConfig,
  type ChatMessageInput,
  type LeadInput,
  type Plan,
  type PublicChatbotConfig,
  type PublicChatReply,
} from '@chatpilot/shared';
import type { Env } from '../config/env';
import { increment } from '../data/docdb';
import { DEMO_OWNER, type ChatbotRecord, type ConversationRecord, type MessageRecord, type Store } from '../data/store';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
import { safeEqual, signConversationToken, verifyConversationToken } from '../lib/hmac';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import type { ChatService } from './chat';
import type { PlanService } from './plans';
import type { UsageService } from './usage';

export interface ResolvedBot {
  mode: 'published' | 'draft';
  publicId: string;
  chatbotId: string;
  ownerId: string;
  config: ChatbotConfig;
  businessName: string;
  version: number;
  allowedOrigins: string[];
  isDemo: boolean;
}

export interface RequestMeta {
  origin?: string;
  ip: string;
}

/**
 * The widget-facing view of a config. Owner custom instructions are prompt
 * material and stay server-side (also in preview-token/draft mode).
 */
export function publicSafeConfig(config: ChatbotConfig): ChatbotConfig {
  return { ...config, customInstructions: '' };
}

const notPublished = () => new AppError(404, 'not_published', 'This chatbot is not available.');
const PUBLIC_QUOTA_MESSAGE = 'This assistant is temporarily unavailable. Please contact the business directly.';

/**
 * Public (widget / hosted page / demo) chat flow. The widget can only ever read
 * the publicConfigs pointer (PublicChatbotConfig) — never owner data or knowledge.
 */
export class PublicChatService {
  private appOrigins: Set<string>;
  private installSeen = new Map<string, number>();
  /** Global (per-instance) daily cap on demo AI answers. */
  private demoDay = { day: '', count: 0 };

  constructor(
    private readonly env: Env,
    private readonly store: Store,
    private readonly plans: PlanService,
    private readonly usage: UsageService,
    private readonly chat: ChatService,
    private readonly logger: Logger,
  ) {
    this.appOrigins = new Set([...env.FRONTEND_URLS, env.PUBLIC_APP_URL].map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return u;
      }
    }));
  }

  isAppOrigin(origin: string | undefined): boolean {
    return !!origin && this.appOrigins.has(origin);
  }

  async resolve(publicId: string, previewToken?: string): Promise<ResolvedBot> {
    if (!/^cb_[A-Za-z0-9_-]{8,40}$/.test(publicId)) throw notPublished();
    if (previewToken) {
      const bot = await this.store.findChatbotByPublicId(publicId);
      if (!bot || bot.isDemo || !safeEqual(bot.previewToken, previewToken)) throw notPublished();
      return {
        mode: 'draft',
        publicId,
        chatbotId: bot.id,
        ownerId: bot.ownerId,
        config: chatbotConfigSchema.parse(bot.config),
        businessName: bot.businessName,
        version: bot.publishedVersion ?? 0,
        allowedOrigins: bot.allowedOrigins ?? [],
        isDemo: false,
      };
    }
    const p = await this.store.getPublicConfig(publicId);
    if (!p || p.status !== 'published') throw notPublished();
    if (p.expiresAt && Date.parse(p.expiresAt) < Date.now()) throw notPublished();
    return {
      mode: 'published',
      publicId,
      chatbotId: p.chatbotId,
      ownerId: p.ownerId,
      config: p.config,
      businessName: p.businessName,
      version: p.version,
      allowedOrigins: p.allowedOrigins ?? [],
      isDemo: !!p.isDemo,
    };
  }

  /**
   * Soft control: browsers send Origin, so this stops casual copy-paste embedding
   * on other sites. It is NOT authentication (non-browser clients can forge it).
   */
  checkOrigin(bot: ResolvedBot, origin: string | undefined): void {
    if (!bot.allowedOrigins.length || !origin) return;
    if (this.isAppOrigin(origin)) return;
    if (!bot.allowedOrigins.includes(origin)) {
      throw new AppError(403, 'origin_not_allowed', 'This chatbot is not enabled for this website.');
    }
  }

  private async planFor(ownerId: string): Promise<Plan> {
    const user = await this.store.getUser(ownerId);
    return this.plans.get(user?.planId);
  }

  async publicConfig(publicId: string, previewToken: string | undefined, meta: RequestMeta): Promise<PublicChatbotConfig> {
    const bot = await this.resolve(publicId, previewToken);
    this.checkOrigin(bot, meta.origin);
    if (bot.mode === 'published' && !bot.isDemo) void this.recordInstall(bot, meta.origin);
    return { publicId: bot.publicId, businessName: bot.businessName, version: bot.version, mode: bot.mode, config: publicSafeConfig(bot.config) };
  }

  /** Records where the widget is installed; throttled to one write per bot per 5 minutes. */
  private async recordInstall(bot: ResolvedBot, origin: string | undefined): Promise<void> {
    if (!origin || origin === 'null' || this.isAppOrigin(origin)) return;
    const last = this.installSeen.get(bot.chatbotId) ?? 0;
    if (Date.now() - last < 5 * 60_000) return;
    this.installSeen.set(bot.chatbotId, Date.now());
    if (this.installSeen.size > 10_000) this.installSeen.clear();
    try {
      await this.store.updateChatbot(bot.chatbotId, { install: { lastSeenOrigin: origin.slice(0, 300), lastSeenAt: new Date().toISOString() } });
    } catch (e) {
      this.logger.warn({ chatbotId: bot.chatbotId, err: (e as Error).message }, 'install record failed');
    }
  }

  private showLeadForm(config: ChatbotConfig, plan: Plan | null, conv: { hasLead: boolean; userMessageCount: number }): boolean {
    const lc = config.leadCapture;
    if (!lc?.enabled || conv.hasLead) return false;
    if (plan && !plan.features.leadCapture) return false;
    if (lc.trigger === 'start') return conv.userMessageCount === 1;
    if (lc.trigger === 'after_messages') return conv.userMessageCount >= lc.afterMessages;
    return false;
  }

  async message(publicId: string, input: ChatMessageInput & { channel: 'widget' | 'hosted' | 'demo' }, meta: RequestMeta): Promise<PublicChatReply> {
    const resolved = await this.resolve(publicId, input.previewToken);
    this.checkOrigin(resolved, meta.origin);
    if (input.channel === 'demo' && !resolved.isDemo) throw badRequest('The demo channel is only available for demo chatbots.', { fieldErrors: { channel: ['Invalid channel'] } });
    const channel = resolved.isDemo ? 'demo' : input.channel;
    const message = input.message.trim();
    if (message.length > this.env.MAX_MESSAGE_LENGTH) {
      throw badRequest(`Messages can be at most ${this.env.MAX_MESSAGE_LENGTH} characters.`, { fieldErrors: { message: ['Too long'] } });
    }
    const bot: ChatbotRecord | null = await this.store.getChatbot(resolved.chatbotId);
    if (!bot) throw notPublished();

    let plan: Plan | null = null;
    if (resolved.isDemo) {
      if ((bot.demoMessages ?? 0) >= this.env.DEMO_MAX_MESSAGES) {
        throw new AppError(429, 'quota_exceeded', 'This live demo has reached its message limit. Sign up to create your own chatbot!');
      }
      const today = new Date().toISOString().slice(0, 10);
      if (this.demoDay.day !== today) this.demoDay = { day: today, count: 0 };
      if (this.demoDay.count >= this.env.DEMO_GLOBAL_MESSAGES_PER_DAY) {
        throw new AppError(429, 'quota_exceeded', 'The live demo is very busy today. Please sign up to try ChatPilot with your own website.');
      }
      this.demoDay.count++;
    } else {
      plan = await this.planFor(bot.ownerId);
      if (await this.usage.isExceeded(bot.ownerId, plan, 'messages')) {
        this.logger.warn({ chatbotId: bot.id }, 'public chat blocked: owner message quota exceeded');
        throw new AppError(429, 'quota_exceeded', PUBLIC_QUOTA_MESSAGE);
      }
    }

    let conv: ConversationRecord | null = null;
    if (input.conversationId) {
      if (!verifyConversationToken(this.env.CONVERSATION_SECRET, input.conversationId, publicId, input.visitorId, input.conversationToken)) {
        throw forbidden('Invalid or missing conversation token.');
      }
      conv = await this.store.getConversation(input.conversationId);
      if (!conv || conv.chatbotId !== bot.id) throw notFound('Conversation');
    }

    const history = conv ? (await this.store.listMessages(conv.id, { last: 6 })).map((m) => ({ role: m.role, content: m.content })) : [];
    const result = await this.chat.answer({
      chatbotId: bot.id,
      knowledgeVersion: bot.knowledgeVersion ?? 0,
      config: resolved.config,
      businessName: resolved.businessName,
      message,
      history,
      channel,
    });

    const conversationId = conv?.id ?? newId();
    const ownerId = resolved.isDemo ? DEMO_OWNER : bot.ownerId;
    const t1 = new Date();
    const t2 = new Date(t1.getTime() + 1);
    const userMsg: MessageRecord = { id: newId(), conversationId, chatbotId: bot.id, ownerId, role: 'user', content: message, createdAt: t1.toISOString() };
    const botMsg: MessageRecord = {
      id: newId(),
      conversationId,
      chatbotId: bot.id,
      ownerId,
      role: 'assistant',
      content: result.content,
      sources: result.sources.length ? result.sources : undefined,
      fallback: result.fallback || undefined,
      suggestions: result.suggestions.length ? result.suggestions : undefined,
      createdAt: t2.toISOString(),
    };
    const create: ConversationRecord | undefined = conv
      ? undefined
      : {
          id: conversationId,
          chatbotId: bot.id,
          ownerId,
          publicId,
          visitorId: input.visitorId,
          channel,
          messageCount: 0,
          userMessageCount: 0,
          lastMessagePreview: '',
          hasLead: false,
          pageUrl: input.pageUrl?.slice(0, 2048),
          createdAt: t1.toISOString(),
          lastMessageAt: t1.toISOString(),
          ...(resolved.isDemo && bot.expiresAt ? { expiresAt: bot.expiresAt } : {}),
        };
    await this.store.appendMessages(
      conversationId,
      [userMsg, botMsg],
      {
        messageCount: increment(2),
        userMessageCount: increment(1),
        lastMessagePreview: message.replace(/\s+/g, ' ').slice(0, 140),
        lastMessageAt: t2.toISOString(),
      },
      create,
    );

    const botPatch: Record<string, unknown> = {};
    if (!conv) botPatch['stats.conversations'] = increment(1);
    if (resolved.isDemo) botPatch.demoMessages = increment(1);
    if (Object.keys(botPatch).length) await this.store.updateChatbot(bot.id, botPatch).catch(() => undefined);
    if (!resolved.isDemo) {
      await this.usage.record(bot.ownerId, {
        messages: 1,
        aiTokens: result.tokens,
        failedRequests: result.aiFailed ? 1 : 0,
      });
    }

    const userMessageCount = (conv?.userMessageCount ?? 0) + 1;
    return {
      conversationId,
      conversationToken: signConversationToken(this.env.CONVERSATION_SECRET, conversationId, publicId, input.visitorId),
      message: { id: botMsg.id, conversationId, role: 'assistant', content: botMsg.content, sources: botMsg.sources, fallback: botMsg.fallback, suggestions: botMsg.suggestions, createdAt: botMsg.createdAt },
      showLeadForm: resolved.isDemo ? false : this.showLeadForm(resolved.config, plan, { hasLead: conv?.hasLead ?? false, userMessageCount }),
    };
  }

  async lead(publicId: string, input: LeadInput, meta: RequestMeta): Promise<{ ok: true; leadId: string }> {
    const resolved = await this.resolve(publicId);
    this.checkOrigin(resolved, meta.origin);
    if (resolved.isDemo) throw forbidden('Lead capture is not available in the live demo.');
    const plan = await this.planFor(resolved.ownerId);
    if (!plan.features.leadCapture || !resolved.config.leadCapture?.enabled) throw forbidden('Lead capture is not enabled for this chatbot.');
    const email = input.email?.trim() || undefined;
    const phone = input.phone?.trim() || undefined;
    if (!email && !phone) {
      throw badRequest('Please provide an email address or a phone number.', { fieldErrors: { email: ['Email or phone is required'], phone: ['Email or phone is required'] } });
    }
    if (await this.usage.isExceeded(resolved.ownerId, plan, 'leads')) {
      throw new AppError(429, 'quota_exceeded', 'We could not save your details right now. Please contact the business directly.');
    }
    let linkId: string | undefined;
    if (input.conversationId && verifyConversationToken(this.env.CONVERSATION_SECRET, input.conversationId, publicId, input.visitorId, input.conversationToken)) {
      const conv = await this.store.getConversation(input.conversationId);
      if (conv && conv.chatbotId === resolved.chatbotId) linkId = conv.id;
    }
    const lead = {
      id: newId(),
      chatbotId: resolved.chatbotId,
      ownerId: resolved.ownerId,
      conversationId: linkId,
      name: input.name?.trim() || undefined,
      email,
      phone,
      message: input.message?.trim() || undefined,
      consent: true,
      pageUrl: input.pageUrl?.slice(0, 2048),
      createdAt: new Date().toISOString(),
    };
    await this.store.createLead(lead, linkId);
    await this.usage.record(resolved.ownerId, { leads: 1 });
    this.logger.info({ chatbotId: resolved.chatbotId, leadId: lead.id, linked: !!linkId }, 'lead captured');
    return { ok: true, leadId: lead.id };
  }
}
