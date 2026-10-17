import * as cheerio from 'cheerio';
import type { SiteMeta } from '@chatpilot/shared';
import { sha1 } from '../lib/ids';
import { jsonLdToItems } from './jsonld';

/**
 * HTML -> clean, structured text. Removes chrome (scripts, nav, header, footer,
 * cookie banners, popups, social widgets…), prefers <main>/<article>, keeps the
 * heading structure as sections, and extracts brand metadata for the home page.
 */

export interface ExtractedSection {
  heading?: string;
  text: string;
}

export interface ExtractedPage {
  url: string;
  title: string;
  description?: string;
  lang?: string;
  sections: ExtractedSection[];
  text: string;
  links: string[];
  hash: string;
}

interface DomNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
}

const REMOVE_TAGS =
  'script,style,noscript,svg,iframe,form,template,canvas,video,audio,object,embed,select,textarea,input,button,dialog,link,meta';
const CHROME_TAGS = 'nav,aside,[role=navigation],[role=banner],[role=contentinfo],[role=dialog],[role=alertdialog],[aria-modal=true],[hidden]';
const NOISE_RE = /(^|[\s_-])(cookie|cookies|consent|gdpr|banner|popup|pop-up|modal|newsletter|subscribe-box|breadcrumbs?|share|sharing|social|socials)([\s_-]|$)/i;
const NOISE_LOOSE_RE = /cookie|consent|popup|modal|newsletter|breadcrumb|social-share|share-buttons|sharedaddy/i;

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'footer', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'thead',
  'tbody', 'tfoot', 'tr', 'blockquote', 'pre', 'figure', 'figcaption', 'address', 'details', 'summary', 'hr', 'br',
  'center', 'fieldset', 'legend', 'caption',
]);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const CELL_TAGS = new Set(['td', 'th']);

export const collapse = (s: string): string => s.replace(/[ ​\s]+/g, ' ').trim();

function absolutize(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  const h = href.trim();
  if (!h || h.startsWith('javascript:') || h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('data:') || h.startsWith('#')) return undefined;
  try {
    const u = new URL(h, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    u.hash = '';
    return u.href;
  } catch {
    return undefined;
  }
}

function httpsOnly(u: string | undefined): string | undefined {
  return u && u.startsWith('https://') && u.length <= 500 ? u : undefined;
}

function baseHref($: cheerio.CheerioAPI, pageUrl: string): string {
  const b = $('base[href]').attr('href');
  return (b && absolutize(b, pageUrl)) || pageUrl;
}

/** Inline elements that never split a word, so no space is inserted after them. */
const WORD_INLINE = new Set(['b', 'strong', 'em', 'i', 'u', 'small', 'sup', 'sub', 'mark', 'abbr', 'code', 'kbd', 'q', 'time', 'wbr']);
const CTA_CLASS_RE = /(^|[\s_-])(btn|button|cta|action)([\s_-]|$)/i;
const COPYRIGHT_RE = /(all rights? reserved|^©|^copyright|©\s*\d{4})/i;
/** Lines that are only counters/stats placeholders ("0%", "10+", "01", "3x"). */
const COUNTER_RE = /^[-–]?\s*[\d.,]+\s*[%+x×kKmM]?\+?$/;

function removeNoise($: cheerio.CheerioAPI): void {
  // FAQ/accordion questions are often <button aria-expanded>: keep their text before buttons are removed.
  $('button[aria-expanded],button[aria-controls],button[class*=accordion],button[class*=expansion-panel],button[class*=faq],button[class*=collapse]').each((_, el) => {
    const q = collapse($(el).text());
    $(el).replaceWith(q ? $('<p>').text(q) : '');
  });
  $(REMOVE_TAGS).remove();
  // Struck-through "was" prices next to the real price ("₹99₹180").
  $('del,s,strike,[class*=oldprice],[class*=old-price],[class*=was-price],[class*=price-old],[class*=compare-at]').remove();
  // Short CTA links/labels ("Build My Resume Now", "Get Started").
  $('a,span,div').each((_, el) => {
    const cls = $(el).attr('class') ?? '';
    if (!CTA_CLASS_RE.test(cls)) return;
    const t = collapse($(el).text());
    if (t.split(' ').length <= 5 && $(el).find('p,h1,h2,h3,h4,li').length === 0) $(el).remove();
  });
  $('[style*="display:none"],[style*="display: none"]').remove();
  $(CHROME_TAGS).remove();
  // Page-level header/footer only; an <article><header> usually holds the title.
  $('header').each((_, el) => {
    if ($(el).parents('main,article').length === 0) $(el).remove();
  });
  // Footers are site chrome even when a framework renders them inside <main>.
  $('footer,[id=footer],[class~=footer],[class*=site-footer],[class*=page-footer]').each((_, el) => {
    if ($(el).parents('article').length === 0) $(el).remove();
  });
  $('[id],[class]').each((_, el) => {
    const tag = (el as unknown as DomNode).name;
    if (tag === 'html' || tag === 'body' || tag === 'main' || tag === 'article') return;
    const idc = `${$(el).attr('id') ?? ''} ${$(el).attr('class') ?? ''}`;
    const m = NOISE_RE.exec(idc);
    if (!m && !NOISE_LOOSE_RE.test(idc)) return;
    // A "hero banner" holding the page's h1 is content, not chrome.
    if (m && m[2].toLowerCase() === 'banner' && !NOISE_LOOSE_RE.test(idc) && $(el).find('h1').length) return;
    $(el).remove();
  });
}

function pickRoot($: cheerio.CheerioAPI) {
  const main = $('main,[role=main]').first();
  if (main.length && collapse(main.text()).length > 200) return main;
  let best: ReturnType<typeof $> | null = null;
  let bestLen = 0;
  $('article').each((_, el) => {
    const len = collapse($(el).text()).length;
    if (len > bestLen) {
      bestLen = len;
      best = $(el);
    }
  });
  if (best && bestLen > 200) return best as ReturnType<typeof $>;
  const body = $('body');
  return body.length ? body : $.root();
}

/** Walks the DOM in order, producing heading-delimited sections of paragraphs. */
function walkSections(rootNode: DomNode): ExtractedSection[] {
  const sections: { heading?: string; paras: string[] }[] = [];
  let cur: { heading?: string; paras: string[] } = { paras: [] };
  let buf = '';
  const flush = () => {
    const t = collapse(buf).replace(/\s+([.,;:!?%)])/g, '$1');
    buf = '';
    if (t.length < 2 || cur.paras.includes(t) || COUNTER_RE.test(t.replace(/^- /, ''))) return;
    if (t.length < 160 && COPYRIGHT_RE.test(t)) return;
    if (t === cur.heading) return;
    cur.paras.push(t);
  };
  const textOf = (n: DomNode, depth = 0): string => {
    if (depth > 100) return '';
    if (n.type === 'text') return n.data ?? '';
    if (n.type === 'tag' || n.type === 'script' || n.type === 'style') return (n.children ?? []).map((c) => textOf(c, depth + 1)).join(' ');
    return '';
  };
  const MAX_DEPTH = 500;
  const walk = (n: DomNode, depth = 0) => {
    if (depth > MAX_DEPTH) return; // pathological nesting: ignore deeper content
    if (n.type === 'text') {
      buf += n.data ?? '';
      return;
    }
    if (n.type !== 'tag' || !n.name) {
      for (const c of n.children ?? []) walk(c, depth + 1);
      return;
    }
    const name = n.name.toLowerCase();
    if (HEADING_TAGS.has(name)) {
      flush();
      const heading = collapse(textOf(n)).slice(0, 200);
      if (!heading) return;
      if (cur.paras.length || cur.heading) sections.push(cur);
      cur = { heading, paras: [] };
      return;
    }
    if (name === 'br' || name === 'hr') {
      flush();
      return;
    }
    const block = BLOCK_TAGS.has(name);
    if (block) flush();
    if (name === 'li') buf += '- ';
    for (const c of n.children ?? []) walk(c, depth + 1);
    if (CELL_TAGS.has(name)) buf += ' | ';
    else if (!block && !WORD_INLINE.has(name)) buf += ' '; // adjacent <span>s/<a>s must not glue ("96%ATS")
    if (block) flush();
  };
  walk(rootNode);
  flush();
  if (cur.paras.length || cur.heading) sections.push(cur);
  return sections
    .map((s) => ({
      heading: s.heading,
      // Short heading-only sections are labels for removed widgets; long ones are real statements.
      text: (s.paras.length ? s.paras : s.heading && s.heading.length > 40 ? [s.heading] : [])
        .map((p) => p.replace(/(\s*\|\s*)+$/, '').replace(/^- (\s*-\s*)+/, '- '))
        .filter((p) => p && p !== '-')
        .join('\n'),
    }))
    .filter((s) => s.text.length > 0);
}

export function sectionsToText(sections: ExtractedSection[]): string {
  return sections
    .map((s) => (s.heading && s.text !== s.heading ? `${s.heading}\n${s.text}` : s.text))
    .join('\n\n')
    .trim();
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const base = baseHref($, pageUrl);
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    if (($(el).attr('rel') ?? '').includes('nofollow')) return;
    const abs = absolutize($(el).attr('href'), base);
    if (abs) links.add(abs);
  });
  const title = collapse($('title').first().text()) || collapse($('meta[property="og:title"]').attr('content') ?? '') || collapse($('h1').first().text());
  const description = collapse($('meta[name="description"]').attr('content') ?? $('meta[property="og:description"]').attr('content') ?? '') || undefined;
  const lang = $('html').attr('lang')?.slice(0, 10);
  const jsonLd = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get();

  removeNoise($);
  const root = pickRoot($);
  const node = root.get(0) as unknown as DomNode | undefined;
  const sections = node ? walkSections(node) : [];
  // Structured data (prices, FAQ, address, hours) — often richer than the visible text.
  const visible = sections.map((s) => `${s.heading ?? ''} ${s.text}`).join(' ').toLowerCase();
  for (const item of jsonLdToItems(jsonLd)) {
    if (item.question && visible.includes(item.question.toLowerCase().slice(0, 60))) continue;
    const body = item.lines.join('\n').trim();
    if (body) sections.push({ heading: item.heading, text: body });
  }
  const text = sectionsToText(sections);
  return {
    url: pageUrl,
    title: title.slice(0, 300),
    description: description?.slice(0, 500),
    lang,
    sections,
    text,
    links: [...links].slice(0, 1000),
    hash: sha1(collapse(text).toLowerCase()),
  };
}

/** Plain-text documents: paragraphs become one section. */
export function extractPlainText(body: string, pageUrl: string): ExtractedPage {
  const paras = body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => collapse(p))
    .filter(Boolean);
  const text = paras.join('\n');
  const name = new URL(pageUrl).pathname.split('/').pop() || pageUrl;
  return { url: pageUrl, title: name, sections: text ? [{ text }] : [], text, links: [], hash: sha1(text.toLowerCase()) };
}

/**
 * Removes paragraphs repeated across many pages (site-wide boilerplate that
 * survived tag-based cleanup). The first page (home) keeps one copy.
 */
export function removeBoilerplate<T extends ExtractedPage>(pages: T[]): T[] {
  if (pages.length < 3) return pages;
  const counts = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const s of p.sections) for (const line of s.text.split('\n')) seen.add(line);
    for (const l of seen) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  const boiler = new Set([...counts].filter(([, n]) => n >= threshold).map(([l]) => l));
  if (!boiler.size) return pages;
  return pages.map((p, i) => {
    if (i === 0) return p;
    const sections = p.sections
      .map((s) => ({ ...s, text: s.text.split('\n').filter((l) => !boiler.has(l)).join('\n') }))
      .filter((s) => s.text.trim().length > 0);
    const text = sectionsToText(sections);
    return { ...p, sections, text, hash: sha1(collapse(text).toLowerCase()) };
  });
}

export function extractSiteMeta(html: string, pageUrl: string): SiteMeta {
  const $ = cheerio.load(html);
  const base = baseHref($, pageUrl);
  const meta = (sel: string) => collapse($(sel).attr('content') ?? '') || undefined;
  const abs = (u?: string) => httpsOnly(absolutize(u, base));

  const iconCandidates = [
    $('link[rel="apple-touch-icon"]').attr('href'),
    $('link[rel="apple-touch-icon-precomposed"]').attr('href'),
    $('link[rel="icon"][sizes]').attr('href'),
    $('link[rel="icon"]').attr('href'),
    $('link[rel="shortcut icon"]').attr('href'),
  ];
  let favicon: string | undefined;
  for (const c of iconCandidates) {
    favicon = abs(c);
    if (favicon) break;
  }
  if (!favicon && base.startsWith('https://')) favicon = new URL('/favicon.ico', base).href;

  let logo: string | undefined;
  $('img').each((_, el) => {
    if (logo) return;
    const $el = $(el);
    const hay = `${$el.attr('class') ?? ''} ${$el.attr('id') ?? ''} ${$el.attr('alt') ?? ''} ${$el.attr('src') ?? ''} ${$el.parent().attr('class') ?? ''}`;
    if (/logo/i.test(hay)) logo = abs($el.attr('src') ?? $el.attr('data-src'));
  });

  const navLinks: string[] = [];
  const navScope = $('nav a').length ? $('nav a') : $('header a');
  navScope.each((_, el) => {
    if (navLinks.length >= 8) return;
    const t = collapse($(el).text());
    if (t.length >= 2 && t.length <= 30 && !navLinks.includes(t)) navLinks.push(t);
  });

  const heroEl = $('h1').first().length ? $('h1').first() : $('h2').first();
  const heroHeading = collapse(heroEl.text()).slice(0, 200) || undefined;
  let heroText: string | undefined;
  if (heroEl.length) {
    const candidates = heroEl.nextAll('p').add(heroEl.parent().find('p')).add($('main p, p'));
    candidates.each((_, el) => {
      if (heroText) return;
      const t = collapse($(el).text());
      if (t.length >= 40) heroText = t.slice(0, 300);
    });
  }

  const images: string[] = [];
  $('img').each((_, el) => {
    if (images.length >= 6) return;
    const $el = $(el);
    const srcset = $el.attr('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
    const src = $el.attr('src') ?? $el.attr('data-src') ?? srcset;
    if (!src || src.startsWith('data:') || /\.svg(\?|$)/i.test(src)) return;
    const w = Number($el.attr('width'));
    const h = Number($el.attr('height'));
    if ((w && w < 100) || (h && h < 100)) return;
    if (/(pixel|spacer|tracking|blank|1x1|icon|logo|avatar|badge)/i.test(src)) return;
    const u = abs(src);
    if (u && !images.includes(u)) images.push(u);
  });

  const themeColor = meta('meta[name="theme-color"]');
  return {
    url: pageUrl,
    title: collapse($('title').first().text()).slice(0, 300) || undefined,
    description: (meta('meta[name="description"]') ?? meta('meta[property="og:description"]'))?.slice(0, 500),
    siteName: (meta('meta[property="og:site_name"]') ?? meta('meta[name="application-name"]'))?.slice(0, 120),
    ogImage: abs(meta('meta[property="og:image"]') ?? meta('meta[property="og:image:url"]') ?? meta('meta[name="twitter:image"]')),
    favicon,
    logo,
    themeColor: themeColor && /^#?[0-9a-z(),.\s%]{3,40}$/i.test(themeColor) ? themeColor : undefined,
    navLinks: navLinks.length ? navLinks : undefined,
    heroHeading,
    heroText,
    images: images.length ? images : undefined,
  };
}

/** Markers of bot challenges / CAPTCHAs. We never try to bypass these. */
export function looksLikeChallenge(html: string): boolean {
  const head = html.slice(0, 20_000);
  return /g-recaptcha|h-captcha|hcaptcha\.com|cf-challenge|cf_chl_|challenge-platform|Attention Required! \| Cloudflare|Just a moment\.\.\.|captcha-delivery|px-captcha|perimeterx|datadome/i.test(head);
}
