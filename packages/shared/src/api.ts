/**
 * HTTP API contract between apps/api, apps/web and apps/widget.
 *
 * Conventions
 * - Base path: `${API_URL}/api`. JSON in/out. Health: GET `${API_URL}/health`.
 * - Private routes require `Authorization: Bearer <Firebase ID token>`
 *   (or a dev token from POST /api/dev/login when the API runs with AUTH_MODE=dev — never in production).
 * - Errors are ALWAYS `{ error: ApiErrorBody }` with a matching HTTP status.
 * - Lists are `{ items: T[], nextCursor: string | null }` (cursor pagination, `?limit=&cursor=`).
 *
 * PUBLIC routes (no auth; rate-limited per IP + per chatbot; CORS open but Origin-checked against allowedOrigins)
 *   GET    /api/public/chatbots/:publicId/config[?previewToken=]       -> PublicChatbotConfig
 *   POST   /api/public/chatbots/:publicId/messages   ChatMessageInput   -> PublicChatReply
 *   POST   /api/public/chatbots/:publicId/leads      LeadInput          -> { ok: true, leadId }
 *   POST   /api/public/demo                          DemoInput          -> DemoSession   (landing-page live demo)
 *   GET    /api/public/demo/:demoId                                     -> DemoSession   (poll while crawling)
 *   GET    /api/public/frame-check?url=                                 -> FrameCheckResult
 *
 * PRIVATE routes
 *   GET    /api/me                                  -> MeResponse
 *   PATCH  /api/me            UpdateProfileInput    -> MeResponse
 *   DELETE /api/me                                  -> { ok: true }    (deletes all tenant data)
 *   GET    /api/plans                               -> { items: Plan[] }   (also public: GET /api/public/plans)
 *   GET    /api/dashboard/stats?days=30             -> DashboardStats
 *
 *   GET    /api/chatbots                            -> Paginated<Chatbot>
 *   POST   /api/chatbots          CreateChatbotInput -> Chatbot   (status 'draft', default config)
 *   GET    /api/chatbots/:id                        -> Chatbot
 *   PATCH  /api/chatbots/:id      UpdateChatbotInput -> Chatbot
 *   DELETE /api/chatbots/:id                        -> { ok: true }   (cascades sources, chunks, convos, leads)
 *   PUT    /api/chatbots/:id/config  ChatbotConfigInput -> Chatbot   (draft only)
 *   POST   /api/chatbots/:id/publish                -> PublishResult
 *   POST   /api/chatbots/:id/unpublish              -> Chatbot
 *   GET    /api/chatbots/:id/install-status         -> InstallStatus
 *   POST   /api/chatbots/:id/preview/messages  PreviewMessageInput -> PreviewChatReply  (not stored; counts usage)
 *
 *   POST   /api/chatbots/:id/crawl   StartCrawlInput -> CrawlJob   (async; poll the job)
 *   GET    /api/chatbots/:id/crawl-jobs             -> Paginated<CrawlJob>
 *   GET    /api/chatbots/:id/crawl-jobs/:jobId      -> CrawlJob
 *   POST   /api/chatbots/:id/crawl-jobs/:jobId/cancel -> CrawlJob
 *
 *   GET    /api/chatbots/:id/sources                -> Paginated<KnowledgeSource>
 *   POST   /api/chatbots/:id/sources  CreateSourceInput -> KnowledgeSource
 *   GET    /api/chatbots/:id/sources/:sourceId      -> KnowledgeSourceDetail
 *   PATCH  /api/chatbots/:id/sources/:sourceId  UpdateSourceInput -> KnowledgeSource
 *   DELETE /api/chatbots/:id/sources/:sourceId      -> { ok: true }
 *
 *   GET    /api/conversations?chatbotId=&from=&to=&q=&limit=&cursor= -> Paginated<Conversation>
 *   GET    /api/conversations/:id                   -> { conversation: Conversation, messages: ChatMessage[] }
 *   DELETE /api/conversations/:id                   -> { ok: true }
 *   GET    /api/leads?chatbotId=&q=&limit=&cursor=  -> Paginated<Lead>
 *   GET    /api/leads/export.csv?chatbotId=         -> text/csv   (plan feature csvExport)
 *   DELETE /api/leads/:id                           -> { ok: true }
 *
 * DEV-ONLY (AUTH_MODE=dev and NODE_ENV!=production; the API refuses to start otherwise)
 *   POST   /api/dev/login   { email }               -> { token, uid, email }
 */

import type {
  Chatbot,
  ChatMessage,
  Conversation,
  CrawlJob,
  Plan,
  PublicChatbotConfig,
  SiteMeta,
  SourceRef,
  Usage,
  UserProfile,
} from './types';

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'crawl_blocked'
  | 'invalid_url'
  | 'ai_unavailable'
  | 'not_published'
  | 'origin_not_allowed'
  | 'conflict'
  | 'payload_too_large'
  | 'internal';

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** validation_error: { fieldErrors }; quota_exceeded: QuotaErrorDetails */
  details?: unknown;
}

export interface QuotaErrorDetails {
  metric: string;
  limit: number;
  used: number;
  resetAt: string;
  planId: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MeResponse {
  user: UserProfile;
  plan: Plan;
  usage: Usage;
}

export interface PublicChatReply {
  conversationId: string;
  conversationToken: string;
  message: ChatMessage;
  /** True if the lead form should be shown now (based on leadCapture.trigger). */
  showLeadForm?: boolean;
}

export interface PreviewChatReply {
  message: { role: 'assistant'; content: string; sources?: SourceRef[]; fallback?: boolean; suggestions?: string[] };
  /** Retrieved chunks for transparency in the studio. */
  retrieved?: { title?: string; url?: string; score: number; excerpt: string }[];
}

export interface PublishResult {
  chatbot: Chatbot;
  version: number;
  publicId: string;
  embedCode: string;
  hostedUrl: string;
  widgetUrl: string;
}

export interface InstallStatus {
  published: boolean;
  lastSeenOrigin?: string;
  lastSeenAt?: string;
  allowedOrigins: string[];
}

export interface FrameCheckResult {
  url: string;
  frameable: boolean;
  reason?: string;
}

export type DemoStatus = 'crawling' | 'ready' | 'failed';

export interface DemoSession {
  demoId: string;
  /** Public id usable with the widget (data-chatbot-id) while the demo lives. */
  publicId: string;
  url: string;
  status: DemoStatus;
  siteMeta?: SiteMeta;
  pagesProcessed: number;
  error?: string;
  expiresAt: string;
}

export interface Conversations {
  conversation: Conversation;
  messages: ChatMessage[];
}

export type { PublicChatbotConfig, CrawlJob };
