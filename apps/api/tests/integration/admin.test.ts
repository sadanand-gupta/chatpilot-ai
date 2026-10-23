import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from '../helpers/testApp';

const ADMIN = 'speedolive369@gmail.com';

describe('admin console', () => {
  let t: TestApp;
  let admin: string;
  let owner: string;
  let ownerUid: string;
  let botId: string;

  beforeAll(async () => {
    t = makeTestApp();
    admin = await t.login(ADMIN);
    owner = await t.login('owner@example.com');
    const me = await t.agent.get('/api/me').set(t.auth(owner)).set('User-Agent', 'TestBrowser/1.0');
    ownerUid = me.body.user.uid;
    const bot = await t.agent.post('/api/chatbots').set(t.auth(owner)).send({ websiteUrl: 'acme.example', businessName: 'Acme' });
    expect(bot.status).toBe(201);
    botId = bot.body.id;
  });
  afterAll(() => t.close());

  it('flags only ADMIN_EMAILS accounts as admin on /me', async () => {
    expect((await t.agent.get('/api/me').set(t.auth(admin))).body.isAdmin).toBe(true);
    expect((await t.agent.get('/api/me').set(t.auth(owner))).body.isAdmin).toBe(false);
  });

  it('refuses the console to anonymous and non-admin users', async () => {
    for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/chatbots', '/api/admin/activity']) {
      expect((await t.agent.get(p)).status, p).toBe(401);
      const r = await t.agent.get(p).set(t.auth(owner));
      expect(r.status, p).toBe(403);
      expect(r.body.error.code).toBe('forbidden');
    }
    expect((await t.agent.patch(`/api/admin/users/${ownerUid}`).set(t.auth(owner)).send({ planId: 'pro' })).status).toBe(403);
  });

  it('keeps the token-protected cleanup endpoint working', async () => {
    expect((await t.agent.post('/api/admin/cleanup')).status).toBe(401);
    // A signed-in admin still needs the operator token for this one.
    expect((await t.agent.post('/api/admin/cleanup').set(t.auth(admin))).status).toBe(401);
    const ok = await t.agent.post('/api/admin/cleanup').set('x-admin-token', t.env.ADMIN_TOKEN!);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('activityDeleted');
  });

  it('logs sign-ups with email, IP and browser, plus chatbot activity', async () => {
    const r = await t.agent.get('/api/admin/activity').set(t.auth(admin));
    expect(r.status).toBe(200);
    const signUp = r.body.items.find((e: { type: string; email?: string }) => e.type === 'sign_up' && e.email === 'owner@example.com');
    expect(signUp).toMatchObject({ uid: ownerUid, userAgent: 'TestBrowser/1.0' });
    expect(signUp.ip).toBeTruthy();
    expect(r.body.items.some((e: { type: string; chatbotId?: string }) => e.type === 'chatbot_created' && e.chatbotId === botId)).toBe(true);

    const filtered = await t.agent.get('/api/admin/activity?type=chatbot_created').set(t.auth(admin));
    expect(filtered.body.items.every((e: { type: string }) => e.type === 'chatbot_created')).toBe(true);
  });

  it('records lastActiveAt / sign-in count and lists users with their chatbots', async () => {
    const users = await t.agent.get('/api/admin/users').set(t.auth(admin));
    expect(users.status).toBe(200);
    const row = users.body.items.find((u: { uid: string }) => u.uid === ownerUid);
    expect(row).toMatchObject({ email: 'owner@example.com', chatbotCount: 1, isAdmin: false, signInCount: 1 });
    expect(row.lastActiveAt).toBeTruthy();
    expect(users.body.items.find((u: { email: string }) => u.email === ADMIN).isAdmin).toBe(true);

    const search = await t.agent.get('/api/admin/users?q=OWNER@').set(t.auth(admin));
    expect(search.body.items.map((u: { uid: string }) => u.uid)).toEqual([ownerUid]);

    const detail = await t.agent.get(`/api/admin/users/${ownerUid}`).set(t.auth(admin));
    expect(detail.status).toBe(200);
    expect(detail.body.chatbots.map((b: { id: string }) => b.id)).toEqual([botId]);
    expect(detail.body.chatbots[0].previewToken).toBeUndefined();
    expect(detail.body.activity.length).toBeGreaterThan(0);
  });

  it('lists every tenant chatbot with its owner email', async () => {
    const r = await t.agent.get('/api/admin/chatbots').set(t.auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([expect.objectContaining({ id: botId, ownerEmail: 'owner@example.com', websiteUrl: expect.stringContaining('acme.example') })]);
    expect(r.body.items[0].previewToken).toBeUndefined();
  });

  it('summarises the platform on the overview', async () => {
    const r = await t.agent.get('/api/admin/overview').set(t.auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.totals).toMatchObject({ users: 2, newUsers7d: 2, activeUsers7d: 2, chatbots: 1, publishedChatbots: 0 });
    expect(r.body.daily).toHaveLength(14);
    expect(r.body.daily.at(-1).signUps).toBe(2);
    expect(r.body.recentActivity.length).toBeGreaterThan(0);
  });

  it('changes plans and suspends / restores accounts, with an audit trail', async () => {
    const plan = await t.agent.patch(`/api/admin/users/${ownerUid}`).set(t.auth(admin)).send({ planId: 'pro' });
    expect(plan.status).toBe(200);
    expect(plan.body.planId).toBe('pro');
    expect((await t.agent.get('/api/me').set(t.auth(owner))).body.plan.id).toBe('pro');

    const sus = await t.agent.patch(`/api/admin/users/${ownerUid}`).set(t.auth(admin)).send({ suspended: true });
    expect(sus.body.suspended).toBe(true);
    const blocked = await t.agent.get('/api/chatbots').set(t.auth(owner));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('account_suspended');

    await t.agent.patch(`/api/admin/users/${ownerUid}`).set(t.auth(admin)).send({ suspended: false });
    expect((await t.agent.get('/api/chatbots').set(t.auth(owner))).status).toBe(200);

    const log = await t.agent.get(`/api/admin/activity?uid=${ownerUid}`).set(t.auth(admin));
    const types = log.body.items.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['admin_plan_changed', 'admin_user_suspended', 'admin_user_restored']));
    expect(log.body.items.find((e: { type: string }) => e.type === 'admin_plan_changed')).toMatchObject({ actorEmail: ADMIN, detail: 'free → pro' });

    expect((await t.agent.patch(`/api/admin/users/${ownerUid}`).set(t.auth(admin)).send({})).status).toBe(400);
    expect((await t.agent.patch(`/api/admin/users/${ownerUid}`).set(t.auth(admin)).send({ planId: 'gold' })).status).toBe(400);
  });

  it('never lets the admin suspend or delete an admin account', async () => {
    const adminUid = (await t.agent.get('/api/me').set(t.auth(admin))).body.user.uid;
    expect((await t.agent.patch(`/api/admin/users/${adminUid}`).set(t.auth(admin)).send({ suspended: true })).status).toBe(409);
    expect((await t.agent.delete(`/api/admin/users/${adminUid}`).set(t.auth(admin))).status).toBe(409);
    expect((await t.agent.get('/api/admin/users/does-not-exist').set(t.auth(admin))).status).toBe(404);
  });

  it('deletes chatbots and accounts', async () => {
    const del = await t.agent.delete(`/api/admin/chatbots/${botId}`).set(t.auth(admin));
    expect(del.status).toBe(200);
    expect((await t.agent.get(`/api/chatbots/${botId}`).set(t.auth(owner))).status).toBe(404);

    const gone = await t.agent.delete(`/api/admin/users/${ownerUid}`).set(t.auth(admin));
    expect(gone.status).toBe(200);
    expect((await t.agent.get(`/api/admin/users/${ownerUid}`).set(t.auth(admin))).status).toBe(404);
    const log = await t.agent.get('/api/admin/activity?type=admin_user_deleted').set(t.auth(admin));
    expect(log.body.items[0]).toMatchObject({ email: 'owner@example.com', actorEmail: ADMIN });
  });
});

describe('admin console: demo tracking', () => {
  let t: TestApp;
  beforeAll(() => {
    t = makeTestApp();
  });
  afterAll(() => t.close());

  it('logs anonymous landing-page demo attempts with the website and IP', async () => {
    const demo = await t.agent.post('/api/public/demo').set('User-Agent', 'DemoVisitor/2.0').send({ url: 'https://unreachable-demo.example' });
    expect(demo.status).toBe(201);
    const admin = await t.login(ADMIN);
    const r = await t.agent.get('/api/admin/activity?type=demo_started').set(t.auth(admin));
    expect(r.body.items).toEqual([
      expect.objectContaining({ id: `demo_${demo.body.demoId}`, url: 'https://unreachable-demo.example/', userAgent: 'DemoVisitor/2.0', ip: expect.any(String) }),
    ]);
  });
});
