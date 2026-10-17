import type { SourceType } from '@chatpilot/shared';
import { jaccard, tokenize } from './bm25';

/** Something the bot's knowledge covers, used for "I can help with…" lists and follow-up chips. */
export interface KnowledgeTopic {
  /** Short label: a cleaned page/manual title or an FAQ question. */
  label: string;
  kind: 'page' | 'faq' | 'manual';
  url?: string;
}

const SKIP_PATH = /\/(privacy|terms|cookies?|legal|login|log-in|signin|sign-in|signup|sign-up|register|cart|checkout|account|blog|blogs|news|articles?|posts?|tags?|category|categories|author|careers?|jobs-at|sitemap|404|search)(\/|$|\.)/i;
const SKIP_LABEL = /^(home|home ?page|welcome|index|about|about us|get to know us|who we are|our story|blog|news|careers|sitemap|page not found|404|not found|untitled|faq)$/i;
const FILLER = /^(ai|inc|ltd|llc|llp|pvt|official|online|app|india|website|site|com|io)$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Jobwala AI — Pricing" → "Pricing"; "Resume Builder in Chennai — … | Jobwala AI" → "Resume Builder in Chennai". */
export function cleanTitle(title: string, businessName: string): string | null {
  const biz = businessName.trim();
  const bizRe = biz ? new RegExp(`\\b${escapeRe(biz)}(\\.[a-z]{2,6})*\\b`, 'gi') : null;
  const parts = title
    .split(/\s+[|—–:·•-]\s+|\s*\|\s*|\s+[—–]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    let label = bizRe ? part.replace(bizRe, ' ') : part;
    if (label !== part) {
      // The business name was removed: drop brand filler left around it ("Jobwala AI Locations" → "Locations").
      const words = label.trim().split(/\s+/).filter(Boolean);
      while (words.length && FILLER.test(words[0])) words.shift();
      while (words.length && FILLER.test(words[words.length - 1])) words.pop();
      label = words.join(' ');
    }
    label = label.replace(/\s+/g, ' ').replace(/^[\s,&|:–—-]+|[\s,&|:–—-]+$/g, '').trim();
    if (!label || label.length < 3 || label.length > 70) continue;
    if (FILLER.test(label) || SKIP_LABEL.test(label)) continue;
    if (biz && label.toLowerCase() === biz.toLowerCase()) continue;
    return label;
  }
  return null;
}

function depth(url?: string): number {
  if (!url) return 99;
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '');
    return p ? p.split('/').length - 1 : 0;
  } catch {
    return 99;
  }
}

/**
 * Topics in display order: the home page, FAQ questions, then shallow pages and
 * manual entries. Templated near-duplicates ("Resume Builder in Chennai/Madurai/…")
 * collapse into the first one.
 */
export function knowledgeTopics(sources: { type: SourceType; title: string; url?: string }[], businessName: string, max = 8): KnowledgeTopic[] {
  const pages = sources
    .map((s, i) => ({ ...s, i }))
    .filter((s) => s.type === 'page' && !(s.url && SKIP_PATH.test(new URL(s.url, 'https://x.invalid').pathname)))
    .sort((a, b) => depth(a.url) - depth(b.url) || a.i - b.i);
  const faqs = sources.filter((s) => s.type === 'faq');
  const manuals = sources.filter((s) => s.type === 'manual');
  const ordered: KnowledgeTopic[] = [];
  const push = (label: string | null, kind: KnowledgeTopic['kind'], url?: string) => {
    if (label) ordered.push({ label, kind, url });
  };
  if (pages[0]) push(cleanTitle(pages[0].title, businessName), 'page', pages[0].url);
  for (const f of faqs.slice(0, 3)) push(f.title.trim().slice(0, 100), 'faq');
  for (const m of manuals.slice(0, 3)) push(cleanTitle(m.title, businessName), 'manual');
  for (const p of pages.slice(1)) push(cleanTitle(p.title, businessName), 'page', p.url);

  const out: KnowledgeTopic[] = [];
  const sets: Set<string>[] = [];
  for (const t of ordered) {
    const set = new Set(tokenize(t.label));
    if (!set.size) continue;
    if (sets.some((s) => jaccard(s, set) >= 0.5)) continue;
    out.push(t);
    sets.push(set);
    if (out.length >= max) break;
  }
  return out;
}
