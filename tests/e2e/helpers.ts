import { expect, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * UI CONTRACT FOR E2E (align at integration)
 * Selectors prefer accessible roles/labels/text; test ids are used only where
 * no stable accessible name exists. Playwright locators pierce OPEN shadow
 * roots, so the widget must use attachShadow({ mode: 'open' }).
 *
 * Dashboard (apps/web)
 *   /register                 label /email/i, label /^password/i, optional label /name/i,
 *                             button /create account|sign up|get started/i
 *   /login                    button /sign in|log in/i
 *   new chatbot (/chatbots/new or onboarding)
 *                             label /website url/i, label /business name/i,
 *                             button /create|build|generate|continue/i
 *   crawl progress            text /crawl (completed|complete|finished)/i   (data-testid="crawl-status" optional)
 *   knowledge                 tab or link /knowledge/i;  rows: data-testid="knowledge-source-row"
 *   configure/appearance      tab or link /appearance|customi[sz]e|design|configure/i
 *                             label /primary colou?r/i (text input accepting #RRGGBB),
 *                             label /welcome message/i,
 *                             switch or checkbox /lead capture|collect leads/i,
 *                             button /^save/i  → toast /saved/i
 *   preview studio            data-testid="preview-studio" containing the mounted widget;
 *                             buttons (or radios/tabs) /desktop/i and /mobile/i;
 *                             the device frame exposes data-device="desktop|mobile"
 *                             (data-testid="preview-device")
 *   publish                   button /^publish/i → text /published/i
 *   embed code                data-testid="embed-code" (a <pre>/<code>/<textarea> containing the snippet),
 *                             button /copy/i
 *   nav                       links /conversations|inbox/i and /leads/i
 *   inbox                     list items/rows contain lastMessagePreview text; clicking opens
 *                             the transcript (both user + assistant messages visible)
 *   leads                     table rows contain the lead email
 *
 * Widget (apps/widget, inside shadow root of host element [data-chatpilot-widget])
 *   launcher                  button /open chat|chat with us|chat/i  (aria-label)
 *   panel                     role="dialog" with aria-label = headerTitle (default "Chat with us")
 *   composer                  textbox /message|type your/i ; button /send/i (Enter also sends)
 *   messages                  data-testid="message-user" / "message-assistant" (role="log" container)
 *   welcome                   the welcomeMessage text
 *   close                     button /close|minimi[sz]e/i
 *   lead form                 role="form" name /details|contact|lead/i ; labels /name/i, /email/i;
 *                             checkbox (consent); button /submit|send details/i → text /thank/i
 *                             manual open: button /contact us|leave (your )?details/i
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8787';
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
export const SITE_URL = process.env.E2E_SITE_URL ?? 'https://example.com';
/**
 * A fake "customer website" origin served by page.route (no extra server needed).
 * It must be a loopback origin: Chrome's Private Network Access blocks a public-looking
 * origin from loading scripts from localhost (in production the widget is on a public host).
 * 127.0.0.1:4599 is still a different origin from the API and the dashboard.
 */
export const CUSTOMER_ORIGIN = process.env.E2E_CUSTOMER_ORIGIN ?? 'http://127.0.0.1:4599';

export const uniqueSuffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Builds a minimal customer page with the embed snippet. */
export function customerPageHtml(opts: { widgetUrl: string; publicId: string; apiUrl?: string }): string {
  const api = opts.apiUrl ?? API_URL;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Customer site</title></head>
<body style="font-family:sans-serif;margin:0;padding:24px">
  <h1>Acme customer website</h1>
  <p>This page embeds the ChatPilot widget exactly like a customer would.</p>
  <script src="${opts.widgetUrl}" data-chatbot-id="${opts.publicId}" data-api-url="${api}" async></script>
</body></html>`;
}

/**
 * Opens the customer page in a FRESH browser context (an anonymous visitor),
 * served from CUSTOMER_ORIGIN so the API sees a realistic Origin header.
 */
export async function openCustomerPage(
  browser: Browser,
  opts: { widgetUrl: string; publicId: string; viewport?: { width: number; height: number }; isMobile?: boolean },
): Promise<Page> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    isMobile: opts.isMobile,
    hasTouch: opts.isMobile,
  });
  const page = await context.newPage();
  const html = customerPageHtml(opts);
  await page.route(`${CUSTOMER_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(`${CUSTOMER_ORIGIN}/`);
  return page;
}

export function widgetLauncher(page: Page): Locator {
  return page.getByRole('button', { name: /open chat|chat with us|^chat$/i }).first();
}

export function widgetPanel(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).first();
}

/** Sends a message in a widget scope and waits for a NEW assistant reply. */
export async function sendWidgetMessage(scope: Locator, text: string): Promise<void> {
  const assistant = scope.getByTestId('message-assistant');
  const before = await assistant.count();
  const box = scope.getByRole('textbox', { name: /type your message/i }).first();
  await box.fill(text);
  await box.press('Enter');
  await expect(scope.getByTestId('message-user').filter({ hasText: text })).toBeVisible();
  await expect(assistant).toHaveCount(before + 1, { timeout: 45_000 });
  await expect(assistant.last()).not.toBeEmpty();
}

/** Dev-mode login straight against the API (for specs that don't test the UI flow). */
export async function devLogin(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API_URL}/api/dev/login`, { data: { email } });
  expect(res.ok(), `dev login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { token: string };
  return body.token;
}

/**
 * Creates and publishes a chatbot via the API using a manual knowledge source
 * (no crawl → fast and independent of internet access).
 */
export async function createPublishedBotViaApi(
  request: APIRequestContext,
): Promise<{ publicId: string; widgetUrl: string; token: string; chatbotId: string }> {
  const token = await devLogin(request, `widget-${uniqueSuffix()}@e2e.test`);
  const headers = { Authorization: `Bearer ${token}` };

  const created = await request.post(`${API_URL}/api/chatbots`, {
    headers,
    data: { websiteUrl: 'https://example.com', businessName: 'E2E Widget Co' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const bot = (await created.json()) as { id: string };

  const src = await request.post(`${API_URL}/api/chatbots/${bot.id}/sources`, {
    headers,
    data: {
      type: 'manual',
      title: 'About us',
      content: 'E2E Widget Co is open Monday to Friday, 9am to 6pm. We sell handmade widgets and ship across India.',
    },
  });
  expect(src.ok(), await src.text()).toBeTruthy();

  const pub = await request.post(`${API_URL}/api/chatbots/${bot.id}/publish`, { headers });
  expect(pub.ok(), await pub.text()).toBeTruthy();
  const result = (await pub.json()) as { publicId: string; widgetUrl: string };
  return { publicId: result.publicId, widgetUrl: result.widgetUrl, token, chatbotId: bot.id };
}

/** Clicks a wizard step, tab OR link with the given name (the UI uses all three for sections). */
export async function openSection(page: Page, name: RegExp): Promise<void> {
  const step = page.getByRole('navigation', { name: /setup progress/i }).getByRole('button', { name });
  if (await step.count()) {
    await step.first().click();
    return;
  }
  const tab = page.getByRole('tab', { name });
  if (await tab.count()) {
    await tab.first().click();
    return;
  }
  await page.getByRole('link', { name }).first().click();
}
