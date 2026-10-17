import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, isValid, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const numberFormatter = new Intl.NumberFormat('en-US');
const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** 12345 -> "12,345"; with compact: 12345 -> "12.3K". */
export function formatNumber(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return opts.compact ? compactFormatter.format(value) : numberFormatter.format(value);
}

/** ISO date -> "Oct 17, 2026" (or a custom date-fns pattern). Returns "—" for invalid input. */
export function formatDate(iso: string | null | undefined, pattern = 'MMM d, yyyy'): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  if (!isValid(d)) return '—';
  return format(d, pattern);
}

export function formatDateTime(iso: string | null | undefined): string {
  return formatDate(iso, 'MMM d, yyyy · h:mm a');
}

export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${formatNumber(amount)}`;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Normalises user input like "example.com" into "https://example.com". Returns null if invalid. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Returns the URL only if it is an absolute http(s) URL; otherwise undefined.
 * Use for EVERY href built from API data (visitor page URLs, crawled source URLs, siteMeta, websiteUrl)
 * so `javascript:` / `data:` URLs can never execute on the dashboard origin.
 */
export function safeHref(u?: string | null): string | undefined {
  if (!u || typeof u !== 'string') return undefined;
  try {
    const parsed = new URL(u.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** Same check for image sources from API data (siteMeta favicon/ogImage/logo). */
export const safeImageSrc = safeHref;

export function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function initials(nameOrEmail: string | undefined | null): string {
  if (!nameOrEmail) return '?';
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
