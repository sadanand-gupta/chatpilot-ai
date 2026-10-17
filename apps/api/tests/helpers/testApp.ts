import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/app';
import { AIClient, MockProvider } from '../../src/ai';
import { loadEnv } from '../../src/config/env';
import { createFileStore } from '../../src/data/fileStore';
import { createLogger } from '../../src/lib/logger';
import { devVerifier } from '../../src/middleware/auth';
import type { CrawlerOverrides } from '../../src/services/crawls';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  AUTH_MODE: 'dev',
  DATA_STORE: 'file',
  AI_PROVIDER: 'mock',
  DEV_JWT_SECRET: 'test-dev-jwt-secret-0123456789',
  CONVERSATION_SECRET: 'test-conversation-secret-0123456789',
  ADMIN_TOKEN: 'test-admin-token-0123456789',
  FRONTEND_URLS: 'http://localhost:5173',
  PUBLIC_APP_URL: 'http://localhost:5173',
  PUBLIC_API_URL: 'http://localhost:8787',
  LOG_LEVEL: 'silent',
  RATE_LIMIT_MAX_REQUESTS: '100000',
  PUBLIC_CHAT_RATE_LIMIT: '10000',
  LEADS_RATE_LIMIT: '10000',
  DEMO_PER_IP_PER_HOUR: '10000',
  CRAWL_START_RATE_LIMIT: '10000',
  CLEANUP_INTERVAL_MS: '0',
  CRAWL_PAGE_TIMEOUT_MS: '4000',
};

/** Fake public DNS: every hostname resolves to a public address (no network in tests). */
export const publicLookupAll = async () => [{ address: '93.184.216.34', family: 4 }];

export function makeTestApp(opts: { env?: Record<string, string>; overrides?: CrawlerOverrides } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpilot-test-'));
  const env = loadEnv({ ...TEST_ENV, FILE_STORE_DIR: dir, WIDGET_DIST_DIR: path.join(dir, 'widget'), ...(opts.env ?? {}) });
  const store = createFileStore({ dir, persist: false });
  const provider = new MockProvider();
  const ai = new AIClient(provider, { timeoutMs: 2000, maxRetries: 1, maxConcurrency: 4, backoffBaseMs: 1 });
  const logger = createLogger('silent');
  const created = createApp({
    env,
    store,
    logger,
    verifier: devVerifier(env.DEV_JWT_SECRET),
    ai,
    crawlerOverrides: { lookupAll: publicLookupAll, useSitemap: false, ...(opts.overrides ?? {}) },
  });
  const agent = request(created.app);
  const login = async (email: string): Promise<string> => {
    const res = await agent.post('/api/dev/login').send({ email });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.token as string;
  };
  return {
    ...created,
    env,
    store,
    provider,
    agent,
    dir,
    login,
    auth: (token: string) => ({ Authorization: `Bearer ${token}` }),
    async close() {
      await created.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type TestApp = ReturnType<typeof makeTestApp>;
