#!/usr/bin/env node
/**
 * ChatPilot AI — end-to-end API smoke test against a RUNNING API in dev mode
 * (AUTH_MODE=dev so POST /api/dev/login works; any DATA_STORE / AI_PROVIDER).
 *
 *   node scripts/smoke.mjs
 *
 * Env:
 *   API_URL                  default http://localhost:8787
 *   SITE_URL                 site to crawl, default https://example.com (needs internet)
 *   WEB_URL                  dashboard origin used as Origin for the landing-page demo, default http://localhost:5173
 *   SMOKE_MAX_PAGES          pages to crawl, default 5
 *   SMOKE_TIMEOUT_MS         crawl / demo poll timeout, default 90000
 *   SMOKE_REQUEST_TIMEOUT_MS per-request timeout, default 45000
 *   SMOKE_SKIP_DEMO=1        skip the public demo steps (e.g. when DEMO_ENABLED=false or the per-IP hourly limit is hit)
 *   SMOKE_VERBOSE=1          print every request/response
 *   FIREBASE_WEB_API_KEY     API in AUTH_MODE=firebase: create real Firebase users instead of /api/dev/login.
 *                            Also needs Admin credentials (FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL +
 *                            FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS) to create them and mint
 *                            custom tokens (owners sign in with Google; the API also accepts custom tokens).
 *
 * Prints a ✔/✘ table; exits 1 if any step fails (or is skipped because a prerequisite failed).
 * Uses unique emails per run, so it can be re-run against the same data store.
 */

const API = (process.env.API_URL || 'http://localhost:8787').replace(/\/+$/, '');
const SITE_URL = process.env.SITE_URL || 'https://example.com';
const WEB_URL = (process.env.WEB_URL || 'http://localhost:5173').replace(/\/+$/, '');
const MAX_PAGES = Number(process.env.SMOKE_MAX_PAGES || 5);
const POLL_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 90_000);
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_REQUEST_TIMEOUT_MS || 45_000);
const SKIP_DEMO = /^(1|true|yes)$/i.test(process.env.SMOKE_SKIP_DEMO || '');
const VERBOSE = /^(1|true|yes)$/i.test(process.env.SMOKE_VERBOSE || '');

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SITE_ORIGIN = (() => {
  try {
    return new URL(SITE_URL).origin;
  } catch {
    return SITE_URL;
  }
})();

const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const green = paint('32');
const red = paint('31');
const yellow = paint('33');
const gray = paint('90');
const bold = paint('1');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
class StepError extends Error {}

const truncate = (s, n = 160) => {
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (str === undefined) return '';
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

/** "404 not_found: Chatbot not found" from the API's `{ error: { code, message } }` shape. */
function describe(res) {
  const e = res.json?.error;
  if (e && typeof e === 'object') return `HTTP ${res.status} ${e.code ?? 'error'}: ${e.message ?? ''}`.trim();
  if (res.json !== undefined) return `HTTP ${res.status}: ${truncate(res.json)}`;
  return `HTTP ${res.status}: ${truncate(res.text || '(empty body)')}`;
}

/**
 * Signs in a test user. With FIREBASE_WEB_API_KEY set (API running AUTH_MODE=firebase) it creates a
 * real, email-verified Firebase user with firebase-admin and signs in with a custom token (the API
 * accepts Google and custom-token sign-ins only); otherwise it uses the dev login endpoint.
 */
async function loginUser(email) {
  const key = process.env.FIREBASE_WEB_API_KEY;
  if (!key) {
    const json = expectOk(await request('POST', '/api/dev/login', { body: { email } }));
    return { token: json?.token, uid: json?.uid, email: json?.email ?? email };
  }
  const auth = await firebaseAdminAuth();
  const user = await auth.createUser({ email, emailVerified: true, displayName: 'Smoke Test' });
  const customToken = await auth.createCustomToken(user.uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Firebase custom-token sign-in failed: ${json?.error?.message ?? res.status}`);
  return { token: json.idToken, uid: user.uid, email };
}

/**
 * firebase-admin Auth with the same credentials as the API: FIREBASE_PROJECT_ID +
 * FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS (service-account JSON).
 */
async function firebaseAdminAuth() {
  const { applicationDefault, cert, getApps, initializeApp } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { FIREBASE_PROJECT_ID: projectId, FIREBASE_CLIENT_EMAIL: clientEmail } = process.env;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!(projectId && clientEmail && privateKey) && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'Firebase mode needs Admin credentials: set FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or GOOGLE_APPLICATION_CREDENTIALS.',
    );
  }
  const app =
    getApps()[0] ??
    initializeApp({ credential: projectId && clientEmail && privateKey ? cert({ projectId, clientEmail, privateKey }) : applicationDefault(), projectId });
  return getAuth(app);
}

async function request(method, path, { token, body, origin, headers = {} } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  if (origin) h.Origin = origin;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const cause = err?.cause?.code || err?.cause?.message || err?.name;
    throw new StepError(`${method} ${path} → network error: ${err.message}${cause ? ` (${cause})` : ''}`);
  }
  const text = await res.text();
  let json;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
  }
  if (VERBOSE) console.log(gray(`  ${method} ${path} → ${res.status} ${truncate(text, 300)}`));
  return { status: res.status, ok: res.ok, headers: res.headers, text, json, method, path };
}

function expectOk(res, statuses = [200, 201, 202]) {
  if (!statuses.includes(res.status)) throw new StepError(`${res.method} ${res.path} → ${describe(res)}`);
  return res.json;
}

function check(cond, msg) {
  if (!cond) throw new StepError(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, isDone, { timeoutMs = POLL_TIMEOUT_MS, intervalMs = 1500, label = 'poll' } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (isDone(last)) return last;
    await sleep(intervalMs);
  }
  throw new StepError(`${label} timed out after ${Math.round(timeoutMs / 1000)}s (last: ${truncate(last, 200)})`);
}

const items = (json) => (Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []);

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------
const ctx = {};
const results = [];

/**
 * @param {string} name
 * @param {string[]} needs ctx keys required (step is skipped if any is missing)
 * @param {() => Promise<string|void>} fn returns a short detail string
 */
async function step(name, needs, fn) {
  const missing = needs.filter((k) => ctx[k] === undefined || ctx[k] === null);
  if (missing.length) {
    results.push({ name, status: 'skip', ms: 0, detail: `needs ${missing.join(', ')}` });
    printLive(results.at(-1));
    return;
  }
  const t0 = Date.now();
  try {
    const detail = (await fn()) || '';
    results.push({ name, status: 'pass', ms: Date.now() - t0, detail });
  } catch (err) {
    const detail = err instanceof StepError ? err.message : `${err?.stack || err}`;
    results.push({ name, status: 'fail', ms: Date.now() - t0, detail });
  }
  printLive(results.at(-1));
}

const ICON = { pass: green('✔'), fail: red('✘'), skip: yellow('–') };
function printLive(r) {
  const ms = r.status === 'skip' ? '' : gray(`${r.ms}ms`);
  console.log(`${ICON[r.status]} ${r.name} ${ms}${r.status !== 'pass' && r.detail ? `\n    ${r.status === 'fail' ? red(r.detail) : gray(r.detail)}` : ''}`);
}

function printTable() {
  const rows = results.map((r, i) => [String(i + 1), r.status, r.name, r.status === 'skip' ? '' : `${r.ms}`, truncate(r.detail, 110)]);
  const head = ['#', '', 'Step', 'ms', 'Detail'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (i === 1 ? 1 : r[i].length))));
  const line = (cols) => cols.map((c, i) => (i === 3 ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ');
  console.log('');
  console.log(bold(line(head)));
  console.log(gray(w.map((n) => '─'.repeat(n)).join('  ')));
  for (const r of rows) {
    const status = r[1];
    const cells = [...r];
    cells[1] = status === 'pass' ? '✔' : status === 'fail' ? '✘' : '–';
    let out = line(cells).trimEnd();
    const colorize = status === 'pass' ? (s) => s : status === 'fail' ? red : yellow;
    out = colorize(out);
    console.log(out);
  }
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const skip = results.filter((r) => r.status === 'skip').length;
  console.log('');
  const summary = `${pass} passed, ${fail} failed, ${skip} skipped — ${results.length} steps`;
  console.log(fail || skip ? red(bold(`SMOKE FAILED: ${summary}`)) : green(bold(`SMOKE PASSED: ${summary}`)));
  return fail + skip;
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------
async function main() {
  console.log(bold(`ChatPilot smoke test  API=${API}  SITE=${SITE_URL}  run=${RUN_ID}\n`));

  const NEW_COLOR = '#0EA5E9';
  const NEW_WELCOME = `Hello from the smoke test (${RUN_ID})`;
  const visitorId = `smoke-visitor-${RUN_ID}`;

  await step('GET /health', [], async () => {
    const res = await request('GET', '/health');
    const json = expectOk(res, [200]);
    ctx.up = true;
    return truncate(json ?? res.text, 80);
  });

  await step('Sign in (owner A)', ['up'], async () => {
    const email = `smoke-a-${RUN_ID}@example.com`;
    const json = await loginUser(email);
    check(typeof json?.token === 'string' && json.token.length > 10, `no token in response: ${truncate(json)}`);
    ctx.tokenA = json.token;
    ctx.uidA = json.uid;
    return `${json.email ?? email} uid=${json.uid}`;
  });

  await step('GET /api/me (owner A)', ['tokenA'], async () => {
    const json = expectOk(await request('GET', '/api/me', { token: ctx.tokenA }), [200]);
    check(json?.user?.uid || json?.user?.email, `unexpected body: ${truncate(json)}`);
    return `plan=${json?.plan?.id ?? '?'} messages used=${json?.usage?.messages ?? '?'}`;
  });

  await step('POST /api/chatbots (create)', ['tokenA'], async () => {
    const json = expectOk(
      await request('POST', '/api/chatbots', {
        token: ctx.tokenA,
        body: { websiteUrl: SITE_URL, businessName: 'Smoke Test Co', category: 'Testing' },
      }),
    );
    check(json?.id && json?.publicId, `chatbot missing id/publicId: ${truncate(json)}`);
    ctx.chatbotId = json.id;
    ctx.draftPublicId = json.publicId;
    return `id=${json.id} publicId=${json.publicId} status=${json.status}`;
  });

  await step('POST /api/chatbots/:id/crawl (start)', ['chatbotId'], async () => {
    const res = await request('POST', `/api/chatbots/${ctx.chatbotId}/crawl`, {
      token: ctx.tokenA,
      body: { url: SITE_URL, maxPages: MAX_PAGES },
    });
    if (res.status === 409) {
      // A crawl may already be running (e.g. auto-started on create) — use the latest job.
      const list = expectOk(await request('GET', `/api/chatbots/${ctx.chatbotId}/crawl-jobs`, { token: ctx.tokenA }), [200]);
      const job = items(list)[0];
      check(job?.id, `409 on start and no existing job: ${describe(res)}`);
      ctx.jobId = job.id;
      return `already running → job ${job.id} (${job.status})`;
    }
    const json = expectOk(res);
    check(json?.id, `no job id: ${truncate(json)}`);
    ctx.jobId = json.id;
    return `job=${json.id} status=${json.status} maxPages=${json.maxPages}`;
  });

  await step(`Poll crawl job until terminal (≤${Math.round(POLL_TIMEOUT_MS / 1000)}s)`, ['jobId'], async () => {
    const job = await poll(
      async () => expectOk(await request('GET', `/api/chatbots/${ctx.chatbotId}/crawl-jobs/${ctx.jobId}`, { token: ctx.tokenA }), [200]),
      (j) => ['completed', 'failed', 'cancelled'].includes(j?.status),
      { label: 'crawl' },
    );
    const s = job.stats ?? {};
    const summary = `status=${job.status} processed=${s.processed} skipped=${s.skipped} failed=${s.failed} discovered=${s.discovered}`;
    check(job.status === 'completed', `${summary}${job.error ? ` error="${job.error}"` : ''}${job.hint ? ` hint="${job.hint}"` : ''}`);
    ctx.crawled = true;
    return summary;
  });

  await step('GET /api/chatbots/:id/sources', ['crawled'], async () => {
    const json = expectOk(await request('GET', `/api/chatbots/${ctx.chatbotId}/sources`, { token: ctx.tokenA }), [200]);
    const list = items(json);
    check(list.length >= 1, `expected ≥1 source after crawl, got ${list.length}`);
    return `${list.length} source(s): ${truncate(list.map((s) => s.title || s.url).join(' | '), 80)}`;
  });

  await step('PUT /api/chatbots/:id/config (colour, welcome, leadCapture)', ['chatbotId'], async () => {
    const bot = expectOk(await request('GET', `/api/chatbots/${ctx.chatbotId}`, { token: ctx.tokenA }), [200]);
    const cfg = bot?.config ?? {};
    const next = {
      ...cfg,
      primaryColor: NEW_COLOR,
      welcomeMessage: NEW_WELCOME,
      leadCapture: {
        ...(cfg.leadCapture ?? {}),
        enabled: true,
        trigger: 'after_messages',
        afterMessages: 1,
        fields: { ...(cfg.leadCapture?.fields ?? {}), name: true, email: true },
      },
      contact: { ...(cfg.contact ?? {}), email: 'owner@example.com' },
    };
    const json = expectOk(await request('PUT', `/api/chatbots/${ctx.chatbotId}/config`, { token: ctx.tokenA, body: next }), [200]);
    const saved = json?.config ?? {};
    check(saved.primaryColor?.toLowerCase() === NEW_COLOR.toLowerCase(), `primaryColor not saved: ${saved.primaryColor}`);
    check(saved.welcomeMessage === NEW_WELCOME, `welcomeMessage not saved: ${saved.welcomeMessage}`);
    check(saved.leadCapture?.enabled === true && saved.leadCapture?.fields?.email === true, `leadCapture not saved: ${truncate(saved.leadCapture)}`);
    ctx.configured = true;
    return `primaryColor=${saved.primaryColor} leadCapture.enabled=${saved.leadCapture.enabled}`;
  });

  await step('POST /api/chatbots/:id/preview/messages', ['chatbotId'], async () => {
    const json = expectOk(
      await request('POST', `/api/chatbots/${ctx.chatbotId}/preview/messages`, {
        token: ctx.tokenA,
        body: { message: 'What is this website about?', history: [] },
      }),
      [200],
    );
    const content = json?.message?.content;
    check(typeof content === 'string' && content.trim().length > 0, `empty preview reply: ${truncate(json)}`);
    return `${json.message.fallback ? '[fallback] ' : ''}"${truncate(content, 70)}" retrieved=${json.retrieved?.length ?? 0}`;
  });

  await step('POST /api/chatbots/:id/publish', ['configured'], async () => {
    const json = expectOk(await request('POST', `/api/chatbots/${ctx.chatbotId}/publish`, { token: ctx.tokenA }), [200, 201]);
    check(json?.publicId, `no publicId: ${truncate(json)}`);
    check(typeof json.embedCode === 'string' && json.embedCode.includes(json.publicId), `embedCode does not reference publicId: ${truncate(json.embedCode)}`);
    ctx.publicId = json.publicId;
    return `version=${json.version} publicId=${json.publicId} widgetUrl=${json.widgetUrl}`;
  });

  await step('GET /api/public/chatbots/:publicId/config', ['publicId'], async () => {
    const json = expectOk(await request('GET', `/api/public/chatbots/${ctx.publicId}/config`, { origin: SITE_ORIGIN }), [200]);
    check(json?.mode === 'published', `mode=${json?.mode} (expected published)`);
    check(json?.config?.primaryColor?.toLowerCase() === NEW_COLOR.toLowerCase(), `published primaryColor=${json?.config?.primaryColor}`);
    check(json?.config?.welcomeMessage === NEW_WELCOME, `published welcomeMessage=${truncate(json?.config?.welcomeMessage)}`);
    check(json?.config?.leadCapture?.enabled === true, 'published leadCapture.enabled !== true');
    return `v${json.version} ${json.businessName} colour=${json.config.primaryColor}`;
  });

  await step('GET /widget.js', ['up'], async () => {
    const res = await request('GET', '/widget.js', { headers: { Accept: '*/*' } });
    check(res.status === 200, `GET /widget.js → ${describe(res)}`);
    const ct = res.headers.get('content-type') || '';
    check(/javascript|ecmascript/i.test(ct), `content-type is "${ct}" (expected JavaScript)`);
    check(res.text.length > 200, `suspiciously small bundle (${res.text.length} bytes)`);
    return `${(res.text.length / 1024).toFixed(1)} KB, ${ct}`;
  });

  await step('POST public message #1 (new conversation)', ['publicId'], async () => {
    const json = expectOk(
      await request('POST', `/api/public/chatbots/${ctx.publicId}/messages`, {
        origin: SITE_ORIGIN,
        body: { message: 'Hi! What does this business do?', visitorId, channel: 'widget', pageUrl: SITE_URL },
      }),
      [200, 201],
    );
    check(json?.conversationId && json?.conversationToken, `missing conversationId/token: ${truncate(json)}`);
    check(json?.message?.role === 'assistant' && json.message.content?.trim(), `bad assistant message: ${truncate(json?.message)}`);
    ctx.conversationId = json.conversationId;
    ctx.conversationToken = json.conversationToken;
    return `conv=${json.conversationId} showLeadForm=${json.showLeadForm ?? false} "${truncate(json.message.content, 50)}"`;
  });

  await step('POST public message #2 (with conversationToken)', ['conversationToken'], async () => {
    const json = expectOk(
      await request('POST', `/api/public/chatbots/${ctx.publicId}/messages`, {
        origin: SITE_ORIGIN,
        body: {
          message: 'How can I contact you?',
          visitorId,
          channel: 'widget',
          pageUrl: SITE_URL,
          conversationId: ctx.conversationId,
          conversationToken: ctx.conversationToken,
        },
      }),
      [200, 201],
    );
    check(json?.conversationId === ctx.conversationId, `conversation changed: ${json?.conversationId} != ${ctx.conversationId}`);
    check(json?.message?.content?.trim(), 'empty assistant message');
    return `same conversation ✓ showLeadForm=${json.showLeadForm ?? false}`;
  });

  await step('Forged conversationToken is not accepted', ['conversationToken'], async () => {
    const res = await request('POST', `/api/public/chatbots/${ctx.publicId}/messages`, {
      origin: SITE_ORIGIN,
      body: { message: 'Am I in?', visitorId, channel: 'widget', conversationId: ctx.conversationId, conversationToken: 'forged-token-123' },
    });
    if (res.status === 429) throw new StepError(`rate limited: ${describe(res)}`);
    if (res.status >= 400 && res.status < 500) return `rejected → ${describe(res)}`;
    const json = expectOk(res, [200, 201]);
    check(json?.conversationId && json.conversationId !== ctx.conversationId, `forged token appended to conversation ${ctx.conversationId}!`);
    return `started a new conversation instead (${json.conversationId})`;
  });

  await step('POST /api/public/chatbots/:publicId/leads', ['conversationToken'], async () => {
    const json = expectOk(
      await request('POST', `/api/public/chatbots/${ctx.publicId}/leads`, {
        origin: SITE_ORIGIN,
        body: {
          conversationId: ctx.conversationId,
          conversationToken: ctx.conversationToken,
          visitorId,
          name: 'Smoke Tester',
          email: `lead-${RUN_ID}@example.com`,
          message: 'Please call me back',
          consent: true,
          pageUrl: SITE_URL,
        },
      }),
      [200, 201],
    );
    check(json?.ok === true && json?.leadId, `unexpected body: ${truncate(json)}`);
    ctx.leadId = json.leadId;
    return `leadId=${json.leadId}`;
  });

  await step('GET /api/conversations?chatbotId= (owner)', ['conversationId'], async () => {
    const json = expectOk(await request('GET', `/api/conversations?chatbotId=${encodeURIComponent(ctx.chatbotId)}`, { token: ctx.tokenA }), [200]);
    const conv = items(json).find((c) => c.id === ctx.conversationId);
    check(conv, `conversation ${ctx.conversationId} not in list (${items(json).length} items)`);
    return `${items(json).length} conversation(s); messageCount=${conv.messageCount} hasLead=${conv.hasLead}`;
  });

  await step('GET /api/conversations/:id (owner)', ['conversationId'], async () => {
    const json = expectOk(await request('GET', `/api/conversations/${ctx.conversationId}`, { token: ctx.tokenA }), [200]);
    const msgs = Array.isArray(json?.messages) ? json.messages : [];
    check(msgs.length >= 4, `expected ≥4 messages (2 user + 2 assistant), got ${msgs.length}`);
    return `${msgs.length} messages`;
  });

  await step('GET /api/leads?chatbotId= (owner)', ['leadId'], async () => {
    const json = expectOk(await request('GET', `/api/leads?chatbotId=${encodeURIComponent(ctx.chatbotId)}`, { token: ctx.tokenA }), [200]);
    const lead = items(json).find((l) => l.id === ctx.leadId);
    check(lead, `lead ${ctx.leadId} not in list (${items(json).length} items)`);
    check(lead.email === `lead-${RUN_ID}@example.com`, `lead email mismatch: ${lead.email}`);
    return `${items(json).length} lead(s); ${lead.email}`;
  });

  await step('Sign in (user B)', ['up'], async () => {
    const json = await loginUser(`smoke-b-${RUN_ID}@example.com`);
    check(typeof json?.token === 'string', `no token: ${truncate(json)}`);
    check(json.uid !== ctx.uidA, 'user B got the same uid as user A');
    ctx.tokenB = json.token;
    return `uid=${json.uid}`;
  });

  await step("Tenant isolation: B GET A's chatbot → 404", ['tokenB', 'chatbotId'], async () => {
    const res = await request('GET', `/api/chatbots/${ctx.chatbotId}`, { token: ctx.tokenB });
    check(res.status === 404, `expected 404, got ${describe(res)}`);
    return describe(res);
  });

  await step("Tenant isolation: B cannot read A's sources/conversations/leads", ['tokenB', 'chatbotId'], async () => {
    const notes = [];
    const src = await request('GET', `/api/chatbots/${ctx.chatbotId}/sources`, { token: ctx.tokenB });
    check(src.status === 404 || src.status === 403, `sources: expected 404, got ${describe(src)}`);
    notes.push(`sources ${src.status}`);
    if (ctx.conversationId) {
      const conv = await request('GET', `/api/conversations/${ctx.conversationId}`, { token: ctx.tokenB });
      check(conv.status === 404 || conv.status === 403, `conversation: expected 404, got ${describe(conv)}`);
      notes.push(`conversation ${conv.status}`);
    }
    const leads = await request('GET', `/api/leads?chatbotId=${encodeURIComponent(ctx.chatbotId)}`, { token: ctx.tokenB });
    if (leads.ok) check(items(leads.json).length === 0, `leads list leaked ${items(leads.json).length} item(s) to user B`);
    else check([403, 404].includes(leads.status), `leads: unexpected ${describe(leads)}`);
    notes.push(`leads ${leads.ok ? 'empty' : leads.status}`);
    const del = await request('DELETE', `/api/chatbots/${ctx.chatbotId}`, { token: ctx.tokenB });
    check(del.status === 404 || del.status === 403, `DELETE by B: expected 404, got ${describe(del)}`);
    notes.push(`delete ${del.status}`);
    return notes.join(', ');
  });

  if (SKIP_DEMO) {
    results.push({ name: 'Public demo (skipped via SMOKE_SKIP_DEMO)', status: 'pass', ms: 0, detail: 'skipped by request' });
    printLive(results.at(-1));
  } else {
    await step('POST /api/public/demo', ['up'], async () => {
      const json = expectOk(await request('POST', '/api/public/demo', { origin: WEB_URL, body: { url: SITE_URL } }), [200, 201, 202]);
      check(json?.demoId, `no demoId: ${truncate(json)}`);
      ctx.demoId = json.demoId;
      ctx.demoPublicId = json.publicId;
      return `demoId=${json.demoId} status=${json.status} publicId=${json.publicId}`;
    });

    await step(`Poll GET /api/public/demo/:demoId (≤${Math.round(POLL_TIMEOUT_MS / 1000)}s)`, ['demoId'], async () => {
      const demo = await poll(
        async () => expectOk(await request('GET', `/api/public/demo/${ctx.demoId}`, { origin: WEB_URL }), [200]),
        (d) => d?.status === 'ready' || d?.status === 'failed',
        { label: 'demo' },
      );
      check(demo.status === 'ready', `status=${demo.status}${demo.error ? ` error="${demo.error}"` : ''}`);
      ctx.demoPublicId = demo.publicId || ctx.demoPublicId;
      ctx.demoReady = true;
      return `ready, pagesProcessed=${demo.pagesProcessed} title="${truncate(demo.siteMeta?.title ?? '', 40)}"`;
    });

    await step('POST demo message', ['demoReady', 'demoPublicId'], async () => {
      const json = expectOk(
        await request('POST', `/api/public/chatbots/${ctx.demoPublicId}/messages`, {
          origin: WEB_URL,
          body: { message: 'What is this site about?', visitorId: `${visitorId}-demo`, channel: 'demo', pageUrl: WEB_URL },
        }),
        [200, 201],
      );
      check(json?.message?.content?.trim(), `empty demo reply: ${truncate(json)}`);
      return `"${truncate(json.message.content, 70)}"`;
    });
  }

  const bad = printTable();
  if (!ctx.up) console.log(yellow(`\nIs the API running at ${API}? Start the stack with: node scripts/dev.mjs`));
  process.exit(bad ? 1 : 0);
}

main().catch((err) => {
  console.error(red(err?.stack || String(err)));
  process.exit(1);
});
