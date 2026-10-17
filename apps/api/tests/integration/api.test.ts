import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_MARKER } from '../../src/ai/mock';
import { makeTestApp, type TestApp } from '../helpers/testApp';

const PLANS = JSON.stringify([{ id: 'free', limits: { chatbots: 3 }, features: { csvExport: true, allowedOrigins: true } }]);
const visitorId = 'visitor-12345678';

describe('API (dev auth, file store, mock AI)', () => {
  let t: TestApp;
  let tokenA: string;
  let tokenB: string;
  let botId: string;
  let publicId: string;
  let previewToken: string;

  beforeAll(async () => {
    t = makeTestApp({ env: { PLANS_JSON: PLANS } });
    tokenA = await t.login('owner-a@example.com');
    tokenB = await t.login('owner-b@example.com');
  });
  afterAll(() => t.close());

  it('serves health and requires auth on private routes', async () => {
    const h = await t.agent.get('/health');
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ ok: true, ai: { ok: true }, devMode: true });
    for (const p of ['/api/me', '/api/chatbots', '/api/conversations', '/api/leads', '/api/dashboard/stats']) {
      const r = await t.agent.get(p);
      expect(r.status, p).toBe(401);
      expect(r.body.error.code).toBe('unauthorized');
    }
    const bad = await t.agent.get('/api/me').set('Authorization', 'Bearer not-a-token');
    expect(bad.status).toBe(401);
  });

  it('returns structured validation errors', async () => {
    const r = await t.agent.post('/api/chatbots').set(t.auth(tokenA)).send({ websiteUrl: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
    expect(r.body.error.details.fieldErrors).toBeTruthy();
    const ssrf = await t.agent.post('/api/chatbots').set(t.auth(tokenA)).send({ websiteUrl: 'http://169.254.169.254', businessName: 'X' });
    expect(ssrf.status).toBe(400);
    expect(ssrf.body.error.code).toBe('invalid_url');
  });

  it('creates a chatbot with knowledge and publishes it', async () => {
    const me = await t.agent.get('/api/me').set(t.auth(tokenA));
    expect(me.status).toBe(200);
    expect(me.body.plan.id).toBe('free');

    const c = await t.agent.post('/api/chatbots').set(t.auth(tokenA)).send({ websiteUrl: 'acme-dental.example', businessName: 'Acme Dental' });
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('draft');
    expect(c.body.publicId).toMatch(/^cb_/);
    botId = c.body.id;
    publicId = c.body.publicId;
    previewToken = c.body.previewToken;

    const early = await t.agent.post(`/api/chatbots/${botId}/publish`).set(t.auth(tokenA));
    expect(early.status).toBe(400);

    const faq = await t.agent
      .post(`/api/chatbots/${botId}/sources`)
      .set(t.auth(tokenA))
      .send({ type: 'faq', question: 'How much does teeth cleaning cost?', answer: 'Teeth cleaning costs Rs 1500 per session.' });
    expect(faq.status).toBe(201);
    const manual = await t.agent
      .post(`/api/chatbots/${botId}/sources`)
      .set(t.auth(tokenA))
      .send({ type: 'manual', title: 'Opening hours', content: 'We are open Monday to Saturday, 9am to 7pm. Closed on Sundays.' });
    expect(manual.status).toBe(201);

    const detail = await t.agent.get(`/api/chatbots/${botId}/sources/${manual.body.id}`).set(t.auth(tokenA));
    expect(detail.body.content).toContain('Closed on Sundays');

    const bot = await t.agent.get(`/api/chatbots/${botId}`).set(t.auth(tokenA));
    const cfg = await t.agent
      .put(`/api/chatbots/${botId}/config`)
      .set(t.auth(tokenA))
      .send({ ...bot.body.config, customInstructions: 'SECRET-OWNER-INSTRUCTIONS: upsell whitening', leadCapture: { ...bot.body.config.leadCapture, enabled: true, trigger: 'after_messages', afterMessages: 2 } });
    expect(cfg.status).toBe(200);

    const pub = await t.agent.post(`/api/chatbots/${botId}/publish`).set(t.auth(tokenA));
    expect(pub.status).toBe(200);
    expect(pub.body.version).toBe(1);
    expect(pub.body.embedCode).toContain(`data-chatbot-id="${publicId}"`);
    expect(pub.body.embedCode).toContain('http://localhost:8787/widget.js');
    expect(pub.body.hostedUrl).toBe(`http://localhost:5173/chat/${publicId}`);
    expect(pub.body.chatbot.status).toBe('published');
  });

  it('public config exposes only safe fields and never custom instructions (H2)', async () => {
    const r = await t.agent.get(`/api/public/chatbots/${publicId}/config`);
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('published');
    expect(r.body.businessName).toBe('Acme Dental');
    expect(r.body.config.customInstructions).toBe('');
    const raw = JSON.stringify(r.body);
    for (const leak of ['SECRET-OWNER-INSTRUCTIONS', 'ownerId', previewToken, botId]) expect(raw).not.toContain(leak);
    expect(r.headers['access-control-allow-origin']).toBe('*');

    const draft = await t.agent.get(`/api/public/chatbots/${publicId}/config`).set('X-Preview-Token', previewToken);
    expect(draft.body.mode).toBe('draft');
    expect(draft.body.config.customInstructions).toBe('');
    const draftQ = await t.agent.get(`/api/public/chatbots/${publicId}/config?previewToken=${previewToken}`);
    expect(draftQ.body.mode).toBe('draft');
  });

  let conversationId: string;
  let conversationToken: string;

  it('answers public messages from knowledge and binds conversations to visitor (M4)', async () => {
    const first = await t.agent.post(`/api/public/chatbots/${publicId}/messages`).send({ message: 'How much does cleaning cost?', visitorId, channel: 'widget' });
    expect(first.status).toBe(200);
    expect(first.body.message.content).toContain(MOCK_MARKER);
    expect(first.body.message.content).toContain('1500');
    expect(first.body.showLeadForm).toBe(false);
    conversationId = first.body.conversationId;
    conversationToken = first.body.conversationToken;
    // The knowledge reaches the model only in a user-role block.
    const sys = t.provider.lastRequest!.messages.find((m) => m.role === 'system')!;
    expect(sys.content).not.toContain('Rs 1500');
    expect(sys.content).toContain('SECRET-OWNER-INSTRUCTIONS');

    const noToken = await t.agent.post(`/api/public/chatbots/${publicId}/messages`).send({ message: 'And hours?', visitorId, conversationId });
    expect(noToken.status).toBe(403);
    const otherVisitor = await t.agent
      .post(`/api/public/chatbots/${publicId}/messages`)
      .send({ message: 'And hours?', visitorId: 'someone-else-999', conversationId, conversationToken });
    expect(otherVisitor.status).toBe(403);

    const second = await t.agent.post(`/api/public/chatbots/${publicId}/messages`).send({ message: 'When are you open on Saturday?', visitorId, conversationId, conversationToken });
    expect(second.status).toBe(200);
    expect(second.body.conversationId).toBe(conversationId);
    expect(second.body.showLeadForm).toBe(true);
  });

  it('answers overview questions using home/FAQ context instead of the fallback', async () => {
    const before = t.provider.calls;
    const r = await t.agent.post(`/api/public/chatbots/${publicId}/messages`).send({ message: 'What do you do?', visitorId });
    expect(r.status).toBe(200);
    expect(r.body.message.fallback).toBeFalsy();
    expect(t.provider.calls).toBe(before + 1);
    const hi = await t.agent.post(`/api/public/chatbots/${publicId}/messages`).send({ message: 'hi', visitorId });
    expect(hi.body.message.content).toContain('Welcome to Acme Dental');
    expect(t.provider.calls).toBe(before + 1);
  });

  it('shows conversations to the owner only', async () => {
    const list = await t.agent.get('/api/conversations').set(t.auth(tokenA));
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toContain(conversationId);
    const one = await t.agent.get(`/api/conversations/${conversationId}`).set(t.auth(tokenA));
    expect(one.body.messages).toHaveLength(4);
    expect(one.body.messages[0].role).toBe('user');
    const search = await t.agent.get('/api/conversations?q=saturday').set(t.auth(tokenA));
    expect(search.body.items.map((c: { id: string }) => c.id)).toEqual([conversationId]);

    const listB = await t.agent.get('/api/conversations').set(t.auth(tokenB));
    expect(listB.body.items).toHaveLength(0);
    const oneB = await t.agent.get(`/api/conversations/${conversationId}`).set(t.auth(tokenB));
    expect(oneB.status).toBe(404);
    const delB = await t.agent.delete(`/api/conversations/${conversationId}`).set(t.auth(tokenB));
    expect(delB.status).toBe(404);
  });

  it('isolates tenants on chatbots, sources, crawl and publish', async () => {
    const tries = [
      () => t.agent.get(`/api/chatbots/${botId}`),
      () => t.agent.patch(`/api/chatbots/${botId}`).send({ name: 'hijack' }),
      () => t.agent.put(`/api/chatbots/${botId}/config`).send({}),
      () => t.agent.post(`/api/chatbots/${botId}/publish`),
      () => t.agent.post(`/api/chatbots/${botId}/unpublish`),
      () => t.agent.get(`/api/chatbots/${botId}/sources`),
      () => t.agent.post(`/api/chatbots/${botId}/sources`).send({ type: 'faq', question: 'Injected?', answer: 'yes' }),
      () => t.agent.get(`/api/chatbots/${botId}/crawl-jobs`),
      () => t.agent.post(`/api/chatbots/${botId}/preview/messages`).send({ message: 'hi' }),
      () => t.agent.post(`/api/chatbots/${botId}/preview-token/rotate`),
      () => t.agent.get(`/api/chatbots/${botId}/install-status`),
      () => t.agent.delete(`/api/chatbots/${botId}`),
    ];
    for (const make of tries) {
      const r = await make().set(t.auth(tokenB));
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('not_found');
    }
    const listB = await t.agent.get('/api/chatbots').set(t.auth(tokenB));
    expect(listB.body.items).toHaveLength(0);
    const leadsB = await t.agent.get(`/api/leads?chatbotId=${botId}`).set(t.auth(tokenB));
    expect(leadsB.body.items).toHaveLength(0);
    // Still intact for A.
    const a = await t.agent.get(`/api/chatbots/${botId}`).set(t.auth(tokenA));
    expect(a.body.name).toBe('Acme Dental');
  });

  it('captures leads, links the conversation and exports CSV safely', async () => {
    const noContact = await t.agent.post(`/api/public/chatbots/${publicId}/leads`).send({ visitorId, name: 'Ann', consent: true });
    expect(noContact.status).toBe(400);
    const noConsent = await t.agent.post(`/api/public/chatbots/${publicId}/leads`).send({ visitorId, email: 'a@b.example' });
    expect(noConsent.status).toBe(400);
    const lead = await t.agent
      .post(`/api/public/chatbots/${publicId}/leads`)
      .send({ visitorId, conversationId, conversationToken, name: '=HYPERLINK("http://evil")', email: 'ann@example.com', consent: true, message: 'Call me, "please"' });
    expect(lead.status).toBe(201);
    expect(lead.body.ok).toBe(true);

    const conv = await t.agent.get(`/api/conversations/${conversationId}`).set(t.auth(tokenA));
    expect(conv.body.conversation.hasLead).toBe(true);
    const leads = await t.agent.get('/api/leads').set(t.auth(tokenA));
    expect(leads.body.items).toHaveLength(1);
    const csv = await t.agent.get('/api/leads/export.csv').set(t.auth(tokenA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.text).toContain('"Call me, ""please"""');
    const csvB = await t.agent.get('/api/leads/export.csv').set(t.auth(tokenB));
    expect(csvB.text.trim().split('\n')).toHaveLength(1);

    // After the lead, the form is not shown again.
    const again = await t.agent.post(`/api/public/chatbots/${publicId}/messages`).send({ message: 'Thanks, what about braces?', visitorId, conversationId, conversationToken });
    expect(again.body.showLeadForm).toBe(false);
  });

  it('enforces allowedOrigins as a soft control', async () => {
    const p = await t.agent.patch(`/api/chatbots/${botId}`).set(t.auth(tokenA)).send({ allowedOrigins: ['good.example'] });
    expect(p.status).toBe(200);
    expect(p.body.allowedOrigins).toEqual(['https://good.example']);
    const evil = await t.agent.get(`/api/public/chatbots/${publicId}/config`).set('Origin', 'https://evil.example');
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('origin_not_allowed');
    const evilMsg = await t.agent.post(`/api/public/chatbots/${publicId}/messages`).set('Origin', 'https://evil.example').send({ message: 'hi', visitorId });
    expect(evilMsg.status).toBe(403);
    const good = await t.agent.get(`/api/public/chatbots/${publicId}/config`).set('Origin', 'https://good.example');
    expect(good.status).toBe(200);
    const app = await t.agent.get(`/api/public/chatbots/${publicId}/config`).set('Origin', 'http://localhost:5173');
    expect(app.status).toBe(200);
    const install = await t.agent.get(`/api/chatbots/${botId}/install-status`).set(t.auth(tokenA));
    expect(install.body).toMatchObject({ published: true, lastSeenOrigin: 'https://good.example' });
    await t.agent.patch(`/api/chatbots/${botId}`).set(t.auth(tokenA)).send({ allowedOrigins: [] });
  });

  it('preview endpoint returns retrieved excerpts and rotating the preview token invalidates the old one', async () => {
    const pv = await t.agent.post(`/api/chatbots/${botId}/preview/messages`).set(t.auth(tokenA)).send({ message: 'cleaning price', history: [] });
    expect(pv.status).toBe(200);
    expect(pv.body.message.role).toBe('assistant');
    expect(pv.body.retrieved.length).toBeGreaterThan(0);
    const rot = await t.agent.post(`/api/chatbots/${botId}/preview-token/rotate`).set(t.auth(tokenA));
    expect(rot.status).toBe(200);
    expect(rot.body.previewToken).not.toBe(previewToken);
    const old = await t.agent.get(`/api/public/chatbots/${publicId}/config`).set('X-Preview-Token', previewToken);
    expect(old.status).toBe(404);
  });

  it('AI failure: preview gets 503, public chat gets the fallback', async () => {
    t.provider.failNext = 1;
    const pv = await t.agent.post(`/api/chatbots/${botId}/preview/messages`).set(t.auth(tokenA)).send({ message: 'cleaning price' });
    expect(pv.status).toBe(503);
    expect(pv.body.error.code).toBe('ai_unavailable');
    t.provider.failNext = 1;
    const pub = await t.agent.post(`/api/public/chatbots/${publicId}/messages`).send({ message: 'cleaning price', visitorId });
    expect(pub.status).toBe(200);
    expect(pub.body.message.fallback).toBe(true);
  });

  it('dashboard stats are computed from real data', async () => {
    const s = await t.agent.get('/api/dashboard/stats?days=7').set(t.auth(tokenA));
    expect(s.status).toBe(200);
    expect(s.body.chatbots).toMatchObject({ total: 1, published: 1 });
    expect(s.body.conversations.series).toHaveLength(7);
    expect(s.body.conversations.count).toBeGreaterThanOrEqual(1);
    expect(s.body.leads.count).toBe(1);
    expect(s.body.usage.messages).toBeGreaterThan(0);
    expect(s.body.recentActivity.length).toBeGreaterThan(0);
  });

  it('unpublished bots are not reachable publicly', async () => {
    const un = await t.agent.post(`/api/chatbots/${botId}/unpublish`).set(t.auth(tokenA));
    expect(un.body.status).toBe('unpublished');
    const cfg = await t.agent.get(`/api/public/chatbots/${publicId}/config`);
    expect(cfg.status).toBe(404);
    expect(cfg.body.error.code).toBe('not_published');
    const msg = await t.agent.post(`/api/public/chatbots/${publicId}/messages`).send({ message: 'hello?', visitorId });
    expect(msg.status).toBe(404);
    const unknown = await t.agent.get('/api/public/chatbots/cb_doesnotexist123/config');
    expect(unknown.status).toBe(404);
  });

  it('serves widget.js with cross-origin headers (503 until built)', async () => {
    const missing = await t.agent.get('/widget.js');
    expect(missing.status).toBe(503);
    fs.mkdirSync(t.env.WIDGET_DIST_DIR, { recursive: true });
    fs.writeFileSync(path.join(t.env.WIDGET_DIST_DIR, 'widget.js'), 'window.ChatPilot={};');
    const ok = await t.agent.get('/widget/v1/widget.js');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('application/javascript');
    expect(ok.headers['access-control-allow-origin']).toBe('*');
    expect(ok.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(ok.headers['cache-control']).toBe('public, max-age=300');
  });

  it('admin cleanup requires the admin token', async () => {
    expect((await t.agent.post('/api/admin/cleanup')).status).toBe(401);
    const ok = await t.agent.post('/api/admin/cleanup').set('x-admin-token', t.env.ADMIN_TOKEN!);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });

  it('DELETE /api/me removes all tenant data', async () => {
    const del = await t.agent.delete('/api/me').set(t.auth(tokenA));
    expect(del.status).toBe(200);
    expect(await t.store.getChatbot(botId)).toBeNull();
    expect(await t.store.getConversation(conversationId)).toBeNull();
    const me = await t.agent.get('/api/me').set(t.auth(tokenA));
    expect(me.body.usage.messages).toBe(0);
    const bots = await t.agent.get('/api/chatbots').set(t.auth(tokenA));
    expect(bots.body.items).toHaveLength(0);
  });
});

describe('quotas', () => {
  let t: TestApp;
  beforeAll(() => {
    t = makeTestApp({ env: { PLANS_JSON: JSON.stringify([{ id: 'free', limits: { messagesPerMonth: 2, chatbots: 1 } }]) } });
  });
  afterAll(() => t.close());

  it('returns 402 quota_exceeded with structured details, and a friendly 429 to the widget', async () => {
    const token = await t.login('quota@example.com');
    const c = await t.agent.post('/api/chatbots').set(t.auth(token)).send({ websiteUrl: 'https://quota.example', businessName: 'Quota Co' });
    expect(c.status).toBe(201);
    const second = await t.agent.post('/api/chatbots').set(t.auth(token)).send({ websiteUrl: 'https://quota2.example', businessName: 'Quota 2' });
    expect(second.status).toBe(402);
    expect(second.body.error.details).toMatchObject({ metric: 'chatbots', limit: 1, used: 1, planId: 'free' });

    await t.agent.post(`/api/chatbots/${c.body.id}/sources`).set(t.auth(token)).send({ type: 'faq', question: 'Do you deliver?', answer: 'Yes, across the city.' });
    const pub = await t.agent.post(`/api/chatbots/${c.body.id}/publish`).set(t.auth(token));
    expect(pub.status).toBe(200);

    expect((await t.agent.post(`/api/chatbots/${c.body.id}/preview/messages`).set(t.auth(token)).send({ message: 'deliver?' })).status).toBe(200);
    expect((await t.agent.post(`/api/public/chatbots/${c.body.publicId}/messages`).send({ message: 'deliver?', visitorId })).status).toBe(200);

    const over = await t.agent.post(`/api/chatbots/${c.body.id}/preview/messages`).set(t.auth(token)).send({ message: 'deliver?' });
    expect(over.status).toBe(402);
    expect(over.body.error.code).toBe('quota_exceeded');
    expect(over.body.error.details).toMatchObject({ metric: 'messages', limit: 2, used: 2, planId: 'free' });
    expect(over.body.error.details.resetAt).toMatch(/^\d{4}-\d{2}-01T/);

    const calls = t.provider.calls;
    const widget = await t.agent.post(`/api/public/chatbots/${c.body.publicId}/messages`).send({ message: 'deliver?', visitorId });
    expect(widget.status).toBe(429);
    expect(widget.body.error.code).toBe('quota_exceeded');
    expect(widget.body.error.details).toBeUndefined();
    expect(t.provider.calls).toBe(calls);
  });

  it('bots without any knowledge answer with the fallback and no AI call', async () => {
    const token = await t.login('empty@example.com');
    const c = await t.agent.post('/api/chatbots').set(t.auth(token)).send({ websiteUrl: 'https://empty.example', businessName: 'Empty' });
    const calls = t.provider.calls;
    const pv = await t.agent.post(`/api/chatbots/${c.body.id}/preview/messages`).set(t.auth(token)).send({ message: 'What do you do?' });
    expect(pv.status).toBe(200);
    expect(pv.body.message.fallback).toBe(true);
    expect(t.provider.calls).toBe(calls);
  });
});
