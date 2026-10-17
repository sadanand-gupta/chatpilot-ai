import {
  buildEmbedCode,
  buildHostedUrl,
  chatbotConfigSchema,
  defaultChatbotConfig,
  type Chatbot,
  type ChatbotConfig,
  type ChatbotConfigInput,
  type CreateChatbotInput,
  type InstallStatus,
  type Plan,
  type PreviewChatReply,
  type PreviewMessageInput,
  type PublishedVersion,
  type PublishResult,
  type UpdateChatbotInput,
  type UserProfile,
} from '@chatpilot/shared';
import type { Env } from '../config/env';
import type { ChatbotRecord, ListOpts, Page, PublicConfigDoc, Store } from '../data/store';
import { AppError, aiUnavailable, badRequest, forbidden } from '../lib/errors';
import { nowIso } from '../lib/http';
import { newId, newPreviewToken, newPublicId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import type { Retriever } from '../knowledge/retriever';
import { requireOwnedBot, toChatbotDto } from './access';
import type { ChatService } from './chat';
import type { CrawlService } from './crawls';
import type { PlanService } from './plans';
import type { UsageService } from './usage';

export function normalizeOrigin(input: string): string {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw badRequest(`"${input}" is not a valid origin`, { fieldErrors: { allowedOrigins: [`Invalid origin: ${input}`] } });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw badRequest(`"${input}" is not a valid origin`, { fieldErrors: { allowedOrigins: [`Invalid origin: ${input}`] } });
  }
  return u.origin;
}

export function defaultConfigFor(businessName: string, language: ChatbotConfig['language'] = 'auto'): ChatbotConfig {
  return defaultChatbotConfig({
    botName: `${businessName} Assistant`.slice(0, 60),
    headerTitle: businessName.slice(0, 80),
    welcomeMessage: `Hi! 👋 Welcome to ${businessName}. How can I help you today?`.slice(0, 500),
    language,
  });
}

export class ChatbotService {
  constructor(
    private readonly env: Env,
    private readonly store: Store,
    private readonly plans: PlanService,
    private readonly usage: UsageService,
    private readonly crawls: CrawlService,
    private readonly chat: ChatService,
    private readonly retriever: Retriever,
    private readonly logger: Logger,
  ) {}

  async list(ownerId: string, opts: ListOpts): Promise<Page<Chatbot>> {
    const page = await this.store.listChatbots(ownerId, opts);
    return { items: page.items.filter((b) => !b.isDemo).map(toChatbotDto), nextCursor: page.nextCursor };
  }

  async get(ownerId: string, id: string): Promise<Chatbot> {
    return toChatbotDto(await requireOwnedBot(this.store, ownerId, id));
  }

  async create(user: UserProfile, input: CreateChatbotInput): Promise<Chatbot> {
    const plan = await this.plans.get(user.planId);
    const count = await this.store.countChatbots(user.uid);
    if (count >= plan.limits.chatbots) {
      const u = await this.usage.get(user.uid);
      throw new AppError(402, 'quota_exceeded', `Your ${plan.name} plan allows ${plan.limits.chatbots} chatbot(s). Upgrade to add more.`, {
        metric: 'chatbots',
        limit: plan.limits.chatbots,
        used: count,
        resetAt: u.resetAt,
        planId: plan.id,
      });
    }
    const url = await this.crawls.validateUrl(input.websiteUrl);
    const now = nowIso();
    const bot: ChatbotRecord = {
      id: newId(),
      ownerId: user.uid,
      publicId: newPublicId(),
      name: input.businessName,
      businessName: input.businessName,
      websiteUrl: url.href,
      category: input.category || undefined,
      language: input.language,
      status: 'draft',
      config: defaultConfigFor(input.businessName, input.language),
      hasUnpublishedChanges: false,
      allowedOrigins: [],
      previewToken: newPreviewToken(),
      knowledgeVersion: 0,
      stats: { sources: 0, chunks: 0, conversations: 0, leads: 0 },
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createChatbot(bot);
    this.logger.info({ chatbotId: bot.id, ownerId: user.uid }, 'chatbot created');
    return toChatbotDto(bot);
  }

  async update(user: UserProfile, id: string, input: UpdateChatbotInput): Promise<Chatbot> {
    const bot = await requireOwnedBot(this.store, user.uid, id);
    const patch: Record<string, unknown> = { updatedAt: nowIso() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.category !== undefined) patch.category = input.category;
    if (input.businessName !== undefined && input.businessName !== bot.businessName) {
      patch.businessName = input.businessName;
      if (bot.publishedVersion) patch.hasUnpublishedChanges = true;
    }
    if (input.websiteUrl !== undefined) patch.websiteUrl = (await this.crawls.validateUrl(input.websiteUrl)).href;
    if (input.allowedOrigins !== undefined) {
      const origins = [...new Set(input.allowedOrigins.filter((o) => o.trim()).map(normalizeOrigin))];
      if (origins.length) {
        const plan = await this.plans.get(user.planId);
        if (!plan.features.allowedOrigins) throw forbidden(`Restricting allowed websites is not included in the ${plan.name} plan.`, { feature: 'allowedOrigins' });
      }
      patch.allowedOrigins = origins;
    }
    await this.store.updateChatbot(bot.id, patch);
    if (patch.allowedOrigins) {
      const pointer = await this.store.getPublicConfig(bot.publicId);
      if (pointer) await this.store.updatePublicConfig(bot.publicId, { allowedOrigins: patch.allowedOrigins as string[], updatedAt: nowIso() });
    }
    return toChatbotDto({ ...bot, ...(patch as Partial<ChatbotRecord>) });
  }

  private async checkConfigAgainstPlan(plan: Plan, config: ChatbotConfig): Promise<void> {
    if (!config.showBranding && !plan.features.removeBranding) {
      throw forbidden(`Removing "Powered by ${this.env.PRODUCT_NAME}" branding is not included in the ${plan.name} plan.`, { feature: 'removeBranding' });
    }
    if (config.leadCapture.enabled && !plan.features.leadCapture) {
      throw forbidden(`Lead capture is not included in the ${plan.name} plan.`, { feature: 'leadCapture' });
    }
  }

  async updateConfig(user: UserProfile, id: string, input: ChatbotConfigInput): Promise<Chatbot> {
    const bot = await requireOwnedBot(this.store, user.uid, id);
    const config = chatbotConfigSchema.parse(input);
    await this.checkConfigAgainstPlan(await this.plans.get(user.planId), config);
    const patch: Record<string, unknown> = { config, updatedAt: nowIso() };
    if (bot.publishedVersion) patch.hasUnpublishedChanges = true;
    await this.store.updateChatbot(bot.id, patch);
    return toChatbotDto({ ...bot, ...(patch as Partial<ChatbotRecord>) });
  }

  /** Writes the immutable version + public pointer in one atomic batch. */
  async publishBot(bot: ChatbotRecord, plan: Plan | null): Promise<{ bot: ChatbotRecord; version: number }> {
    let config = chatbotConfigSchema.parse(bot.config);
    if (plan && !plan.features.removeBranding) config = { ...config, showBranding: true };
    const version = (bot.publishedVersion ?? 0) + 1;
    const now = nowIso();
    const published: PublishedVersion = { chatbotId: bot.id, publicId: bot.publicId, version, config, businessName: bot.businessName, publishedAt: now };
    const pointer: PublicConfigDoc = {
      publicId: bot.publicId,
      chatbotId: bot.id,
      ownerId: bot.ownerId,
      version,
      config,
      businessName: bot.businessName,
      status: 'published',
      allowedOrigins: bot.allowedOrigins ?? [],
      isDemo: !!bot.isDemo,
      expiresAt: bot.expiresAt,
      updatedAt: now,
    };
    const patch = { status: 'published', publishedVersion: version, publishedAt: now, hasUnpublishedChanges: false, updatedAt: now };
    await this.store.publishVersion(published, pointer, patch);
    return { bot: { ...bot, ...(patch as Partial<ChatbotRecord>) }, version };
  }

  async publish(user: UserProfile, id: string): Promise<PublishResult> {
    const bot = await requireOwnedBot(this.store, user.uid, id);
    const config = chatbotConfigSchema.parse(bot.config);
    const fieldErrors: Record<string, string[]> = {};
    if (!config.welcomeMessage.trim()) fieldErrors.welcomeMessage = ['A welcome message is required'];
    const sources = await this.store.listAllSources(bot.id);
    const hasKnowledge = sources.some((s) => s.status === 'active');
    if (!hasKnowledge && !config.customInstructions.trim()) {
      fieldErrors.knowledge = ['Add at least one active knowledge source (crawl your website, add an FAQ or text) or custom instructions before publishing.'];
    }
    if (Object.keys(fieldErrors).length) {
      throw badRequest(fieldErrors.knowledge?.[0] ?? 'The chatbot is not ready to publish.', { fieldErrors });
    }
    const plan = await this.plans.get(user.planId);
    await this.checkConfigAgainstPlan(plan, config);
    const { bot: updated, version } = await this.publishBot(bot, plan);
    this.logger.info({ chatbotId: bot.id, version }, 'chatbot published');
    return {
      chatbot: toChatbotDto(updated),
      version,
      publicId: bot.publicId,
      embedCode: buildEmbedCode({ widgetUrl: this.env.PUBLIC_WIDGET_URL, publicId: bot.publicId, apiUrl: this.env.PUBLIC_API_URL }),
      hostedUrl: buildHostedUrl(this.env.PUBLIC_APP_URL, bot.publicId),
      widgetUrl: this.env.PUBLIC_WIDGET_URL,
    };
  }

  async unpublish(user: UserProfile, id: string): Promise<Chatbot> {
    const bot = await requireOwnedBot(this.store, user.uid, id);
    const now = nowIso();
    const pointer = await this.store.getPublicConfig(bot.publicId);
    if (pointer) await this.store.updatePublicConfig(bot.publicId, { status: 'unpublished', updatedAt: now });
    const patch = { status: bot.publishedVersion ? 'unpublished' : 'draft', updatedAt: now };
    await this.store.updateChatbot(bot.id, patch);
    return toChatbotDto({ ...bot, ...(patch as Partial<ChatbotRecord>) });
  }

  /** Invalidates the old draft-preview token (e.g. after it was shared). */
  async rotatePreviewToken(user: UserProfile, id: string): Promise<Chatbot> {
    const bot = await requireOwnedBot(this.store, user.uid, id);
    const patch = { previewToken: newPreviewToken(), updatedAt: nowIso() };
    await this.store.updateChatbot(bot.id, patch);
    return toChatbotDto({ ...bot, ...patch });
  }

  async installStatus(user: UserProfile, id: string): Promise<InstallStatus> {
    const bot = await requireOwnedBot(this.store, user.uid, id);
    const pointer = await this.store.getPublicConfig(bot.publicId);
    return {
      published: pointer?.status === 'published',
      lastSeenOrigin: bot.install?.lastSeenOrigin,
      lastSeenAt: bot.install?.lastSeenAt,
      allowedOrigins: bot.allowedOrigins ?? [],
    };
  }

  async remove(user: UserProfile, id: string): Promise<void> {
    const bot = await requireOwnedBot(this.store, user.uid, id);
    await this.store.deleteChatbotCascade(bot.id);
    this.retriever.invalidate(bot.id);
    this.logger.info({ chatbotId: bot.id }, 'chatbot deleted');
  }

  /** Studio preview: draft config (+ unsaved overrides), not stored, counts usage. */
  async preview(user: UserProfile, id: string, input: PreviewMessageInput): Promise<PreviewChatReply> {
    const bot = await requireOwnedBot(this.store, user.uid, id);
    const plan = await this.plans.get(user.planId);
    await this.usage.check(user.uid, plan, 'messages');
    const config = chatbotConfigSchema.parse({ ...bot.config, ...(input.config ?? {}) });
    const message = input.message.trim().slice(0, this.env.MAX_MESSAGE_LENGTH);
    const result = await this.chat.answer({
      chatbotId: bot.id,
      knowledgeVersion: bot.knowledgeVersion ?? 0,
      config,
      businessName: bot.businessName,
      message,
      history: input.history ?? [],
      channel: 'preview',
    });
    if (result.aiFailed) {
      await this.usage.record(user.uid, { failedRequests: 1 });
      throw aiUnavailable();
    }
    await this.usage.record(user.uid, { messages: 1, aiTokens: result.tokens });
    return {
      message: { role: 'assistant', content: result.content, sources: result.sources, fallback: result.fallback, suggestions: result.suggestions },
      retrieved: result.retrieved.map((r) => ({
        title: r.chunk.title,
        url: r.chunk.url,
        score: Math.round(r.score * 1000) / 1000,
        excerpt: r.chunk.text.slice(0, 300),
      })),
    };
  }
}
