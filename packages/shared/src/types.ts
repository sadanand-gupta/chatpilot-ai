import type { z } from 'zod';
import type { chatbotConfigSchema, leadCaptureSchema, contactSchema } from './schemas';

/**
 * Domain types. Timestamps are ISO-8601 strings in API payloads.
 * Firestore stores them as Timestamps; the API converts at the data-access boundary.
 */

export type ChatbotConfig = z.infer<typeof chatbotConfigSchema>;
export type LeadCaptureConfig = z.infer<typeof leadCaptureSchema>;
export type ContactConfig = z.infer<typeof contactSchema>;

export type ISODate = string;
export type ChatbotStatus = 'draft' | 'published' | 'unpublished';

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  businessName?: string;
  planId: PlanId;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Extracted visual/brand metadata of a website — powers Preview Studio's mockup fallback. */
export interface SiteMeta {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  ogImage?: string;
  favicon?: string;
  logo?: string;
  themeColor?: string;
  /** Top-level navigation labels (max 8). */
  navLinks?: string[];
  /** First h1/h2 on the home page. */
  heroHeading?: string;
  heroText?: string;
  /** Up to 6 absolute https image URLs from the home page. */
  images?: string[];
  /** Whether the site allows being shown in an iframe (X-Frame-Options / CSP frame-ancestors). */
  frameable?: boolean;
  frameBlockReason?: string;
}

export interface Chatbot {
  id: string;
  ownerId: string;
  /** Stable public identifier used in the embed snippet. Not a secret, not an auth credential. */
  publicId: string;
  name: string;
  businessName: string;
  websiteUrl: string;
  category?: string;
  language: string;
  status: ChatbotStatus;
  /** Draft configuration edited in the dashboard. */
  config: ChatbotConfig;
  /** Latest published version number (published config lives in publishedVersions). */
  publishedVersion?: number;
  publishedAt?: ISODate;
  /** True when the draft differs from the published version. */
  hasUnpublishedChanges?: boolean;
  allowedOrigins: string[];
  siteMeta?: SiteMeta;
  /** Token that lets the owner load the DRAFT config in the widget on their own site (preview mode). */
  previewToken?: string;
  /** Increments whenever knowledge changes — used to invalidate retrieval caches. */
  knowledgeVersion: number;
  stats?: { sources: number; chunks: number; conversations: number; leads: number };
  install?: { lastSeenOrigin?: string; lastSeenAt?: ISODate };
  /** Demo bots are created by the public landing-page demo and expire. */
  isDemo?: boolean;
  expiresAt?: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface PublishedVersion {
  chatbotId: string;
  publicId: string;
  version: number;
  config: ChatbotConfig;
  businessName: string;
  publishedAt: ISODate;
}

export type SourceType = 'page' | 'faq' | 'manual';
export type SourceStatus = 'active' | 'excluded' | 'failed';

export interface KnowledgeSource {
  id: string;
  chatbotId: string;
  ownerId: string;
  type: SourceType;
  url?: string;
  title: string;
  status: SourceStatus;
  charCount: number;
  chunkCount: number;
  /** First ~300 chars for list views. Full text: GET .../sources/:id */
  preview: string;
  crawlJobId?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface KnowledgeSourceDetail extends KnowledgeSource {
  content: string;
}

export interface KnowledgeChunk {
  id: string;
  chatbotId: string;
  ownerId: string;
  sourceId: string;
  url?: string;
  title?: string;
  heading?: string;
  text: string;
  position: number;
}

export type CrawlStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type CrawlPageStatus = 'processed' | 'skipped' | 'failed';

export interface CrawlPageResult {
  url: string;
  status: CrawlPageStatus;
  title?: string;
  reason?: string;
  chars?: number;
}

export interface CrawlJob {
  id: string;
  chatbotId: string;
  ownerId: string;
  startUrl: string;
  status: CrawlStatus;
  stats: { discovered: number; processed: number; skipped: number; failed: number };
  /** Last 200 page results. */
  pages: CrawlPageResult[];
  maxPages: number;
  error?: string;
  /** Human-readable hint when nothing could be extracted (e.g. JS-only site). */
  hint?: string;
  createdAt: ISODate;
  startedAt?: ISODate;
  finishedAt?: ISODate;
}

export type ConversationChannel = 'widget' | 'hosted' | 'demo';

export interface Conversation {
  id: string;
  chatbotId: string;
  ownerId: string;
  visitorId: string;
  channel: ConversationChannel;
  messageCount: number;
  lastMessagePreview: string;
  hasLead: boolean;
  pageUrl?: string;
  createdAt: ISODate;
  lastMessageAt: ISODate;
}

export interface SourceRef {
  url?: string;
  title?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
  /** True when the reply is the configured fallback (no grounded answer / AI failure). */
  fallback?: boolean;
  createdAt: ISODate;
}

export interface Lead {
  id: string;
  chatbotId: string;
  ownerId: string;
  conversationId?: string;
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  consent: boolean;
  pageUrl?: string;
  createdAt: ISODate;
}

export type PlanId = 'free' | 'starter' | 'pro' | 'business';

export interface PlanLimits {
  chatbots: number;
  messagesPerMonth: number;
  crawlsPerMonth: number;
  pagesPerCrawl: number;
  leadsPerMonth: number;
  /** Total characters of knowledge per chatbot. */
  knowledgeCharsPerBot: number;
  /** Days conversations are retained. */
  retentionDays: number;
}

export interface PlanFeatures {
  leadCapture: boolean;
  removeBranding: boolean;
  csvExport: boolean;
  allowedOrigins: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** Display price; billing is not wired yet. null = "Contact us". */
  priceMonthly: number | null;
  currency: string;
  limits: PlanLimits;
  features: PlanFeatures;
  highlighted?: boolean;
}

export type UsageMetric = 'messages' | 'crawls' | 'pagesCrawled' | 'leads' | 'aiTokens' | 'failedRequests';

export interface Usage {
  ownerId: string;
  /** YYYY-MM (UTC). Quotas reset at the start of each month. */
  period: string;
  messages: number;
  crawls: number;
  pagesCrawled: number;
  leads: number;
  aiTokens: number;
  failedRequests: number;
  resetAt: ISODate;
}

/** Public, safe view of a published chatbot — the only thing the widget can read. */
export interface PublicChatbotConfig {
  publicId: string;
  businessName: string;
  version: number;
  /** 'draft' when loaded with a valid preview token. */
  mode: 'published' | 'draft';
  config: ChatbotConfig;
}

export interface DashboardStats {
  chatbots: { total: number; published: number; draft: number };
  conversations: { count: number; days: number; series: { date: string; count: number }[] };
  leads: { count: number; days: number };
  usage: Usage;
  plan: Plan;
  recentActivity: ActivityItem[];
}

export interface ActivityItem {
  type: 'conversation' | 'lead' | 'crawl' | 'publish' | 'chatbot_created';
  chatbotId: string;
  chatbotName: string;
  message: string;
  at: ISODate;
}
