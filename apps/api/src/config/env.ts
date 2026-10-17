import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEFAULT_PLANS, type Plan } from '@chatpilot/shared';

/**
 * Environment configuration. Validated once at startup; the process refuses to
 * start with a clear message when something is missing or unsafe.
 */

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      if (typeof v === 'boolean') return v;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

const num = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().min(min).max(max).default(def);

const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const urlList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );

const DEV_DEFAULT_SECRETS = new Set([
  '',
  'dev-secret',
  'change-me',
  'changeme',
  'dev-jwt-secret-change-me',
  'dev-conversation-secret-change-me',
  'dev-admin-token-change-me',
  'dev-only-secret-change-me',
  'dev-conversation-secret',
  'dev-admin-token',
  'change-me-hmac-secret-at-least-32-characters',
  'change-me-admin-token-at-least-32-characters',
  'change-me-dev-only-at-least-32-characters-long',
]);

/** True for empty, known dev defaults and placeholder-looking values. */
export function isPlaceholderSecret(s: string | undefined): boolean {
  if (!s) return true;
  return DEV_DEFAULT_SECRETS.has(s) || /change-?me|replace|example|placeholder/i.test(s);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(8787, 1, 65535),
  FRONTEND_URLS: urlList,
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:8787'),
  PUBLIC_WIDGET_URL: optStr,
  AUTH_MODE: z.enum(['firebase', 'dev']).default('firebase'),
  DEV_JWT_SECRET: optStr,
  DATA_STORE: z.enum(['firestore', 'file']).default('firestore'),
  FILE_STORE_DIR: z.string().default('.data'),
  FIREBASE_PROJECT_ID: optStr,
  FIREBASE_CLIENT_EMAIL: optStr,
  FIREBASE_PRIVATE_KEY: optStr,
  GOOGLE_APPLICATION_CREDENTIALS: optStr,
  AI_PROVIDER: z.enum(['openai', 'ollama', 'mock']).default('openai'),
  AI_MODEL: optStr,
  AI_BASE_URL: optStr,
  AI_API_KEY: optStr,
  AI_TIMEOUT_MS: int(30000, 1000, 300000),
  AI_MAX_RETRIES: int(2, 0, 6),
  AI_MAX_CONCURRENCY: int(4, 1, 100),
  MAX_OUTPUT_TOKENS: int(500, 16, 8000),
  AI_TEMPERATURE: num(0.2, 0, 2),
  /** Optional `reasoning_effort` for reasoning models (e.g. Groq openai/gpt-oss-*). */
  AI_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  MAX_CRAWL_PAGES: int(50, 1, 500),
  MAX_CRAWL_DEPTH: int(3, 0, 10),
  CRAWL_CONCURRENCY: int(3, 1, 10),
  CRAWL_PAGE_TIMEOUT_MS: int(20000, 1000, 120000),
  CRAWL_MAX_PAGE_BYTES: int(2_000_000, 10_000, 20_000_000),
  MAX_MESSAGE_LENGTH: int(2000, 1, 2000),
  RATE_LIMIT_WINDOW_MS: int(60000, 1000),
  RATE_LIMIT_MAX_REQUESTS: int(120, 1),
  /** Per authenticated user per window on private routes. */
  PRIVATE_RATE_LIMIT_PER_USER: int(600, 1),
  PUBLIC_CHAT_RATE_LIMIT: int(20, 1),
  LEADS_RATE_LIMIT: int(5, 1),
  CRAWL_START_RATE_LIMIT: int(10, 1),
  DEMO_ENABLED: bool(true),
  DEMO_MAX_PAGES: int(8, 1, 50),
  DEMO_MAX_MESSAGES: int(15, 1, 1000),
  DEMO_PER_IP_PER_HOUR: int(5, 1),
  DEMO_GLOBAL_PER_HOUR: int(100, 1),
  DEMO_GLOBAL_MESSAGES_PER_DAY: int(1000, 1),
  CONVERSATION_SECRET: optStr,
  ADMIN_TOKEN: optStr,
  PLANS_JSON: optStr,
  WIDGET_DIST_DIR: optStr,
  SCREENSHOT_URL_TEMPLATE: optStr,
  PRODUCT_NAME: z.string().default('ChatPilot AI'),
  TRUST_PROXY: z.string().default('1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CLEANUP_INTERVAL_MS: int(3_600_000, 0),
});

type RawEnv = z.infer<typeof envSchema>;

export interface Env extends Omit<RawEnv, 'PUBLIC_WIDGET_URL' | 'WIDGET_DIST_DIR' | 'DEV_JWT_SECRET' | 'CONVERSATION_SECRET'> {
  PUBLIC_WIDGET_URL: string;
  WIDGET_DIST_DIR: string;
  DEV_JWT_SECRET: string;
  CONVERSATION_SECRET: string;
  /** True when any development shortcut (dev auth, file store, mock AI) is active. */
  devMode: boolean;
  plansOverride?: Plan[];
  trustProxy: boolean | number | string;
}

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}

function defaultWidgetDistDir(): string {
  // src/config/env.ts -> apps/api ; dist/index.js -> apps/api
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '../../../widget/dist'),
      path.resolve(here, '../../widget/dist'),
      path.resolve(process.cwd(), '../widget/dist'),
      path.resolve(process.cwd(), 'apps/widget/dist'),
    ];
    return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
  } catch {
    return path.resolve(process.cwd(), '../widget/dist');
  }
}

function parseTrustProxy(v: string): boolean | number | string {
  if (v === 'true') return true;
  if (v === 'false' || v === '0' || v === '') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // e.g. "loopback, 10.0.0.0/8"
}

const planOverrideSchema = z.array(
  z
    .object({
      id: z.enum(['free', 'starter', 'pro', 'business']),
    })
    .passthrough(),
);

function parsePlans(json: string | undefined, problems: string[]): Plan[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = planOverrideSchema.parse(JSON.parse(json));
    // Deep-merge onto defaults so partial overrides (e.g. only a price) are valid.
    return DEFAULT_PLANS.map((def) => {
      const o = parsed.find((p) => p.id === def.id) as Partial<Plan> | undefined;
      if (!o) return def;
      return {
        ...def,
        ...o,
        limits: { ...def.limits, ...(o.limits ?? {}) },
        features: { ...def.features, ...(o.features ?? {}) },
      } as Plan;
    });
  } catch (e) {
    problems.push(`PLANS_JSON is not valid JSON plan overrides: ${(e as Error).message}`);
    return undefined;
  }
}

/**
 * Parses and validates the environment. Throws EnvError (never exits) so tests
 * can assert on the production guard.
 */
export function loadEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = result.data;
  const problems: string[] = [];
  const isProd = e.NODE_ENV === 'production';

  if (isProd) {
    if (e.AUTH_MODE === 'dev') problems.push('AUTH_MODE=dev is not allowed in production (use firebase).');
    if (e.DATA_STORE === 'file') problems.push('DATA_STORE=file is not allowed in production (use firestore).');
    if (e.AI_PROVIDER === 'mock') problems.push('AI_PROVIDER=mock is not allowed in production.');
    if (isPlaceholderSecret(e.CONVERSATION_SECRET) || e.CONVERSATION_SECRET!.length < 32)
      problems.push('CONVERSATION_SECRET must be set to a random value of at least 32 characters (not a placeholder).');
    // ADMIN_TOKEN may be empty (admin routes disabled) but must never be a placeholder/short value.
    if (e.ADMIN_TOKEN && (isPlaceholderSecret(e.ADMIN_TOKEN) || e.ADMIN_TOKEN.length < 24))
      problems.push('ADMIN_TOKEN must be a random value of at least 24 characters (or empty to disable admin routes).');
    if (e.DEV_JWT_SECRET && isPlaceholderSecret(e.DEV_JWT_SECRET))
      problems.push('DEV_JWT_SECRET must not be set to a placeholder in production (dev auth is disabled there anyway).');
    if (e.FRONTEND_URLS.length === 0) problems.push('FRONTEND_URLS must list the dashboard origin(s).');
    if (e.FRONTEND_URLS.some((u) => u.startsWith('http://localhost')))
      problems.push('FRONTEND_URLS must not contain localhost in production.');
  }

  if (e.AUTH_MODE === 'firebase' || e.DATA_STORE === 'firestore') {
    const hasInline = e.FIREBASE_PROJECT_ID && e.FIREBASE_CLIENT_EMAIL && e.FIREBASE_PRIVATE_KEY;
    const hasAdc = !!e.GOOGLE_APPLICATION_CREDENTIALS || !!raw.K_SERVICE || !!raw.FUNCTION_TARGET;
    if (!hasInline && !hasAdc && !e.FIREBASE_PROJECT_ID) {
      problems.push(
        'Firebase credentials missing: set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS.',
      );
    }
  }

  if (e.AI_PROVIDER === 'openai') {
    if (!e.AI_API_KEY) problems.push('AI_API_KEY is required for AI_PROVIDER=openai.');
    if (!e.AI_MODEL) problems.push('AI_MODEL is required for AI_PROVIDER=openai (e.g. gpt-4o-mini, openai/gpt-oss-20b).');
  }
  if (e.AI_PROVIDER === 'ollama' && !e.AI_MODEL) problems.push('AI_MODEL is required for AI_PROVIDER=ollama (e.g. llama3.1).');

  let devJwtSecret = e.DEV_JWT_SECRET ?? '';
  if (e.AUTH_MODE === 'dev') {
    if (!devJwtSecret) devJwtSecret = 'dev-jwt-secret-change-me';
    if (devJwtSecret.length < 16) problems.push('DEV_JWT_SECRET must be at least 16 characters.');
  }

  const conversationSecret = e.CONVERSATION_SECRET ?? (isProd ? '' : 'dev-conversation-secret-change-me');
  const plansOverride = parsePlans(e.PLANS_JSON, problems);

  if (problems.length) throw new EnvError(problems);

  const apiBase = e.PUBLIC_API_URL.replace(/\/$/, '');
  return {
    ...e,
    PUBLIC_APP_URL: e.PUBLIC_APP_URL.replace(/\/$/, ''),
    PUBLIC_API_URL: apiBase,
    PUBLIC_WIDGET_URL: e.PUBLIC_WIDGET_URL ?? `${apiBase}/widget.js`,
    WIDGET_DIST_DIR: e.WIDGET_DIST_DIR ? path.resolve(e.WIDGET_DIST_DIR) : defaultWidgetDistDir(),
    DEV_JWT_SECRET: devJwtSecret,
    CONVERSATION_SECRET: conversationSecret,
    FIREBASE_PRIVATE_KEY: e.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    devMode: e.AUTH_MODE === 'dev' || e.DATA_STORE === 'file' || e.AI_PROVIDER === 'mock',
    plansOverride,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
  };
}

/** Loads .env files for local development (never overrides real environment variables). */
export async function loadDotenv(): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;
  const dotenv = await import('dotenv');
  // Look in the current directory and in apps/api itself (when started from the repo root).
  const dirs = [process.cwd()];
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 4; i++) {
      const pkg = path.join(dir, 'package.json');
      if (fs.existsSync(pkg) && fs.readFileSync(pkg, 'utf8').includes('"@chatpilot/api"')) {
        if (!dirs.includes(dir)) dirs.push(dir);
        break;
      }
      dir = path.dirname(dir);
    }
  } catch {
    /* ignore */
  }
  for (const d of dirs) {
    for (const file of ['.env.development.local', '.env.local', '.env.development', '.env']) {
      const p = path.join(d, file);
      // dotenv never overrides variables that are already set.
      if (fs.existsSync(p)) dotenv.config({ path: p });
    }
  }
}
