import type {
  ChatbotConfig,
  ChatMessageInput,
  LeadInput,
  SourceRef,
  WidgetInstance,
  WidgetMountOptions,
} from '@chatpilot/shared';
import { ChatPilotApiError, createApiClient, type ApiClient } from './api';
import { normalizeConfig } from './config';
import { h, setIcon, svg } from './dom';
import type { IconName } from './icons';
import { createLeadForm, type LeadValues } from './leadForm';
import { createLink, renderMarkdown, safeUrl } from './render';
import { Store, uuid, type StoredMessage } from './storage';
import { applyStyles, themeVars } from './styles';

/** Mount options = shared contract + a few widget-local extensions. */
export interface MountOptions extends WidgetMountOptions {
  /** Local extension: 'fullpage' renders the hosted-page layout (also usable in preview mode). */
  layout?: 'floating' | 'fullpage';
  /** Local extension: overrides config.position (from data-position). */
  position?: 'left' | 'right';
  /** Local extension: base delay for API retry backoff in ms (tests). */
  retryBaseMs?: number;
}

const LOG = '[ChatPilot]';
const MAX_LEN = 2000;
const COUNTER_FROM = 1800;
const MOBILE_BELOW = 480;
let seq = 0;

type Layout = 'floating' | 'fullpage';

const pageUrl = () => {
  try {
    return location.href.split(/[?#]/)[0].slice(0, 2048);
  } catch {
    return undefined;
  }
};

const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const s = words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] || '')
    .join('')
    .toUpperCase();
  return s || 'AI';
};

const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

export class Widget implements WidgetInstance {
  /** Resolves true once rendered, false if the widget gave up (not published, origin blocked...). */
  readonly ready: Promise<boolean>;
  config: ChatbotConfig | null = null;
  messages: StoredMessage[] = [];
  isOpen = false;

  private readonly o_: MountOptions;
  private readonly preview_: boolean;
  private readonly layout_: Layout;
  private readonly channel_: 'widget' | 'hosted' | 'demo';
  private readonly api_: ApiClient | null;
  private readonly store_: Store;
  private readonly uid_ = `cp${++seq}`;
  private readonly onDestroy_?: () => void;
  private businessName_ = '';
  private draft_ = false;

  private host_?: HTMLElement;
  private shadow_?: ShadowRoot | HTMLElement;
  root?: HTMLElement;
  private panel_!: HTMLElement;
  private launcher_?: HTMLButtonElement;
  private launcherIcon_?: HTMLElement;
  private log_!: HTMLElement;
  private input_!: HTMLTextAreaElement;
  private sendBtn_!: HTMLButtonElement;
  private counter_!: HTMLElement;
  private headerAvatar_!: HTMLElement;
  private titleEl_!: HTMLElement;
  private subEl_!: HTMLElement;
  private menu_!: HTMLElement;
  private menuBtn_!: HTMLButtonElement;
  private contactItem_!: HTMLButtonElement;
  private footer_!: HTMLElement;
  private welcomeEl_?: HTMLElement;
  private suggestEl_?: HTMLElement;
  private leadEl_?: HTMLElement;
  private typingEl_?: HTMLElement;
  private teaserEl_?: HTMLElement;

  private sending_ = false;
  private destroyed_ = false;
  private mobile_ = false;
  private scrollLocked_ = false;
  private pendingOpen_ = false;
  private leadAutoShown_ = false;
  private composerLocked_ = false;
  private lastText_ = '';
  private prevOverflow_: [string, string] = ['', ''];
  private prevContainerPos_: string | null = null;
  private ctrl_: AbortController | null = null;
  private timers_ = new Set<ReturnType<typeof setTimeout>>();
  private cleanups_: (() => void)[] = [];

  constructor(opts: MountOptions, onDestroy?: () => void) {
    this.o_ = opts;
    this.onDestroy_ = onDestroy;
    this.preview_ = opts.mode === 'preview';
    this.layout_ = opts.layout || (opts.mode === 'fullpage' ? 'fullpage' : 'floating');
    this.channel_ = opts.channel || (this.layout_ === 'fullpage' ? 'hosted' : 'widget');
    this.api_ = this.preview_ ? null : createApiClient(opts.apiUrl, { retryBaseMs: opts.retryBaseMs });
    this.store_ = new Store(
      this.preview_ ? `preview:${this.uid_}` : `${opts.publicId}${opts.previewToken ? ':draft' : ''}`,
      !this.preview_,
    );
    if (!this.store_.read().visitorId) this.store_.patch({ visitorId: `v_${uuid()}` });
    this.ctrl_ = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.ready = this.init_();
  }

  // ---------------------------------------------------------------- lifecycle

  private async init_(): Promise<boolean> {
    try {
      if (this.preview_) {
        this.config = normalizeConfig(this.o_.config);
        this.businessName_ = this.o_.businessName || '';
      } else {
        const pub = await this.api_!.getConfig(this.o_.publicId!, this.o_.previewToken, this.signal_());
        if (this.destroyed_) return false;
        this.config = normalizeConfig(pub.config);
        this.businessName_ = pub.businessName || '';
        this.draft_ = pub.mode === 'draft';
      }
      if (!this.o_.container && !document.body) {
        await new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
      }
      if (this.destroyed_) return false;
      this.build_();
      this.restore_();
      if (this.o_.open || this.pendingOpen_) this.open(false);
      this.scheduleTeaser_();
      return true;
    } catch (e) {
      if (!this.destroyed_) {
        this.reportInitError_(e);
        this.destroy();
      }
      return false;
    }
  }

  private reportInitError_(e: unknown) {
    const id = this.o_.publicId;
    if (e instanceof ChatPilotApiError) {
      if (e.code === 'aborted') return;
      if (e.code === 'not_published')
        console.info(
          `${LOG} Chatbot "${id}" is not published yet, so the widget is hidden. Publish it from your ${__PRODUCT_NAME__} dashboard, or preview the draft by adding ?chatpilot_preview=<preview token> to this page's URL.`,
        );
      else if (e.code === 'not_found')
        console.info(`${LOG} No chatbot found for data-chatbot-id="${id}". Check the embed snippet in your dashboard.`);
      else if (e.code === 'origin_not_allowed')
        console.warn(
          `${LOG} ${location.origin} is not an allowed website for chatbot "${id}". Add it to the allowed origins in your ${__PRODUCT_NAME__} dashboard.`,
        );
      else console.warn(`${LOG} Could not load chatbot "${id}": ${e.message}`);
    } else console.warn(`${LOG} Failed to initialise the widget.`, e);
  }

  private signal_(): AbortSignal | undefined {
    return this.ctrl_ ? this.ctrl_.signal : undefined;
  }

  private later_(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers_.delete(t);
      if (!this.destroyed_) fn();
    }, ms);
    this.timers_.add(t);
    return t;
  }

  private listen_(target: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts);
    this.cleanups_.push(() => target.removeEventListener(type, fn, opts));
  }

  // ---------------------------------------------------------------- DOM

  private build_() {
    const floating = this.layout_ === 'floating';
    const container = this.o_.container;
    const host = h('chatpilot-widget' as 'div', {
      'data-chatpilot-widget': this.preview_ ? 'preview' : this.o_.publicId,
    });
    host.style.cssText = floating
      ? 'all:initial;display:block;position:static;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none'
      : 'all:initial;display:block;width:100%;height:100%';
    this.host_ = host;
    let shadow: ShadowRoot | HTMLElement;
    try {
      shadow = host.attachShadow({ mode: 'open' });
    } catch {
      shadow = host; // very old browsers: no isolation, still functional
    }
    this.shadow_ = shadow;
    applyStyles(shadow);

    const root = h('div', {
      class: `root ${floating ? 'floating' : 'fullpage'}${container && floating ? ' contained' : ''}${this.preview_ ? ' preview' : ''}`,
    });
    this.root = root;
    const panelId = `${this.uid_}-panel`;

    // Header
    this.headerAvatar_ = h('span', { class: 'avwrap' });
    this.titleEl_ = h('p', { class: 'title' });
    this.subEl_ = h('div', { class: 'sub' });
    this.menuBtn_ = h('button', {
      type: 'button',
      class: 'hbtn',
      'aria-label': 'More options',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-controls': `${this.uid_}-menu`,
      onclick: () => this.toggleMenu_(),
    });
    this.menuBtn_.append(svg('more'));
    const newItem = h('button', { role: 'menuitem', onclick: () => (this.toggleMenu_(false), this.reset()) }, svg('refresh'), 'New conversation');
    this.contactItem_ = h('button', { role: 'menuitem', onclick: () => (this.toggleMenu_(false), this.showLead(true)) }, svg('mail'), 'Contact us');
    this.menu_ = h('div', { class: 'menu', role: 'menu', id: `${this.uid_}-menu`, 'aria-label': 'Chat options' }, this.contactItem_, newItem);
    this.menu_.hidden = true;
    const header = h(
      'div',
      { class: 'header' },
      this.headerAvatar_,
      h('div', { class: 'hinfo' }, this.titleEl_, this.subEl_),
      this.menuBtn_,
      floating &&
        h('button', { class: 'hbtn', 'aria-label': 'Close chat', onclick: () => this.close() }, svg('close')),
      this.menu_,
    );

    const badge =
      this.draft_ &&
      h('div', {
        class: 'badge',
        text: 'Preview (draft)',
        title: 'You are seeing unpublished changes. Visitors see the published version.',
      });

    // Messages
    this.log_ = h('div', {
      class: 'log',
      role: 'log',
      'aria-live': 'polite',
      'aria-relevant': 'additions',
      'aria-label': 'Conversation',
      tabindex: '0',
    });

    // Composer
    this.input_ = h('textarea', {
      class: 'input',
      rows: 1,
      maxlength: MAX_LEN,
      placeholder: 'Type your message…',
      'aria-label': 'Type your message',
      enterkeyhint: 'send',
    });
    this.input_.addEventListener('input', () => this.onInput_());
    this.input_.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        this.submitComposer_();
      }
    });
    this.sendBtn_ = h('button', { class: 'send', 'aria-label': 'Send message', onclick: () => this.submitComposer_() }, svg('send'));
    this.counter_ = h('div', { class: 'count', 'aria-live': 'polite' });
    this.counter_.hidden = true;
    const composer = h('div', { class: 'composer' }, this.counter_, h('div', { class: 'iw' }, this.input_), this.sendBtn_);

    const productUrl = safeUrl(__PRODUCT_URL__, ['http:', 'https:']);
    const brandLink = productUrl ? createLink(productUrl, __PRODUCT_NAME__) : document.createTextNode(__PRODUCT_NAME__);
    this.footer_ = h('div', { class: 'footer' }, 'Powered by ', brandLink);

    this.panel_ = h(
      'div',
      { class: 'panel', id: panelId, role: floating ? 'dialog' : 'region' },
      header,
      badge,
      this.log_,
      composer,
      this.footer_,
    );
    root.append(this.panel_);

    if (floating) {
      this.launcherIcon_ = h('span', { class: 'li li-main' });
      this.launcher_ = h(
        'button',
        {
          type: 'button',
          class: 'launcher',
          'aria-label': 'Open chat',
          'aria-expanded': 'false',
          'aria-controls': panelId,
          'aria-haspopup': 'dialog',
          onclick: () => this.toggle(),
        },
        this.launcherIcon_,
        h('span', { class: 'li li-close' }, svg('close')),
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
      );
      root.append(this.launcher_);
      if (!this.store_.read().opened) root.classList.add('unread');
    }

    root.addEventListener('keydown', (e: KeyboardEvent) => this.onKeydown_(e));
    this.listen_(document, 'click', (e: Event) => {
      if (this.menu_.hidden) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.indexOf(this.menu_) < 0 && path.indexOf(this.menuBtn_) < 0) this.toggleMenu_(false);
    });

    shadow.appendChild(root);
    if (container && floating && /^(static)?$/.test(getComputedStyle(container).position || '')) {
      this.prevContainerPos_ = container.style.position;
      container.style.position = 'relative';
    }
    (container || document.body).appendChild(host);

    this.setupResponsive_();
    this.applyConfig_();
    this.updateComposer_();
  }

  private setupResponsive_() {
    const c = this.o_.container;
    const check = () => {
      const w = c ? c.clientWidth : window.innerWidth;
      this.setMobile_(!!this.o_.forceMobile || (w > 0 && w < MOBILE_BELOW));
    };
    if (c && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => check());
      ro.observe(c);
      this.cleanups_.push(() => ro.disconnect());
    } else {
      this.listen_(window, 'resize', check, { passive: true });
    }
    check();
  }

  /** True when the panel covers the whole viewport (real mobile, not inside a container). */
  private isModal_(): boolean {
    return this.mobile_ && !this.o_.container && this.layout_ === 'floating';
  }

  private setMobile_(m: boolean) {
    this.mobile_ = m;
    this.root!.classList.toggle('mobile', m);
    if (this.isModal_()) this.panel_.setAttribute('aria-modal', 'true');
    else this.panel_.removeAttribute('aria-modal');
    if (m) this.hideTeaser_();
    this.syncScrollLock_();
  }

  /** Lock host page scroll only for the real full-screen mobile panel. */
  private syncScrollLock_() {
    const want = this.isOpen && this.isModal_() && !this.destroyed_;
    if (want === this.scrollLocked_) return;
    const de = document.documentElement;
    const b = document.body;
    if (want) {
      this.prevOverflow_ = [de.style.overflow, b ? b.style.overflow : ''];
      de.style.overflow = 'hidden';
      if (b) b.style.overflow = 'hidden';
    } else {
      de.style.overflow = this.prevOverflow_[0];
      if (b) b.style.overflow = this.prevOverflow_[1];
    }
    this.scrollLocked_ = want;
  }

  /** (Re)applies every config-driven bit of the UI in place; messages are kept. */
  private applyConfig_() {
    const c = this.config!;
    const r = this.root!;
    const vars = themeVars(c.primaryColor);
    for (const k in vars) r.style.setProperty(k, vars[k]);
    r.classList.toggle('left', (this.o_.position || c.position) === 'left');
    r.classList.toggle('brand', c.showBranding);
    this.panel_.setAttribute('aria-label', c.headerTitle);
    this.titleEl_.textContent = c.headerTitle;
    // The fullpage header is the hosted page's only header, so it also names the business.
    const biz = this.layout_ === 'fullpage' && this.businessName_ && this.businessName_ !== c.headerTitle ? `${this.businessName_} · ` : '';
    this.subEl_.textContent = `${biz}${c.botName} · Online`;
    this.headerAvatar_.replaceChildren(this.avatar_('lg'));
    this.log_.querySelectorAll('.av-sm').forEach((el) => el.replaceWith(this.avatar_('sm')));
    if (this.launcherIcon_) setIcon(this.launcherIcon_, c.launcherIcon as IconName);
    this.footer_.hidden = !c.showBranding;
    this.contactItem_.hidden = !c.leadCapture.enabled || this.leadDone_();

    const welcome = this.botRow_({ id: 'welcome', role: 'assistant', content: c.welcomeMessage, createdAt: '' });
    if (this.welcomeEl_ && this.welcomeEl_.parentNode) this.welcomeEl_.replaceWith(welcome);
    else this.log_.prepend(welcome);
    this.welcomeEl_ = welcome;
    if (this.teaserEl_) this.teaserText_(this.teaserEl_);
    this.renderSuggestions_();

    // Lead card follows config changes (Preview Studio edits fields/title live).
    const lc = c.leadCapture;
    if (this.leadEl_ && !this.leadEl_.querySelector('[data-done]')) {
      if (!lc.enabled || this.leadDone_()) this.removeLead_();
      else this.leadEl_.replaceChildren(this.leadForm_());
    } else if (!this.leadEl_ && lc.enabled && lc.trigger === 'start') {
      this.showLead(false);
    }
  }

  private avatar_(size: 'lg' | 'sm'): HTMLElement {
    const c = this.config!;
    const el = h('span', { class: `av av-${size}`, 'aria-hidden': 'true' });
    const ini = initials(c.botName);
    const url = c.avatarUrl ? safeUrl(c.avatarUrl, ['https:', 'http:']) : null;
    if (url) {
      const img = h('img', { src: url, alt: '', referrerpolicy: 'no-referrer', decoding: 'async' });
      img.addEventListener('error', () => el.replaceChildren(ini), { once: true });
      el.append(img);
    } else el.textContent = ini;
    return el;
  }

  // ---------------------------------------------------------------- messages

  private restore_() {
    const st = this.store_.read();
    this.messages = (st.messages || []).filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'));
    for (const m of this.messages) this.log_.append(this.msgRow_(m));
    this.renderSuggestions_();
    this.scrollToBottom_();
  }

  private persist_() {
    this.store_.patch({ messages: this.messages.slice(-50) });
  }

  private msgRow_(m: StoredMessage): HTMLElement {
    if (m.role === 'assistant') return this.botRow_(m);
    const bubble = h('div', { class: 'bubble', 'data-testid': 'message-user', text: m.content });
    if (m.createdAt) bubble.title = fmtTime(m.createdAt);
    return h('div', { class: 'msg user' }, h('span', { class: 'sr', text: 'You said:' }), h('div', { class: 'col' }, bubble));
  }

  private botRow_(m: StoredMessage): HTMLElement {
    const bubble = h('div', { class: 'bubble', 'data-testid': 'message-assistant', 'data-welcome': m.id === 'welcome' ? 'true' : null });
    bubble.append(renderMarkdown(m.content));
    if (m.createdAt) bubble.title = fmtTime(m.createdAt);
    const col = h('div', { class: 'col' }, bubble);
    const sources = this.sourceChips_(m.sources);
    if (sources) col.append(sources);
    if (m.fallback) {
      const actions = this.contactActions_();
      if (actions) col.append(actions);
    }
    return h('div', { class: 'msg bot' }, this.avatar_('sm'), h('span', { class: 'sr', text: `${this.config!.botName} said:` }), col);
  }

  private sourceChips_(sources?: SourceRef[]): HTMLElement | null {
    if (!Array.isArray(sources) || !sources.length) return null;
    const seen = new Set<string>();
    const wrap = h('div', { class: 'chips' });
    for (const s of sources) {
      const href = s && safeUrl(s.url, ['http:', 'https:']);
      if (!href || seen.has(href) || seen.size >= 3) continue;
      seen.add(href);
      let label = (s.title || '').trim();
      if (!label) {
        try {
          const u = new URL(href);
          label = u.hostname + (u.pathname !== '/' ? u.pathname : '');
        } catch {
          label = href;
        }
      }
      const a = createLink(href, svg('link'));
      a.className = 'src';
      a.title = href;
      a.append(h('span', { text: `Source: ${label}` }));
      wrap.append(a);
    }
    return seen.size ? wrap : null;
  }

  /** mailto / tel / WhatsApp buttons from config.contact. */
  private contactActions_(): HTMLElement | null {
    const ct = this.config!.contact || {};
    const wrap = h('div', { class: 'chips' });
    const add = (raw: string, icon: IconName, label: string) => {
      const href = safeUrl(raw);
      if (!href) return;
      const a = createLink(href, svg(icon));
      a.className = 'act';
      a.append(label);
      wrap.append(a);
    };
    if (ct.email) add(`mailto:${ct.email.trim()}`, 'mail', 'Email us');
    const tel = ct.phone && ct.phone.replace(/[^\d+]/g, '');
    if (tel) add(`tel:${tel}`, 'phone', 'Call us');
    const wa = ct.whatsapp && ct.whatsapp.replace(/\D/g, '');
    if (wa) add(`https://wa.me/${wa}`, 'whatsapp', 'WhatsApp');
    return wrap.childNodes.length ? wrap : null;
  }

  private renderSuggestions_() {
    if (this.suggestEl_) this.suggestEl_.remove();
    this.suggestEl_ = undefined;
    const qs = this.config!.suggestedQuestions;
    if (!qs.length || this.messages.some((m) => m.role === 'user')) return;
    const wrap = h('div', { class: 'suggest', role: 'group', 'aria-label': 'Suggested questions' });
    for (const q of qs) wrap.append(h('button', { class: 'chip', text: q, onclick: () => this.send(q) }));
    this.suggestEl_ = wrap;
    if (this.welcomeEl_ && this.welcomeEl_.parentNode === this.log_ && !this.messages.length) this.welcomeEl_.after(wrap);
    else this.log_.append(wrap);
  }

  /** Inserts before the typing indicator so it always stays last. */
  private appendToLog_(el: HTMLElement) {
    if (this.typingEl_ && this.typingEl_.parentNode === this.log_) this.log_.insertBefore(el, this.typingEl_);
    else this.log_.append(el);
    this.scrollToBottom_();
  }

  private addMessage_(m: StoredMessage) {
    this.messages.push(m);
    if (this.messages.length > 200) this.messages.splice(0, this.messages.length - 200);
    this.persist_();
    this.appendToLog_(this.msgRow_(m));
  }

  private scrollToBottom_() {
    const l = this.log_;
    if (l) l.scrollTop = l.scrollHeight;
  }

  private setTyping_(on: boolean) {
    if (on && !this.typingEl_) {
      this.typingEl_ = h(
        'div',
        { class: 'msg bot' },
        this.avatar_('sm'),
        h('div', { class: 'bubble typing', role: 'status', 'aria-label': `${this.config!.botName} is typing` }, h('i'), h('i'), h('i')),
      );
      this.log_.append(this.typingEl_);
      this.scrollToBottom_();
    } else if (!on && this.typingEl_) {
      this.typingEl_.remove();
      this.typingEl_ = undefined;
    }
  }

  private notice_(text: string, withContact = false) {
    const el = h('div', { class: 'note', role: 'status', text });
    this.appendToLog_(el);
    if (withContact) {
      const a = this.contactActions_();
      if (a) {
        a.classList.add('note-actions');
        a.style.alignSelf = 'center';
        this.appendToLog_(a);
      }
    }
  }

  private errorBubble_(text: string, retry?: () => void) {
    const bubble = h('div', { class: 'bubble', role: 'alert' }, svg('alert'), h('span', { text }));
    const row = h('div', { class: 'msg bot err' }, this.avatar_('sm'), h('div', { class: 'col' }, bubble));
    if (retry) {
      bubble.append(
        h('button', {
          type: 'button',
          class: 'retry',
          text: 'Retry',
          onclick: () => {
            row.remove();
            retry();
          },
        }),
      );
    }
    this.appendToLog_(row);
  }

  // ---------------------------------------------------------------- composer

  private onInput_() {
    const el = this.input_;
    el.style.height = 'auto';
    el.style.height = Math.min(Math.max(el.scrollHeight, 42), 120) + 'px';
    const len = el.value.length;
    this.counter_.hidden = len < COUNTER_FROM;
    this.counter_.textContent = `${len}/${MAX_LEN}`;
    this.counter_.classList.toggle('max', len >= MAX_LEN);
    this.updateComposer_();
  }

  private updateComposer_() {
    if (!this.input_) return;
    this.input_.disabled = this.composerLocked_;
    this.sendBtn_.disabled = this.sending_ || this.composerLocked_ || !this.input_.value.trim();
  }

  private submitComposer_() {
    const text = this.input_.value;
    if (!text.trim() || this.sending_ || this.composerLocked_) return;
    this.input_.value = '';
    this.onInput_();
    this.send(text);
  }

  private lockComposer_(seconds: number) {
    this.composerLocked_ = true;
    this.input_.placeholder = 'Please wait a moment…';
    this.updateComposer_();
    this.later_(() => {
      this.composerLocked_ = false;
      this.input_.placeholder = 'Type your message…';
      this.updateComposer_();
    }, seconds * 1000);
  }

  /** Sends a visitor message (also used by suggestion chips). */
  async send(raw: string): Promise<void> {
    const text = raw.trim().slice(0, MAX_LEN);
    if (!text || this.sending_ || this.composerLocked_ || !this.root) return;
    if (this.suggestEl_) {
      this.suggestEl_.remove();
      this.suggestEl_ = undefined;
    }
    this.addMessage_({ id: `local_${uuid()}`, role: 'user', content: text, createdAt: new Date().toISOString() });
    await this.deliver_(text);
  }

  private async deliver_(text: string, isRetryOfStale = false): Promise<void> {
    this.lastText_ = text;
    this.sending_ = true;
    this.updateComposer_();
    this.setTyping_(true);
    const c = this.config!;
    try {
      let reply: StoredMessage;
      let showLead = false;
      if (this.preview_) {
        if (typeof this.o_.sendPreview !== 'function') throw new Error('sendPreview is not configured');
        const history = this.messages
          .slice(0, -1)
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
        const r = await this.o_.sendPreview(text, history);
        reply = {
          id: `local_${uuid()}`,
          role: 'assistant',
          content: String((r && r.content) || c.fallbackMessage),
          sources: r && r.sources,
          fallback: !!(r && r.fallback),
          createdAt: new Date().toISOString(),
        };
        const userCount = this.messages.filter((m) => m.role === 'user').length;
        showLead = c.leadCapture.trigger === 'after_messages' && userCount >= c.leadCapture.afterMessages && !this.leadAutoShown_;
      } else {
        const st = this.store_.read();
        const body: ChatMessageInput = {
          message: text,
          visitorId: st.visitorId!,
          channel: this.channel_,
          pageUrl: pageUrl(),
        };
        if (st.conversationId) body.conversationId = st.conversationId;
        if (st.conversationToken) body.conversationToken = st.conversationToken;
        if (this.o_.previewToken) body.previewToken = this.o_.previewToken;
        let r;
        try {
          r = await this.api_!.sendMessage(this.o_.publicId!, body, this.signal_());
        } catch (e) {
          // Stale/expired conversation (retention, token mismatch): start a fresh one once.
          if (
            !isRetryOfStale &&
            body.conversationId &&
            e instanceof ChatPilotApiError &&
            (e.code === 'not_found' || e.code === 'forbidden' || e.code === 'unauthorized' || e.code === 'conflict')
          ) {
            this.store_.patch({ conversationId: undefined, conversationToken: undefined });
            this.sending_ = false;
            this.setTyping_(false);
            return await this.deliver_(text, true);
          }
          throw e;
        }
        if (this.destroyed_) return;
        this.store_.patch({ conversationId: r.conversationId, conversationToken: r.conversationToken });
        const m = r.message || ({} as Partial<StoredMessage>);
        reply = {
          id: m.id || `local_${uuid()}`,
          role: 'assistant',
          content: typeof m.content === 'string' && m.content ? m.content : c.fallbackMessage,
          sources: m.sources,
          fallback: !!m.fallback,
          createdAt: m.createdAt || new Date().toISOString(),
        };
        showLead = !!r.showLeadForm;
      }
      if (this.destroyed_) return;
      this.setTyping_(false);
      this.addMessage_(reply);
      if (showLead && c.leadCapture.enabled) {
        this.leadAutoShown_ = true;
        this.showLead(false);
      }
      if (!this.isOpen && this.layout_ === 'floating') this.root!.classList.add('unread');
    } catch (e) {
      if (this.destroyed_) return;
      this.setTyping_(false);
      this.handleSendError_(e);
    } finally {
      this.sending_ = false;
      this.updateComposer_();
    }
  }

  private handleSendError_(e: unknown) {
    const err = e instanceof ChatPilotApiError ? e : null;
    const code = err ? err.code : 'internal';
    const who = this.businessName_ || 'the team';
    const retry = () => this.deliver_(this.lastText_);
    switch (code) {
      case 'aborted':
        return;
      case 'origin_not_allowed':
        console.warn(`${LOG} ${location.origin} is not an allowed website for chatbot "${this.o_.publicId}". Hiding the widget.`);
        this.destroy();
        return;
      case 'quota_exceeded':
        this.notice_(`This assistant can't reply right now. Please contact ${who} directly.`, true);
        return;
      case 'rate_limited': {
        const s = Math.min(Math.max((err && err.retryAfter) || 10, 3), 60);
        this.notice_("You're sending messages a little too quickly. Please wait a moment and try again.");
        this.lockComposer_(s);
        return;
      }
      case 'not_published':
      case 'not_found':
        this.notice_('This chat is currently unavailable.', true);
        return;
      case 'validation_error':
      case 'payload_too_large':
        this.errorBubble_("That message couldn't be sent. Please shorten it and try again.");
        return;
      case 'ai_unavailable':
        this.errorBubble_('The assistant is temporarily unavailable.', retry);
        return;
      default:
        if (!err) console.warn(LOG, e);
        this.errorBubble_(
          code === 'timeout' ? 'The reply took too long.' : "Message not delivered. Check your connection.",
          retry,
        );
    }
  }

  // ---------------------------------------------------------------- lead capture

  private leadDone_(): boolean {
    return !this.preview_ && !!this.store_.read().leadSubmitted;
  }

  private leadForm_(): HTMLFormElement {
    return createLeadForm({
      config: this.config!.leadCapture,
      uid: `${this.uid_}-lead${++seq}`,
      preview: this.preview_,
      submit: (v) => this.submitLead_(v),
      onDone: () => {
        if (!this.preview_) this.contactItem_.hidden = true;
      },
    });
  }

  private async submitLead_(v: LeadValues): Promise<void> {
    const st = this.store_.read();
    const body: LeadInput = { visitorId: st.visitorId!, consent: true, pageUrl: pageUrl() };
    if (v.name) body.name = v.name;
    if (v.email) body.email = v.email;
    if (v.phone) body.phone = v.phone;
    if (v.message) body.message = v.message;
    if (st.conversationId) body.conversationId = st.conversationId;
    if (st.conversationToken) body.conversationToken = st.conversationToken;
    try {
      await this.api_!.submitLead(this.o_.publicId!, body, this.signal_());
    } catch (e) {
      const err = e instanceof ChatPilotApiError ? e : null;
      if (err && err.code === 'validation_error') throw err;
      const msg =
        err && err.code === 'rate_limited'
          ? 'Too many attempts. Please wait a moment and try again.'
          : err && err.code === 'quota_exceeded'
            ? "We couldn't save your details right now. Please contact us directly."
            : "Couldn't send your details. Please check your connection and try again.";
      throw new Error(msg);
    }
    this.store_.patch({ leadSubmitted: true });
  }

  /** Shows (or focuses) the inline lead card. */
  showLead(focus: boolean) {
    const lc = this.config && this.config.leadCapture;
    if (!lc || !lc.enabled || !this.root) return;
    if (this.leadDone_() && !(this.leadEl_ && this.leadEl_.querySelector('[data-done]'))) return;
    if (!this.leadEl_ || !this.leadEl_.parentNode) {
      this.leadEl_ = h('div', { class: 'lead-wrap' }, this.leadForm_());
      this.appendToLog_(this.leadEl_);
    } else this.scrollToBottom_();
    if (focus) {
      if (!this.isOpen) this.open(false);
      const first = this.leadEl_.querySelector('input, textarea') as HTMLElement | null;
      if (first) this.later_(() => first.focus(), 30);
    }
  }

  private removeLead_() {
    if (this.leadEl_) this.leadEl_.remove();
    this.leadEl_ = undefined;
  }

  // ---------------------------------------------------------------- menu, teaser, keyboard

  private toggleMenu_(force?: boolean) {
    const show = force ?? this.menu_.hidden;
    this.menu_.hidden = !show;
    this.menuBtn_.setAttribute('aria-expanded', String(show));
    if (show) {
      const first = this.menu_.querySelector('button:not([hidden])') as HTMLElement | null;
      first && first.focus();
    }
  }

  private onKeydown_(e: KeyboardEvent) {
    if (e.key === 'Tab' && this.isOpen && this.isModal_()) {
      // Full-screen mobile dialog: keep focus inside the panel.
      const items = Array.from(
        this.panel_.querySelectorAll<HTMLElement>('button, textarea, input, a[href], [tabindex="0"]'),
      ).filter((el) => !(el as HTMLButtonElement).disabled && !el.closest('[hidden]'));
      if (!items.length) return;
      const active = (this.shadow_ as ShadowRoot).activeElement;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (active === first || !active)) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && (active === last || !active)) {
        first.focus();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (!this.menu_.hidden) {
        this.toggleMenu_(false);
        this.menuBtn_.focus();
        e.stopPropagation();
      } else if (this.layout_ === 'floating' && this.isOpen) {
        this.close();
        e.stopPropagation();
      }
    } else if (!this.menu_.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const items = Array.from(this.menu_.querySelectorAll('button')).filter((b) => !b.hidden);
      const active = (this.shadow_ as ShadowRoot).activeElement as HTMLElement | null;
      const i = items.indexOf(active as HTMLButtonElement);
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      next && next.focus();
      e.preventDefault();
    }
  }

  private teaserText_(el: HTMLElement) {
    const btn = el.querySelector('.teaser-txt');
    if (!btn) return;
    const first = this.config!.welcomeMessage.split('\n')[0].replace(/[*_`#]/g, '');
    btn.textContent = first.length > 110 ? first.slice(0, 107) + '…' : first;
  }

  private scheduleTeaser_() {
    if (this.layout_ !== 'floating' || this.preview_ || this.o_.open) return;
    const st = this.store_.read();
    if (st.opened || st.teaserShown) return;
    this.later_(() => {
      if (this.isOpen || this.mobile_ || this.teaserEl_) return;
      this.store_.patch({ teaserShown: true });
      const el = h(
        'div',
        { class: 'teaser' },
        h('button', { class: 'teaser-txt', onclick: () => this.open() }),
        h('button', { class: 'teaser-x', 'aria-label': 'Dismiss message', onclick: () => this.hideTeaser_() }, svg('close')),
      );
      this.teaserText_(el);
      this.teaserEl_ = el;
      this.root!.insertBefore(el, this.launcher_ || null);
    }, 3000);
  }

  private hideTeaser_() {
    if (this.teaserEl_) this.teaserEl_.remove();
    this.teaserEl_ = undefined;
  }

  // ---------------------------------------------------------------- public API

  open(focus = true): void {
    if (this.destroyed_) return;
    if (!this.root) {
      this.pendingOpen_ = true;
      return;
    }
    if (this.layout_ !== 'floating') return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.root.classList.remove('unread');
    if (this.launcher_) {
      this.launcher_.setAttribute('aria-expanded', 'true');
      this.launcher_.setAttribute('aria-label', 'Close chat');
    }
    this.hideTeaser_();
    if (!this.store_.read().opened) this.store_.patch({ opened: true });
    this.syncScrollLock_();
    this.scrollToBottom_();
    if (focus) this.later_(() => this.isOpen && !this.input_.disabled && this.input_.focus(), 60);
  }

  close(): void {
    if (this.destroyed_) return;
    this.pendingOpen_ = false;
    if (!this.root || this.layout_ !== 'floating' || !this.isOpen) return;
    const hadFocus = !!(this.shadow_ && (this.shadow_ as ShadowRoot).activeElement);
    this.isOpen = false;
    this.root.classList.remove('open');
    this.toggleMenu_(false);
    if (this.launcher_) {
      this.launcher_.setAttribute('aria-expanded', 'false');
      this.launcher_.setAttribute('aria-label', 'Open chat');
      if (hadFocus) this.launcher_.focus();
    }
    this.syncScrollLock_();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  update(config: ChatbotConfig): void {
    if (this.destroyed_) return;
    this.config = normalizeConfig(config);
    if (this.root) this.applyConfig_();
  }

  reset(): void {
    if (this.destroyed_) return;
    this.messages = [];
    this.store_.patch({ conversationId: undefined, conversationToken: undefined, messages: [] });
    if (!this.root) return; // still loading: nothing rendered yet
    if (this.ctrl_) this.ctrl_.abort(); // drop any in-flight reply
    this.ctrl_ = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.sending_ = false;
    this.leadAutoShown_ = false;
    this.setTyping_(false);
    this.log_.replaceChildren();
    this.welcomeEl_ = undefined;
    this.leadEl_ = undefined;
    this.applyConfig_();
    this.updateComposer_();
    if (this.isOpen) this.input_.focus();
  }

  destroy(): void {
    if (this.destroyed_) return;
    this.destroyed_ = true;
    this.isOpen = false;
    if (this.ctrl_) this.ctrl_.abort();
    this.timers_.forEach((t) => clearTimeout(t));
    this.timers_.clear();
    this.cleanups_.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    this.cleanups_ = [];
    if (this.scrollLocked_) {
      document.documentElement.style.overflow = this.prevOverflow_[0];
      if (document.body) document.body.style.overflow = this.prevOverflow_[1];
      this.scrollLocked_ = false;
    }
    if (this.host_) this.host_.remove();
    if (this.o_.container && this.prevContainerPos_ !== null) this.o_.container.style.position = this.prevContainerPos_;
    this.host_ = undefined;
    this.root = undefined;
    if (this.onDestroy_) this.onDestroy_();
  }
}
