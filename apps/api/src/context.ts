import type { Env } from './config/env';
import { AIClient, createAIClient } from './ai';
import { FrameChecker } from './crawler/frameCheck';
import type { Store } from './data/store';
import type { Logger } from './lib/logger';
import { BM25Retriever, type Retriever } from './knowledge/retriever';
import type { TokenVerifier } from './middleware/auth';
import { ActivityService } from './services/activity';
import { AdminService } from './services/admin';
import { ChatService } from './services/chat';
import { ChatbotService } from './services/chatbots';
import { CleanupService } from './services/cleanup';
import { CrawlService, type CrawlerOverrides } from './services/crawls';
import { DemoService } from './services/demo';
import { JobQueue } from './services/jobQueue';
import { KnowledgeService } from './services/knowledge';
import { PlanService } from './services/plans';
import { PublicChatService } from './services/publicChat';
import { RecordsService } from './services/records';
import { StatsService } from './services/stats';
import { UsageService } from './services/usage';
import { UserService } from './services/users';

export interface AppDeps {
  env: Env;
  store: Store;
  logger: Logger;
  verifier: TokenVerifier;
  ai?: AIClient;
  /** Firebase Auth deletion for DELETE /api/me (firebase mode). */
  deleteAuthUser?: (uid: string) => Promise<void>;
  /** TEST ONLY network overrides. Refused in production. */
  crawlerOverrides?: CrawlerOverrides;
}

export interface AppContext {
  env: Env;
  store: Store;
  logger: Logger;
  verifier: TokenVerifier;
  ai: AIClient;
  retriever: Retriever;
  queue: JobQueue;
  plans: PlanService;
  usage: UsageService;
  users: UserService;
  activity: ActivityService;
  admin: AdminService;
  knowledge: KnowledgeService;
  crawls: CrawlService;
  chat: ChatService;
  chatbots: ChatbotService;
  publicChat: PublicChatService;
  records: RecordsService;
  demo: DemoService;
  stats: StatsService;
  cleanup: CleanupService;
  frameChecker: FrameChecker;
}

export function buildContext(deps: AppDeps): AppContext {
  const { env, store, logger } = deps;
  if (env.NODE_ENV === 'production' && deps.crawlerOverrides && Object.keys(deps.crawlerOverrides).length) {
    throw new Error('crawlerOverrides (test-only network escape hatches) are not allowed in production');
  }
  const overrides = deps.crawlerOverrides ?? {};
  const ai = deps.ai ?? createAIClient(env);
  const retriever = new BM25Retriever(store, 50);
  const queue = new JobQueue(2);
  const plans = new PlanService(store, env.plansOverride, logger);
  const usage = new UsageService(store);
  const users = new UserService(store, plans, usage, logger, deps.deleteAuthUser);
  const activity = new ActivityService(store, logger);
  const knowledge = new KnowledgeService(store, retriever, logger);
  const userAgent = `ChatPilotBot/1.0 (+${env.PUBLIC_APP_URL}/bot)`;
  const frameChecker = new FrameChecker(
    { userAgent, timeoutMs: 8000, allowPrivateForTests: overrides.allowPrivateForTests, lookup: overrides.lookup },
    env.PUBLIC_APP_URL,
  );
  const demoQueue = new JobQueue(1);
  const crawls = new CrawlService(env, store, queue, demoQueue, knowledge, usage, frameChecker, logger, overrides);
  const chat = new ChatService(env, retriever, ai, logger);
  const chatbots = new ChatbotService(env, store, plans, usage, crawls, chat, retriever, logger);
  const publicChat = new PublicChatService(env, store, plans, usage, chat, logger, activity);
  const records = new RecordsService(store, plans);
  const demo = new DemoService(env, store, crawls, chatbots, logger, activity);
  const stats = new StatsService(store, plans, usage);
  const cleanup = new CleanupService(store, plans, retriever, logger, env.ACTIVITY_RETENTION_DAYS);
  const admin = new AdminService(store, plans, usage, users, activity, retriever, env.ADMIN_EMAILS, logger);
  return {
    env,
    store,
    logger,
    verifier: deps.verifier,
    ai,
    retriever,
    queue,
    plans,
    usage,
    users,
    activity,
    admin,
    knowledge,
    crawls,
    chat,
    chatbots,
    publicChat,
    records,
    demo,
    stats,
    cleanup,
    frameChecker,
  };
}
