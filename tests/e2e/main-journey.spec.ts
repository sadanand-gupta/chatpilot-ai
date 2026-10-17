import { expect, test } from '@playwright/test';
import {
  SITE_URL,
  openCustomerPage,
  openSection,
  sendWidgetMessage,
  uniqueSuffix,
  widgetLauncher,
  widgetPanel,
} from './helpers';

/**
 * Definition-of-done journey (dev mode: AUTH_MODE=dev, DATA_STORE=file, AI_PROVIDER=mock):
 * register → create chatbot from URL → crawl completes → review knowledge → configure
 * (colour, welcome, lead capture) → preview desktop/mobile + test message → publish →
 * embed code → widget on a separate "customer" page → chat → inbox → lead → leads table.
 *
 * See tests/e2e/helpers.ts for the selector / test-id contract the UI must satisfy.
 */

const run = uniqueSuffix();
const OWNER_EMAIL = `owner-${run}@e2e.test`;
const OWNER_PASSWORD = 'E2e-password-123!';
const BUSINESS = `E2E Business ${run}`;
const WELCOME = `Welcome to the E2E test ${run}!`;
const COLOR = '#16A34A'; // rgb(22, 163, 74)
const VISITOR_MSG_1 = `What do you offer? (${run})`;
const VISITOR_MSG_2 = `How can I contact you? (${run})`;
const LEAD_EMAIL = `lead-${run}@e2e.test`;

test.describe.configure({ mode: 'serial' });

test('main journey: URL → crawl → configure → publish → embed → chat → inbox → lead', async ({ page, browser }) => {
  // ── 1. Register (dev auth) ───────────────────────────────────────────────
  await test.step('register', async () => {
    await page.goto('/register');
    // Routes are lazy-loaded: wait for the form before probing optional fields.
    await expect(page.getByLabel(/email/i).first()).toBeVisible();
    const name = page.getByLabel(/^(your )?name/i);
    if (await name.count()) await name.first().fill('E2E Owner');
    await page.getByLabel(/email/i).first().fill(OWNER_EMAIL);
    const pwd = page.getByLabel(/^password/i);
    if (await pwd.count()) await pwd.first().fill(OWNER_PASSWORD); // dev mode may hide password
    await page.getByRole('button', { name: /create account|sign up|get started|register/i }).click();
    await expect(page).not.toHaveURL(/\/register/);
  });

  // ── 2. Create a chatbot from a public URL ────────────────────────────────
  await test.step('enter website URL', async () => {
    if (!(await page.getByLabel(/website url/i).count())) {
      // Not auto-redirected to onboarding — use the dashboard CTA.
      await page.getByRole('link', { name: /new chatbot|create( a)? chatbot|add chatbot/i })
        .or(page.getByRole('button', { name: /new chatbot|create( a)? chatbot|add chatbot/i }))
        .first()
        .click();
    }
    await page.getByLabel(/website url/i).fill(SITE_URL);
    await page.getByLabel(/website url/i).press('Tab'); // triggers the business-name prefill first
    const biz = page.getByLabel(/business name/i);
    if (await biz.count()) {
      await expect(biz).not.toHaveValue('');
      await biz.fill(BUSINESS);
    }
    await page.getByRole('button', { name: /create|build|generate|continue|start/i }).first().click();
  });

  // ── 3. Crawl completes ───────────────────────────────────────────────────
  await test.step('crawl completes', async () => {
    await expect(page.getByText(/crawl(ing)? (completed|complete|finished)|knowledge (is )?ready/i).first()).toBeVisible({
      timeout: 150_000,
    });
    await expect(page.getByText(/crawl failed/i)).toHaveCount(0);
  });

  // ── 4. Review knowledge ──────────────────────────────────────────────────
  await test.step('review knowledge', async () => {
    await openSection(page, /knowledge/i);
    const rows = page.getByTestId('knowledge-source-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
    if (SITE_URL === 'https://example.com') {
      await expect(page.getByText(/example domain/i).first()).toBeVisible();
    }
  });

  // ── 5. Configure: colour, welcome message, lead capture ──────────────────
  await test.step('configure', async () => {
    await openSection(page, /appearance|customi[sz]e|design|configure|settings/i);
    const color = page.getByLabel(/primary colou?r/i).first();
    await color.fill(COLOR);
    const welcome = page.getByLabel(/welcome message/i);
    await welcome.fill(WELCOME);

    const lead = page
      .getByRole('switch', { name: /lead capture|collect leads/i })
      .or(page.getByRole('checkbox', { name: /lead capture|collect leads/i }))
      .first();
    if (!(await lead.isVisible().catch(() => false))) await openSection(page, /leads? (capture|form)|behaviou?r/i);
    // isChecked() understands native checkboxes and role=switch/aria-checked.
    if (!(await lead.isChecked())) await lead.click();
    await expect(lead).toBeChecked();

    await page.getByRole('button', { name: /^save/i }).first().click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
  });

  // ── 6. Preview: desktop/mobile toggle + test message ─────────────────────
  await test.step('preview studio', async () => {
    await openSection(page, /preview/i);
    const studio = page.getByTestId('preview-studio');
    await expect(studio).toBeVisible();
    const device = page.getByTestId('preview-device');

    await page.getByRole('button', { name: /mobile/i }).or(page.getByRole('radio', { name: /mobile/i })).or(page.getByRole('tab', { name: /mobile/i })).first().click();
    await expect(device).toHaveAttribute('data-device', 'mobile');
    await page.getByRole('button', { name: /desktop/i }).or(page.getByRole('radio', { name: /desktop/i })).or(page.getByRole('tab', { name: /desktop/i })).first().click();
    await expect(device).toHaveAttribute('data-device', 'desktop');

    // Open the previewed widget if it renders closed.
    const launcher = studio.getByRole('button', { name: /open chat|chat with us|^chat$/i });
    if (await launcher.isVisible().catch(() => false)) await launcher.click();
    await expect(studio.getByRole('log').getByText(WELCOME).first()).toBeVisible();
    await sendWidgetMessage(studio, 'Preview test question');
  });

  // ── 7. Publish + embed code ──────────────────────────────────────────────
  let publicId = '';
  let widgetUrl = '';
  await test.step('publish and read embed code', async () => {
    await openSection(page, /^publish/i);
    await page.getByRole('button', { name: /^publish (chatbot|again)/i }).click();
    await expect(page.getByText(/published/i).first()).toBeVisible();
    const embed = page.getByTestId('embed-code');
    await expect(embed).toBeVisible();
    const snippet = (await embed.inputValue().catch(() => null)) ?? (await embed.innerText());
    expect(snippet).toContain('data-chatbot-id=');
    publicId = /data-chatbot-id="([^"]+)"/.exec(snippet)?.[1] ?? '';
    widgetUrl = /src="([^"]+)"/.exec(snippet)?.[1] ?? '';
    expect(publicId, 'publicId in snippet').not.toBe('');
    expect(widgetUrl, 'widget src in snippet').toMatch(/^https?:\/\//);
  });

  // ── 8. Widget on a separate customer website ─────────────────────────────
  await test.step('widget on customer site: chat + lead', async () => {
    const site = await openCustomerPage(browser, { widgetUrl, publicId });
    const launcher = widgetLauncher(site);
    await expect(launcher).toBeVisible({ timeout: 20_000 });
    // Published config is fetched dynamically → the new colour is applied.
    await expect.soft(launcher).toHaveCSS('background-color', 'rgb(22, 163, 74)');
    await launcher.click();

    const panel = widgetPanel(site);
    await expect(panel).toBeVisible();
    await expect(panel.getByText(WELCOME)).toBeVisible();

    await sendWidgetMessage(panel, VISITOR_MSG_1);
    await sendWidgetMessage(panel, VISITOR_MSG_2); // default trigger: after 2 messages

    const form = panel.getByRole('form', { name: /details|contact|lead/i });
    if (!(await form.isVisible().catch(() => false))) {
      await panel.getByRole('button', { name: /contact us|leave (your )?details/i }).first().click();
    }
    await expect(form).toBeVisible();
    const nameField = form.getByLabel(/name/i);
    if (await nameField.count()) await nameField.first().fill('E2E Lead');
    await form.getByLabel(/email/i).fill(LEAD_EMAIL);
    await form.getByRole('checkbox').first().check();
    await form.getByRole('button', { name: /submit|send/i }).click();
    await expect(panel.getByText(/thank/i).first()).toBeVisible();

    await site.context().close();
  });

  // ── 9. Conversation appears in the inbox ─────────────────────────────────
  await test.step('conversation in inbox', async () => {
    await page.getByRole('link', { name: /conversations|inbox/i }).first().click();
    const item = page.getByText(VISITOR_MSG_2).or(page.getByText(VISITOR_MSG_1)).first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByText(VISITOR_MSG_1).first()).toBeVisible();
  });

  // ── 10. Lead appears in the leads table ──────────────────────────────────
  await test.step('lead in leads table', async () => {
    await page.getByRole('link', { name: /^leads/i }).first().click();
    await expect(page.getByRole('row').filter({ hasText: LEAD_EMAIL }).or(page.getByText(LEAD_EMAIL)).first()).toBeVisible();
  });
});
