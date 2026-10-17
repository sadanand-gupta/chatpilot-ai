import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the definition-of-done journey, run against LOCAL dev
 * servers in fully offline-capable dev mode:
 *   AUTH_MODE=dev (local JWT login), DATA_STORE=file (JSON store), AI_PROVIDER=mock.
 *
 * First time:   npx playwright install chromium
 * Run:          npx playwright test            (starts the servers for you)
 * Debug:        npx playwright test --ui       |  --headed  |  --debug
 * Report:       npx playwright show-report
 *
 * Env:
 *   E2E_SITE_URL   public site to crawl in the main journey (default https://example.com;
 *                  needs internet access — the crawler fetches it for real).
 *   E2E_API_URL    default http://localhost:8787
 *   E2E_WEB_URL    default http://localhost:5173
 *   E2E_NO_SERVER=1  don't start servers (you already run `npm run dev:api` / `dev:web`).
 *
 * Data: the API writes to apps/api/.data-e2e (FILE_STORE_DIR is resolved by the API
 * relative to its own working directory). Delete that folder for a clean slate;
 * tests use unique emails per run so it is not required.
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8787';
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
const isCI = !!process.env.CI;

const apiEnv: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '8787',
  AUTH_MODE: 'dev',
  DEV_JWT_SECRET: 'e2e-dev-jwt-secret-not-for-production-000000',
  DATA_STORE: 'file',
  FILE_STORE_DIR: '.data-e2e',
  AI_PROVIDER: 'mock',
  CONVERSATION_SECRET: 'e2e-conversation-secret-not-for-production-0000',
  FRONTEND_URLS: WEB_URL,
  PUBLIC_APP_URL: WEB_URL,
  PUBLIC_API_URL: API_URL,
  PUBLIC_WIDGET_URL: `${API_URL}/widget.js`,
  DEMO_ENABLED: 'true',
  // Generous limits so a test run never trips the per-IP limiter.
  RATE_LIMIT_MAX_REQUESTS: '10000',
  PUBLIC_CHAT_RATE_LIMIT: '1000',
  MAX_CRAWL_PAGES: '10',
};

export default defineConfig({
  testDir: './tests/e2e',
  // The main journey crawls a real website, so allow time for it.
  timeout: 4 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The fake customer page and the local API are both on loopback; Chrome's Local/Private
        // Network Access checks would block widget.js in tests (not an issue on public hosts).
        launchOptions: {
          args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'],
        },
      },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          // The widget is a one-shot build (no port to wait on), so it is built
          // right before the API starts; the API serves it at /widget.js
          // from WIDGET_DIST_DIR (default apps/widget/dist).
          command: 'npm run build -w @chatpilot/widget && npm run dev -w @chatpilot/api',
          url: `${API_URL}/health`,
          env: apiEnv,
          reuseExistingServer: !isCI,
          timeout: 180_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'npm run dev -w @chatpilot/web -- --port 5173 --strictPort',
          url: WEB_URL,
          env: {
            VITE_AUTH_MODE: 'dev',
            VITE_API_URL: API_URL,
            VITE_WIDGET_URL: `${API_URL}/widget.js`,
            VITE_PUBLIC_APP_URL: WEB_URL,
          },
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
      ],
});
