import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../src/index';
import { validateLead } from '../src/leadForm';
import type { Widget } from '../src/widget';
import {
  $,
  $$,
  API,
  apiError,
  botBubbles,
  config,
  json,
  mockApi,
  mountFloating,
  publicConfig,
  reply,
  runtime,
  shadowOf,
  tick,
  typeAndSend,
  until,
  userBubbles,
} from './helpers';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  runtime()
    .instances()
    .forEach((i) => i.destroy());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function addScript(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script');
  s.setAttribute('src', 'http://localhost:8787/widget.js');
  for (const k in attrs) s.setAttribute(k, attrs[k]);
  document.body.append(s);
  return s;
}

describe('auto-init from <script>', () => {
  it('reads data attributes and fetches the config', async () => {
    const api = mockApi({});
    const s = addScript({ 'data-chatbot-id': 'cb_test', 'data-api-url': API, 'data-position': 'left' });
    const w = runtime()._autoInit(s) as Widget;
    expect(await w.ready).toBe(true);
    expect(api.calls[0].url).toBe(`${API}/api/public/chatbots/cb_test/config`);
    const root = $('.root')!;
    expect(root.classList.contains('left')).toBe(true);
    expect(root.classList.contains('open')).toBe(false);
    expect($('.title')!.textContent).toBe('Bright Smile Dental');
  });

  it('uses __DEFAULT_API_URL__ without data-api-url and honours data-open / data-preview-token', async () => {
    const api = mockApi({ config: () => json(200, publicConfig({}, 'draft')) });
    const s = addScript({ 'data-chatbot-id': 'cb_test', 'data-open': 'true', 'data-preview-token': 'ptok' });
    const w = runtime()._autoInit(s) as Widget;
    await w.ready;
    expect(api.calls[0].url).toBe('http://api.test/api/public/chatbots/cb_test/config?previewToken=ptok');
    expect($('.root')!.classList.contains('open')).toBe(true);
    expect($('.badge')!.textContent).toBe('Preview (draft)');
  });

  it('picks up ?chatpilot_preview=TOKEN from the page URL', async () => {
    history.replaceState(null, '', '/?chatpilot_preview=urltok');
    const api = mockApi({ config: () => json(200, publicConfig({}, 'draft')) });
    const s = addScript({ 'data-chatbot-id': 'cb_test' });
    await (runtime()._autoInit(s) as Widget).ready;
    expect(api.calls[0].url).toContain('previewToken=urltok');
  });

  it('boot() falls back to querying the script tag and ignores duplicate tags', async () => {
    const api = mockApi({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    addScript({ 'data-chatbot-id': 'cb_test', 'data-api-url': API });
    addScript({ 'data-chatbot-id': 'cb_test', 'data-api-url': API });
    boot(); // simulates the first copy of widget.js executing
    boot(); // ...and the second copy
    await until(() => document.querySelector('chatpilot-widget'));
    await tick(10);
    expect(document.querySelectorAll('chatpilot-widget')).toHaveLength(1);
    expect(runtime().instances()).toHaveLength(1);
    expect(api.calls.filter((c) => c.url.endsWith('/config'))).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already mounted'));
  });

  it('does not auto-mount from a manual loader tag (no data-chatbot-id)', async () => {
    const api = mockApi({});
    const s = addScript({ 'data-chatpilot-loader': '', 'data-chatpilot-manual': '' });
    expect(runtime()._autoInit(s)).toBeNull();
    boot();
    await tick(10);
    expect(document.querySelector('chatpilot-widget')).toBeNull();
    expect(api.fn).not.toHaveBeenCalled();
  });

  it('finds tag-manager style tags (no "widget" in src) via script[data-chatbot-id]', async () => {
    mockApi({});
    const s = document.createElement('script');
    s.setAttribute('src', 'https://cdn.example.com/cp.js');
    s.setAttribute('data-chatbot-id', 'cb_test');
    s.setAttribute('data-api-url', API);
    document.body.append(s);
    boot();
    await until(() => document.querySelector('chatpilot-widget'));
  });

  it('a second mount() for the same bot+target returns the existing instance', async () => {
    mockApi({});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = await mountFloating();
    const b = runtime().mount({ apiUrl: API, publicId: 'cb_test' });
    expect(b).toBe(a);
  });

  it('renders nothing when the chatbot is not published', async () => {
    mockApi({ config: () => apiError(403, 'not_published', 'Not published') });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const w = runtime().mount({ apiUrl: API, publicId: 'cb_test' }) as Widget;
    expect(await w.ready).toBe(false);
    expect(document.querySelector('chatpilot-widget')).toBeNull();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('not published'));
    expect(runtime().instances()).toHaveLength(0);
  });

  it('renders nothing and warns on origin_not_allowed', async () => {
    mockApi({ config: () => apiError(403, 'origin_not_allowed') });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = runtime().mount({ apiUrl: API, publicId: 'cb_test' }) as Widget;
    expect(await w.ready).toBe(false);
    expect(document.querySelector('chatpilot-widget')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not an allowed website'));
  });

  it('never throws into the host page on bad input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => runtime().mount(undefined as never)).not.toThrow();
    expect(() => runtime().mount({ apiUrl: API })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe('open / close / keyboard', () => {
  it('toggles with the launcher, updates aria-expanded, Esc closes and returns focus', async () => {
    mockApi({});
    const w = await mountFloating();
    const launcher = $<HTMLButtonElement>('.launcher')!;
    const panel = $('.panel')!;
    expect(launcher.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect($('.log')!.getAttribute('role')).toBe('log');
    expect($('.log')!.getAttribute('aria-live')).toBe('polite');
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect($('.root')!.classList.contains('unread')).toBe(true);

    launcher.click();
    expect(w.isOpen).toBe(true);
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    expect($('.root')!.classList.contains('open')).toBe(true);
    expect($('.root')!.classList.contains('unread')).toBe(false);
    await until(() => shadowOf().activeElement === $('textarea.input'));

    $('textarea.input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(w.isOpen).toBe(false);
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(shadowOf().activeElement).toBe(launcher);

    w.toggle();
    expect(w.isOpen).toBe(true);
    w.close();
    expect(w.isOpen).toBe(false);
  });

  it('open() before the config has loaded opens once ready', async () => {
    mockApi({});
    const w = runtime().mount({ apiUrl: API, publicId: 'cb_test' }) as Widget;
    w.open();
    await w.ready;
    expect(w.isOpen).toBe(true);
  });

  it('applies the mobile layout with forceMobile and locks page scroll only for real mobile', async () => {
    mockApi({});
    const w = await mountFloating({ forceMobile: true });
    expect($('.root')!.classList.contains('mobile')).toBe(true);
    w.open();
    expect(document.documentElement.style.overflow).toBe('hidden');
    w.close();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('full-screen mobile panel is aria-modal and traps focus; desktop is not modal', async () => {
    mockApi({});
    let w = await mountFloating();
    expect($('.panel')!.hasAttribute('aria-modal')).toBe(false);
    w.destroy();

    w = await mountFloating({ forceMobile: true });
    const panel = $('.panel')!;
    expect(panel.getAttribute('aria-modal')).toBe('true');
    w.open();
    const focusables = $$<HTMLElement>('.panel button, .panel textarea, .panel a[href], .panel [tabindex="0"]').filter(
      (el) => !(el as HTMLButtonElement).disabled && !el.closest('[hidden]'),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(shadowOf().activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(shadowOf().activeElement).toBe(last);
  });

  it('a mobile panel inside a container is not modal', async () => {
    mockApi({});
    const box = document.createElement('div');
    document.body.append(box);
    await mountFloating({ container: box, forceMobile: true });
    expect($('.panel', shadowOf(box.querySelector('chatpilot-widget')))!.hasAttribute('aria-modal')).toBe(false);
  });

  it('positions inside a container (contained mode) without locking page scroll', async () => {
    mockApi({});
    const box = document.createElement('div');
    document.body.append(box);
    const w = await mountFloating({ container: box, forceMobile: true });
    expect(box.querySelector('chatpilot-widget')).not.toBeNull();
    expect(box.style.position).toBe('relative');
    expect($('.root', shadowOf(box.querySelector('chatpilot-widget')))!.classList.contains('contained')).toBe(true);
    // the host never covers the container (pointer events pass through to e.g. a site iframe below)
    const host = box.querySelector('chatpilot-widget') as HTMLElement;
    expect(host.style.pointerEvents).toBe('none');
    expect(host.style.width).toBe('0px');
    w.open();
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('messaging', () => {
  it('posts the right body and renders the reply with sources', async () => {
    history.replaceState(null, '', '/services/whitening?utm_source=x#top');
    const api = mockApi({
      messages: () =>
        reply('We offer **teeth whitening** from $199.', {}, {
          sources: [
            { url: 'https://brightsmile.example/whitening', title: 'Whitening' },
            { url: 'javascript:alert(1)', title: 'Evil' },
          ],
        }),
    });
    const w = await mountFloating();
    w.open();
    typeAndSend('  Do you do whitening?  ');
    await until(() => botBubbles().length === 2);
    const [post] = api.posts('/messages');
    expect(post.url).toBe(`${API}/api/public/chatbots/cb_test/messages`);
    expect(post.body).toMatchObject({
      message: 'Do you do whitening?',
      channel: 'widget',
      pageUrl: 'http://localhost:3000/services/whitening',
    });
    expect(post.body.visitorId).toMatch(/^v_.{8,}/);
    expect(post.body.conversationId).toBeUndefined();
    expect(userBubbles()).toEqual(['Do you do whitening?']);
    expect($$('[data-testid=message-user]')).toHaveLength(1);
    expect($$('[data-testid=message-assistant]')).toHaveLength(2); // welcome + reply
    expect($$('[data-testid=message-assistant][data-welcome=true]')).toHaveLength(1);
    expect(botBubbles()[1]).toBe('We offer teeth whitening from $199.');
    expect($('.msg.bot:last-of-type strong')!.textContent).toBe('teeth whitening');
    const chips = $$<HTMLAnchorElement>('.src');
    expect(chips).toHaveLength(1);
    expect(chips[0].href).toBe('https://brightsmile.example/whitening');
    expect(chips[0].target).toBe('_blank');
    expect(chips[0].rel).toBe('noopener noreferrer nofollow');
    expect(chips[0].textContent).toBe('Source: Whitening');
    expect($('textarea.input')!.getAttribute('maxlength')).toBe('2000');
  });

  it('shows suggested questions until the first message and sends them on click', async () => {
    const api = mockApi({
      config: () => json(200, publicConfig({ suggestedQuestions: ['Opening hours?', 'Do you take insurance?'] })),
      messages: () => reply('9am to 6pm.'),
    });
    await mountFloating();
    const chips = $$<HTMLButtonElement>('.suggest .chip');
    expect(chips.map((c) => c.textContent)).toEqual(['Opening hours?', 'Do you take insurance?']);
    chips[0].click();
    await until(() => botBubbles().length === 2);
    expect(api.posts('/messages')[0].body.message).toBe('Opening hours?');
    expect($('.suggest')).toBeNull();
  });

  it('persists conversationId/token and reuses them (also after re-mount)', async () => {
    const api = mockApi({ messages: (_c, n) => reply(`Answer ${n}`) });
    let w = await mountFloating();
    typeAndSend('first');
    await until(() => botBubbles().length === 2);
    const stored = JSON.parse(localStorage.getItem('chatpilot:cb_test')!);
    expect(stored).toMatchObject({ conversationId: 'conv_1', conversationToken: 'tok_1' });
    expect(stored.messages).toHaveLength(2);

    typeAndSend('second');
    await until(() => botBubbles().length === 3);
    expect(api.posts('/messages')[1].body).toMatchObject({ conversationId: 'conv_1', conversationToken: 'tok_1' });
    const visitorId = api.posts('/messages')[0].body.visitorId;
    expect(api.posts('/messages')[1].body.visitorId).toBe(visitorId);

    w.destroy();
    w = await mountFloating();
    expect(userBubbles()).toEqual(['first', 'second']);
    expect(botBubbles()).toEqual(['Hi! \u{1F44B} How can I help you today?', 'Answer 1', 'Answer 2']);
    typeAndSend('third');
    await until(() => botBubbles().length === 4);
    expect(api.posts('/messages')[2].body).toMatchObject({ conversationId: 'conv_1', conversationToken: 'tok_1', visitorId });
  });

  it('starts a fresh conversation when the stored one is rejected', async () => {
    localStorage.setItem(
      'chatpilot:cb_test',
      JSON.stringify({ visitorId: 'v_abcdefgh', conversationId: 'old', conversationToken: 'bad' }),
    );
    const api = mockApi({
      messages: (c) => (c.body.conversationId ? apiError(403, 'forbidden') : reply('Fresh start')),
    });
    await mountFloating();
    typeAndSend('hello');
    await until(() => botBubbles().length === 2);
    expect(api.posts('/messages')).toHaveLength(2);
    expect(api.posts('/messages')[1].body.conversationId).toBeUndefined();
    expect(userBubbles()).toEqual(['hello']);
  });

  it('renders malicious content inert', async () => {
    mockApi({
      messages: () => reply('<img src=x onerror=alert(1)> [win](javascript:alert(1)) **ok** https://safe.example'),
    });
    await mountFloating();
    typeAndSend('<script>alert("user")</script>');
    await until(() => botBubbles().length === 2);
    const root = shadowOf();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    const hrefs = $$<HTMLAnchorElement>('.log a').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://safe.example/']);
    expect(hrefs.some((h) => /javascript/i.test(h || ''))).toBe(false);
    expect(userBubbles()).toEqual(['<script>alert("user")</script>']);
    expect(botBubbles()[1]).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows an inline error with Retry after a network failure and re-sends the last message', async () => {
    let fail = true;
    const api = mockApi({
      messages: () => {
        if (fail) throw new TypeError('Failed to fetch');
        return reply('Back online!');
      },
    });
    await mountFloating();
    typeAndSend('Are you open Sunday?');
    const retry = (await until(() => $<HTMLButtonElement>('.err .retry')))!;
    expect($('.err')!.textContent).toContain('Message not delivered');
    expect(api.posts('/messages')).toHaveLength(2); // 1 attempt + 1 automatic retry
    fail = false;
    retry.click();
    await until(() => botBubbles().length === 2);
    expect(botBubbles()[1]).toBe('Back online!');
    expect($('.err')).toBeNull();
    expect(userBubbles()).toEqual(['Are you open Sunday?']);
    expect(api.posts('/messages').at(-1)!.body.message).toBe('Are you open Sunday?');
  });

  it('handles rate limiting by disabling the composer briefly', async () => {
    mockApi({ messages: () => apiError(429, 'rate_limited') });
    await mountFloating();
    typeAndSend('hi');
    await until(() => $('.note'));
    expect($('.note')!.textContent).toContain('too quickly');
    expect($<HTMLTextAreaElement>('textarea.input')!.disabled).toBe(true);
  });

  it('shows a friendly notice with contact actions on quota_exceeded', async () => {
    mockApi({
      config: () => json(200, publicConfig({ contact: { email: 'hi@brightsmile.example', phone: '+1 (555) 010-2000', whatsapp: '+1 555 010 2000' } })),
      messages: () => apiError(402, 'quota_exceeded'),
    });
    await mountFloating();
    typeAndSend('hi');
    await until(() => $('.note'));
    expect($('.note')!.textContent).toContain('Bright Smile Dental');
    expect($$<HTMLAnchorElement>('.act').map((a) => a.getAttribute('href'))).toEqual([
      'mailto:hi@brightsmile.example',
      'tel:+15550102000',
      'https://wa.me/15550102000',
    ]);
  });

  it('shows contact actions under fallback replies', async () => {
    mockApi({
      config: () => json(200, publicConfig({ contact: { phone: '555 0100' } })),
      messages: () => reply("I'm not sure.", {}, { fallback: true }),
    });
    await mountFloating();
    typeAndSend('obscure question');
    await until(() => botBubbles().length === 2);
    expect($<HTMLAnchorElement>('.msg.bot .act')!.getAttribute('href')).toBe('tel:5550100');
  });

  it('hides the widget when a message is rejected for origin_not_allowed', async () => {
    mockApi({ messages: () => apiError(403, 'origin_not_allowed') });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountFloating();
    typeAndSend('hi');
    await until(() => !document.querySelector('chatpilot-widget'));
    expect(runtime().instances()).toHaveLength(0);
  });

  it('reset() clears the conversation and storage but keeps the visitor id', async () => {
    mockApi({ messages: () => reply('ok') });
    const w = await mountFloating();
    typeAndSend('hi');
    await until(() => botBubbles().length === 2);
    const before = JSON.parse(localStorage.getItem('chatpilot:cb_test')!);
    w.reset();
    const after = JSON.parse(localStorage.getItem('chatpilot:cb_test')!);
    expect(after.conversationId).toBeUndefined();
    expect(after.messages).toEqual([]);
    expect(after.visitorId).toBe(before.visitorId);
    expect(userBubbles()).toEqual([]);
    expect(botBubbles()).toHaveLength(1); // welcome only
  });
});

describe('lead capture', () => {
  const leadCfg = (trigger: 'start' | 'after_messages' | 'manual' = 'start') =>
    publicConfig({
      leadCapture: {
        enabled: true,
        title: 'Book a free consultation',
        trigger,
        afterMessages: 1,
        fields: { name: true, email: true, phone: true, message: false },
        consentText: 'I agree to be contacted.',
      },
    });

  it('validateLead enforces email/phone format, one of email|phone, and consent', () => {
    const f = { name: true, email: true, phone: true, message: false };
    expect(validateLead({ consent: false }, f)).toEqual({
      email: 'Please enter your email or phone number.',
      consent: expect.any(String),
    });
    expect(validateLead({ email: 'nope', consent: true }, f).email).toBeTruthy();
    expect(validateLead({ phone: 'call me', consent: true }, f).phone).toBeTruthy();
    expect(validateLead({ phone: '+1 (555) 010-2000', consent: true }, f)).toEqual({});
    expect(validateLead({ email: 'a@b.co', consent: true }, f)).toEqual({});
    expect(validateLead({ consent: true }, { name: true, email: false, phone: false, message: true })).toEqual({});
  });

  it('validates client-side, submits, shows success and never shows again', async () => {
    const api = mockApi({ config: () => json(200, leadCfg('start')) });
    let w = await mountFloating();
    const form = $<HTMLFormElement>('form.lead')!;
    expect(form.textContent).toContain('Book a free consultation');
    const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    submit();
    expect($('#' + $('input[name=email]')!.id + '-err')!.textContent).toContain('email or phone');
    expect($('input[name=email]')!.getAttribute('aria-invalid')).toBe('true');
    expect(api.posts('/leads')).toHaveLength(0);

    ($('input[name=name]') as HTMLInputElement).value = 'Ana';
    ($('input[name=email]') as HTMLInputElement).value = 'ana@';
    submit();
    expect($('input[name=email]')!.getAttribute('aria-invalid')).toBe('true');

    ($('input[name=email]') as HTMLInputElement).value = 'ana@example.com';
    submit();
    expect($('input[name=consent]')!.getAttribute('aria-invalid')).toBe('true');
    expect(api.posts('/leads')).toHaveLength(0);

    ($('input[name=consent]') as HTMLInputElement).checked = true;
    submit();
    await until(() => $('.lead-ok'));
    expect($('.lead-ok')!.textContent).toBe("Thanks! We'll be in touch.");
    const [post] = api.posts('/leads');
    expect(post.url).toBe(`${API}/api/public/chatbots/cb_test/leads`);
    expect(post.body).toMatchObject({ name: 'Ana', email: 'ana@example.com', consent: true });
    expect(post.body.visitorId).toMatch(/^v_/);
    expect(post.body.phone).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('chatpilot:cb_test')!).leadSubmitted).toBe(true);

    w.destroy();
    w = await mountFloating();
    expect($('form.lead')).toBeNull();
  });

  it('maps server-side field errors onto the form', async () => {
    mockApi({
      config: () => json(200, leadCfg('start')),
      leads: () => apiError(400, 'validation_error', 'Invalid', { fieldErrors: { email: ['Invalid email'] } }),
    });
    await mountFloating();
    ($('input[name=email]') as HTMLInputElement).value = 'ana@example.com';
    ($('input[name=consent]') as HTMLInputElement).checked = true;
    $<HTMLFormElement>('form.lead')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => $('input[name=email]')!.getAttribute('aria-invalid') === 'true');
    expect($('#' + $('input[name=email]')!.id + '-err')!.textContent).toBe('Invalid email');
  });

  it("shows the form when the API reply says showLeadForm ('after_messages')", async () => {
    mockApi({ config: () => json(200, leadCfg('after_messages')), messages: () => reply('Sure!', { showLeadForm: true }) });
    await mountFloating();
    expect($('form.lead')).toBeNull();
    typeAndSend('I want braces');
    await until(() => $('form.lead'));
  });

  it("'manual' trigger: Contact us menu item opens the form", async () => {
    mockApi({ config: () => json(200, leadCfg('manual')) });
    await mountFloating();
    expect($('form.lead')).toBeNull();
    const menuBtn = $<HTMLButtonElement>('[aria-haspopup=menu]')!;
    menuBtn.click();
    expect(menuBtn.getAttribute('aria-expanded')).toBe('true');
    const contact = $$<HTMLButtonElement>('.menu button').find((b) => b.textContent === 'Contact us')!;
    contact.click();
    expect($('form.lead')).not.toBeNull();
    expect($('.menu')!.hidden).toBe(true);
  });
});

describe('preview mode', () => {
  it('shows follow-up suggestions under the latest reply; tapping one sends it', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const box = document.createElement('div');
    document.body.append(box);
    const sendPreview = vi.fn(async (message: string) => ({
      content: `Echo: ${message}`,
      suggestions:
        message === 'hello'
          ? ['  What are your prices? ', 'what are your prices?', 'Do you offer refunds?', 'Where are you?', 'One too many']
          : ['<img src=x onerror=alert(1)>'],
    }));
    const w = runtime().mount({ apiUrl: API, mode: 'preview', container: box, open: true, config: config(), businessName: 'B', sendPreview }) as Widget;
    await w.ready;
    const root = shadowOf(box.querySelector('chatpilot-widget'));

    typeAndSend('hello', root);
    await until(() => botBubbles(root).length === 2);
    const chips = () => Array.from(root.querySelectorAll('.followups .chip')).map((c) => c.textContent);
    // Trimmed, case-insensitively deduped, capped at 3.
    expect(chips()).toEqual(['What are your prices?', 'Do you offer refunds?', 'Where are you?']);

    (root.querySelector('.followups .chip') as HTMLButtonElement).click();
    await until(() => botBubbles(root).length === 3);
    expect(sendPreview.mock.calls[1][0]).toBe('What are your prices?');
    // Only the latest reply's suggestions are shown, rendered as inert text.
    expect(root.querySelectorAll('.followups').length).toBe(1);
    expect(chips()).toEqual(['<img src=x onerror=alert(1)>']);
    expect(root.querySelector('.followups img')).toBeNull();
    w.destroy();
  });

  it('uses sendPreview, and update() re-themes without losing messages', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const box = document.createElement('div');
    document.body.append(box);
    const sendPreview = vi.fn(async (message: string, _history: { role: string; content: string }[]) => ({
      content: `Echo: ${message}`,
      sources: [{ url: 'https://brightsmile.example/faq', title: 'FAQ' }],
    }));
    const w = runtime().mount({
      apiUrl: API,
      mode: 'preview',
      container: box,
      open: true,
      config: config({ primaryColor: '#0EA5E9', headerTitle: 'Draft title' }),
      businessName: 'Bright Smile Dental',
      sendPreview,
    }) as Widget;
    await w.ready;
    const root = shadowOf(box.querySelector('chatpilot-widget'));
    expect($('.title', root)!.textContent).toBe('Draft title');

    typeAndSend('hello', root);
    await until(() => botBubbles(root).length === 2);
    typeAndSend('again', root);
    await until(() => botBubbles(root).length === 3);
    expect(sendPreview).toHaveBeenCalledTimes(2);
    expect(sendPreview.mock.calls[1][0]).toBe('again');
    expect(sendPreview.mock.calls[1][1]).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Echo: hello' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('.src', root)!.textContent).toBe('Source: FAQ');

    w.update(config({ primaryColor: '#DC2626', headerTitle: 'New title', botName: 'Sunny', position: 'left', showBranding: false }));
    const r = $('.root', root)!;
    expect(r.style.getPropertyValue('--cp-primary')).toBe('#dc2626');
    expect(r.style.getPropertyValue('--cp-on-primary')).toBe('#ffffff');
    expect(r.classList.contains('left')).toBe(true);
    expect($('.title', root)!.textContent).toBe('New title');
    expect($('.sub', root)!.textContent).toContain('Sunny');
    expect($('.footer', root)!.hidden).toBe(true);
    expect(userBubbles(root)).toEqual(['hello', 'again']);
    expect(botBubbles(root).slice(1)).toEqual(['Echo: hello', 'Echo: again']);
  });

  it('picks dark text on light brand colours', () => {
    const box = document.createElement('div');
    document.body.append(box);
    runtime().mount({ apiUrl: API, mode: 'preview', container: box, config: config({ primaryColor: '#FDE047' }) });
    const r = $('.root', shadowOf(box.querySelector('chatpilot-widget')))!;
    expect(r.style.getPropertyValue('--cp-on-primary')).toBe('#111827');
  });

  it('lead form in preview shows a "not saved" confirmation without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const box = document.createElement('div');
    document.body.append(box);
    runtime().mount({
      apiUrl: API,
      mode: 'preview',
      container: box,
      config: config({ leadCapture: { ...config().leadCapture, enabled: true, trigger: 'start' } }),
      sendPreview: async () => ({ content: 'x' }),
    });
    const root = shadowOf(box.querySelector('chatpilot-widget'));
    ($('input[name=email]', root) as HTMLInputElement).value = 'a@b.co';
    ($('input[name=consent]', root) as HTMLInputElement).checked = true;
    $<HTMLFormElement>('form.lead', root)!.dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => $('.lead-ok', root));
    expect($('.lead-ok', root)!.textContent).toBe('Preview: lead not saved');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('destroy', () => {
  it('removes DOM, listeners, observers and the registry entry', async () => {
    mockApi({});
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const w = await mountFloating({ forceMobile: true });
    w.open();
    expect(runtime().instances()).toHaveLength(1);
    w.destroy();
    expect(document.querySelector('chatpilot-widget')).toBeNull();
    expect(runtime().instances()).toHaveLength(0);
    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function), undefined);
    expect(document.documentElement.style.overflow).toBe(''); // scroll lock released
    // methods are safe no-ops afterwards
    expect(() => (w.open(), w.close(), w.reset(), w.update(config()), w.destroy())).not.toThrow();
    // can be mounted again
    const again = await mountFloating();
    expect(again).not.toBe(w);
    expect(document.querySelectorAll('chatpilot-widget')).toHaveLength(1);
  });
});

describe('fullpage mode', () => {
  it('names the business in the header subtitle when it differs from the title', async () => {
    mockApi({ config: () => json(200, publicConfig({ headerTitle: 'Ask us anything' })) });
    const box = document.createElement('div');
    document.body.append(box);
    await (runtime().mount({ apiUrl: API, publicId: 'cb_test', mode: 'fullpage', container: box }) as Widget).ready;
    const root = shadowOf(box.querySelector('chatpilot-widget'));
    expect($('.title', root)!.textContent).toBe('Ask us anything');
    expect($('.sub', root)!.textContent).toBe('Bright Smile Dental · Molly · Online');
  });

  it('fills the container with no launcher and uses the hosted channel', async () => {
    const api = mockApi({ messages: () => reply('hi there') });
    const box = document.createElement('div');
    document.body.append(box);
    const w = runtime().mount({ apiUrl: API, publicId: 'cb_test', mode: 'fullpage', container: box, retryBaseMs: 1 } as never) as Widget;
    await w.ready;
    const root = shadowOf(box.querySelector('chatpilot-widget'));
    expect($('.launcher', root)).toBeNull();
    expect($('.root', root)!.classList.contains('fullpage')).toBe(true);
    // the widget header is the hosted page's single branded header
    expect($('.title', root)!.textContent).toBe('Bright Smile Dental'); // headerTitle from config()
    expect($('.sub', root)!.textContent).toBe('Molly · Online'); // businessName === headerTitle → not repeated
    expect($('.av-lg', root)).not.toBeNull();
    expect(box.querySelector('chatpilot-widget')!.getAttribute('data-chatpilot-widget')).toBe('cb_test');
    typeAndSend('hello', root);
    await until(() => botBubbles(root).length === 2);
    expect(api.posts('/messages')[0].body.channel).toBe('hosted');
  });
});
