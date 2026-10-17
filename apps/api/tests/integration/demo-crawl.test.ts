import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_MARKER } from '../../src/ai/mock';
import { htmlPage, startSite, type SiteServer } from '../helpers/siteServer';
import { makeTestApp, type TestApp } from '../helpers/testApp';

const visitorId = 'visitor-demo-0001';

describe('crawl + demo flows against a local site', () => {
  let site: SiteServer;
  let t: TestApp;

  beforeAll(async () => {
    site = await startSite({
      '/robots.txt': { body: 'User-agent: *\nAllow: /\n', headers: { 'content-type': 'text/plain' } },
      '/': {
        headers: { 'x-frame-options': 'SAMEORIGIN' },
        body: htmlPage({
          title: 'Sunrise Bakery',
          head: '<meta property="og:site_name" content="Sunrise Bakery"><meta name="description" content="Fresh bread daily">',
          body: '<main><h1>Sunrise Bakery</h1><p>We bake fresh sourdough bread, croissants and custom birthday cakes every morning in Kochi.</p><a href="/menu">Menu</a><a href="/contact">Contact</a></main>',
        }),
      },
      '/menu': { body: htmlPage({ title: 'Menu', body: '<main><h1>Menu</h1><p>Sourdough loaf costs Rs 250. Butter croissant costs Rs 90. Custom cakes start at Rs 1200 per kilogram.</p></main>' }) },
      '/contact': { body: htmlPage({ title: 'Contact', body: '<main><h1>Contact</h1><p>Visit us at Marine Drive, Kochi. Open daily from 7am to 9pm. Call 0484-555-1234 for orders.</p></main>' }) },
    });
    t = makeTestApp({
      env: { DEMO_MAX_MESSAGES: '3', PLANS_JSON: JSON.stringify([{ id: 'free', limits: { knowledgeCharsPerBot: 100_000 } }]) },
      overrides: { allowPrivateForTests: { hosts: [site.host] } },
    });
  });
  afterAll(async () => {
    await t.close();
    await site.close();
  });

  it('crawls via the API, applies knowledge and keeps FAQ + excluded pages on recrawl', async () => {
    const token = await t.login('baker@example.com');
    const bot = await t.agent.post('/api/chatbots').set(t.auth(token)).send({ websiteUrl: site.url, businessName: 'Sunrise Bakery' });
    expect(bot.status).toBe(201);
    const id = bot.body.id;
    await t.agent.post(`/api/chatbots/${id}/sources`).set(t.auth(token)).send({ type: 'faq', question: 'Do you deliver?', answer: 'Yes, within 5 km.' });

    const job = await t.agent.post(`/api/chatbots/${id}/crawl`).set(t.auth(token)).send({});
    expect(job.status).toBe(202);
    expect(job.body.status).toBe('queued');
    const dup = await t.agent.post(`/api/chatbots/${id}/crawl`).set(t.auth(token)).send({});
    expect(dup.status).toBe(409);
    await t.ctx.queue.idle();

    const done = await t.agent.get(`/api/chatbots/${id}/crawl-jobs/${job.body.id}`).set(t.auth(token));
    expect(done.body.status).toBe('completed');
    expect(done.body.stats.processed).toBe(3);
    expect(done.body.pages).toHaveLength(5); // + /about and /pricing nav links that 404

    const sources = await t.agent.get(`/api/chatbots/${id}/sources?limit=50`).set(t.auth(token));
    const pages = sources.body.items.filter((s: { type: string }) => s.type === 'page');
    expect(pages).toHaveLength(3);
    const menu = pages.find((s: { url: string }) => s.url.endsWith('/menu'));
    const detail = await t.agent.get(`/api/chatbots/${id}/sources/${menu.id}`).set(t.auth(token));
    expect(detail.body.content).toContain('Rs 250');
    expect(detail.body.content).not.toContain('All rights reserved');

    const after = await t.agent.get(`/api/chatbots/${id}`).set(t.auth(token));
    expect(after.body.siteMeta.siteName).toBe('Sunrise Bakery');
    expect(after.body.siteMeta.frameable).toBe(false);
    expect(after.body.stats.sources).toBe(4);
    const v1 = after.body.knowledgeVersion;

    // Exclude the contact page, then recrawl.
    const contact = pages.find((s: { url: string }) => s.url.endsWith('/contact'));
    await t.agent.patch(`/api/chatbots/${id}/sources/${contact.id}`).set(t.auth(token)).send({ status: 'excluded' });
    const job2 = await t.agent.post(`/api/chatbots/${id}/crawl`).set(t.auth(token)).send({});
    expect(job2.status).toBe(202);
    await t.ctx.queue.idle();
    const s2 = await t.agent.get(`/api/chatbots/${id}/sources?limit=50`).set(t.auth(token));
    const items = s2.body.items as { type: string; status: string; url?: string; id: string }[];
    expect(items.filter((s) => s.type === 'faq')).toHaveLength(1);
    expect(items.filter((s) => s.type === 'page')).toHaveLength(3);
    const contactAgain = items.find((s) => s.url?.endsWith('/contact'))!;
    expect(contactAgain.status).toBe('excluded');
    expect(contactAgain.id).toBe(contact.id);
    const after2 = await t.agent.get(`/api/chatbots/${id}`).set(t.auth(token));
    expect(after2.body.knowledgeVersion).toBeGreaterThan(v1);

    // Excluded sources are not used for answers.
    const pv = await t.agent.post(`/api/chatbots/${id}/preview/messages`).set(t.auth(token)).send({ message: 'phone number for orders Marine Drive' });
    expect(pv.body.retrieved.every((r: { url?: string }) => !r.url?.endsWith('/contact'))).toBe(true);

    const me = await t.agent.get('/api/me').set(t.auth(token));
    expect(me.body.usage.crawls).toBe(2);
    expect(me.body.usage.pagesCrawled).toBe(6);
  });

  it('runs the landing-page demo end to end', async () => {
    const created = await t.agent.post('/api/public/demo').send({ url: site.url });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('crawling');
    expect(created.body.publicId).toMatch(/^cb_/);
    await t.ctx.crawls.demoQueue.idle();

    const ready = await t.agent.get(`/api/public/demo/${created.body.demoId}`);
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready');
    expect(ready.body.pagesProcessed).toBe(3);
    expect(ready.body.siteMeta.siteName).toBe('Sunrise Bakery');
    expect(ready.body.siteMeta.frameable).toBe(false);

    const cfg = await t.agent.get(`/api/public/chatbots/${created.body.publicId}/config`);
    expect(cfg.status).toBe(200);
    // Demo bots are renamed from the crawled site's title, not the hostname.
    expect(cfg.body.config.welcomeMessage).toContain('Sunrise Bakery');
    expect(cfg.body.businessName).toBe('Sunrise Bakery');

    const ask = (message: string) => t.agent.post(`/api/public/chatbots/${created.body.publicId}/messages`).send({ message, visitorId, channel: 'demo' });
    const a1 = await ask('How much is a sourdough loaf?');
    expect(a1.status).toBe(200);
    expect(a1.body.message.content).toContain(MOCK_MARKER);
    expect(a1.body.message.content).toContain('Rs 250');
    expect(a1.body.showLeadForm).toBe(false);
    await ask('croissant price');
    await ask('cake price');
    const capped = await ask('opening hours');
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe('quota_exceeded');

    // Demo bots never accept leads, and demo conversations are not owned by any tenant.
    const lead = await t.agent.post(`/api/public/chatbots/${created.body.publicId}/leads`).send({ visitorId, email: 'x@example.com', consent: true });
    expect(lead.status).toBe(403);

    // Expired demos are cascade-deleted by the cleanup job.
    await t.store.updateChatbot(created.body.demoId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const clean = await t.agent.post('/api/admin/cleanup').set('x-admin-token', t.env.ADMIN_TOKEN!);
    expect(clean.body.expiredDemos).toBe(1);
    expect(await t.store.getChatbot(created.body.demoId)).toBeNull();
    expect(await t.store.getPublicConfig(created.body.publicId)).toBeNull();
    expect((await t.agent.get(`/api/public/demo/${created.body.demoId}`)).status).toBe(404);
  });

  it('rejects the demo channel for normal bots and SSRF demo URLs', async () => {
    const bad = await t.agent.post('/api/public/demo').send({ url: 'http://localhost:8787/health' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_url');
    const meta = await t.agent.post('/api/public/demo').send({ url: 'http://169.254.169.254/latest/meta-data' });
    expect(meta.status).toBe(400);
  });

  it('frame-check reports X-Frame-Options', async () => {
    const r = await t.agent.get('/api/public/frame-check').query({ url: `${site.url}/` });
    expect(r.status).toBe(200);
    expect(r.body.frameable).toBe(false);
    expect(r.body.reason).toMatch(/SAMEORIGIN/);
    const ok = await t.agent.get('/api/public/frame-check').query({ url: `${site.url}/menu` });
    expect(ok.body.frameable).toBe(true);
  });
});
