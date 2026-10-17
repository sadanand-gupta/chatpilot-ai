import { Fragment, type ReactNode } from 'react';
import { cn, safeHref } from '@/lib/utils';

/**
 * Renders the small markdown subset assistant replies use (paragraphs, "- " / "1. " lists,
 * **bold**, *italic*, [text](url), bare URLs) as React elements. Never uses innerHTML;
 * links are http(s)-only via safeHref, everything else is plain text.
 */
export function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join('\n'))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} className={cn('space-y-0.5 pl-5', list.ordered ? 'list-decimal' : 'list-disc')}>
        {list.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className={cn('space-y-2', className)}>{blocks}</div>;
}

const TOKEN = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) out.push(<Fragment key={out.length}>{text.slice(last, m.index)}</Fragment>);
    if (m[1] !== undefined) out.push(<strong key={out.length}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={out.length}>{m[2]}</em>);
    else {
      const label = m[3] ?? m[5];
      const href = safeHref(m[4] ?? m[5]);
      out.push(
        href ? (
          <a key={out.length} href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand-700 underline underline-offset-2">
            {label}
          </a>
        ) : (
          <Fragment key={out.length}>{label}</Fragment>
        ),
      );
    }
    last = TOKEN.lastIndex;
  }
  if (last < text.length) out.push(<Fragment key={out.length}>{text.slice(last)}</Fragment>);
  return out;
}
