import { expect, test } from '@playwright/test';
import { createPublishedBotViaApi, openCustomerPage, widgetLauncher, widgetPanel } from './helpers';

/**
 * Widget layout on a customer page:
 *  - mobile 390×844  → panel is full-screen (covers the viewport), close button visible
 *  - desktop 1440×900 → floating panel anchored bottom-right, launcher stays visible
 * The chatbot is created + published via the API (manual knowledge, no crawl).
 */

let bot: { publicId: string; widgetUrl: string };

test.beforeAll(async ({ request }) => {
  bot = await createPublishedBotViaApi(request);
});

test('mobile 390×844: full-screen panel', async ({ browser }) => {
  const viewport = { width: 390, height: 844 };
  const page = await openCustomerPage(browser, { ...bot, viewport, isMobile: true });

  const launcher = widgetLauncher(page);
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  await launcher.click();

  const panel = widgetPanel(page);
  await expect(panel).toBeVisible();
  // Wait for the open animation (slide-up) to settle before measuring.
  await expect.poll(async () => (await panel.boundingBox())?.y ?? 999, { timeout: 3_000 }).toBeLessThanOrEqual(1);
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  // Full-screen: covers the whole viewport (allow 1px rounding).
  expect(box!.x).toBeLessThanOrEqual(1);
  expect(box!.y).toBeLessThanOrEqual(1);
  expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(box!.height).toBeGreaterThanOrEqual(viewport.height - 1);

  // No horizontal scroll introduced by the widget.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Composer reachable; close button returns to launcher.
  await expect(panel.getByRole('textbox', { name: /message|type/i })).toBeVisible();
  await panel.getByRole('button', { name: /close|minimi[sz]e/i }).first().click();
  await expect(panel).toBeHidden();
  await expect(launcher).toBeVisible();

  await page.context().close();
});

test('desktop 1440×900: floating panel bottom-right', async ({ browser }) => {
  const viewport = { width: 1440, height: 900 };
  const page = await openCustomerPage(browser, { ...bot, viewport });

  const launcher = widgetLauncher(page);
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  const lb = (await launcher.boundingBox())!;
  // Default position: right. Launcher sits in the bottom-right corner.
  expect(lb.x + lb.width).toBeGreaterThan(viewport.width - 120);
  expect(lb.y + lb.height).toBeGreaterThan(viewport.height - 120);

  await launcher.click();
  const panel = widgetPanel(page);
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;

  // Floating, not full-screen.
  expect(box.width).toBeLessThan(520);
  expect(box.width).toBeGreaterThan(300);
  expect(box.height).toBeLessThan(viewport.height);
  expect(box.height).toBeGreaterThan(400);
  // Anchored bottom-right with a margin, fully inside the viewport.
  expect(box.x).toBeGreaterThan(viewport.width / 2);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await page.context().close();
});
