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
 * ADMIN routes (signed-in platform admins only: verified email listed in ADMIN_EMAILS; others get 403)
 *   GET    /api/admin/overview                      -> AdminOverview
 *   GET    /api/admin/users?q=&limit=&cursor=       -> Paginated<AdminUser>
 *   GET    /api/admin/users/:uid                    -> AdminUserDetail
 *   PATCH  /api/admin/users/:uid  AdminUpdateUserInput -> AdminUser   (change plan, suspend/restore)
 *   DELETE /api/admin/users/:uid                    -> { ok: true }   (deletes all their data)
 *   GET    /api/admin/chatbots?q=&limit=&cursor=    -> Paginated<AdminChatbot>
 *   DELETE /api/admin/chatbots/:id                  -> { ok: true }
 *   GET    /api/admin/conversations?chatbotId=&limit=&cursor= -> Paginated<AdminConversation>
 *   GET    /api/admin/conversations/:id             -> { conversation: AdminConversation, messages: ChatMessage[] }
 *   GET    /api/admin/leads?limit=&cursor=          -> Paginated<AdminLead>
 *   GET    /api/admin/activity?type=&uid=&limit=&cursor= -> Paginated<ActivityEvent>
 *   POST   /api/admin/cleanup   (X-Admin-Token header instead of a user session; for schedulers)
 *
 * DEV-ONLY (AUTH_MODE=dev and NODE_ENV!=production; the API refuses to start otherwise)
 *   POST   /api/dev/login   { email }               -> { token, uid, email }
 */

import type {
  ActivityEvent,
  Chatbot,
  ChatMessage,
  Conversation,
  CrawlJob,
  Lead,
  Plan,
  PlanId,
  PublicChatbotConfig,
  SiteMeta,
  SourceRef,
  Usage,
  UserProfile,
} from './types';

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  /** Firebase email/password account whose email address isn't verified yet. */
  | 'email_not_verified'
  | 'google_sign_in_required'
  /** A platform admin suspended this account. */
  | 'account_suspended'
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
  /** True for platform admins (ADMIN_EMAILS); unlocks /app/admin. */
  isAdmin?: boolean;
}

/* ---------------- admin console (platform admins only) ---------------- */

export interface AdminDailyPoint {
  date: string;
  signUps: number;
  signIns: number;
  demos: number;
}

export interface AdminOverview {
  totals: {
    users: number;
    newUsers7d: number;
    activeUsers7d: number;
    chatbots: number;
    publishedChatbots: number;
    conversations: number;
    leads: number;
    demos7d: number;
  };
  /** Last 14 days, oldest first. */
  daily: AdminDailyPoint[];
  recentActivity: ActivityEvent[];
}

export interface AdminUser extends UserProfile {
  isAdmin: boolean;
  chatbotCount: number;
  messagesThisMonth: number;
}

export interface AdminUserDetail {
  user: AdminUser;
  plan: Plan;
  usage: Usage;
  chatbots: Chatbot[];
  activity: ActivityEvent[];
}

export interface AdminChatbot extends Chatbot {
  ownerEmail?: string;
}

export interface AdminConversation extends Conversation {
  chatbotName?: string;
  ownerEmail?: string;
}

export interface AdminLead extends Lead {
  chatbotName?: string;
  ownerEmail?: string;
}

export interface AdminUpdateUserInput {
  planId?: PlanId;
  suspended?: boolean;
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
