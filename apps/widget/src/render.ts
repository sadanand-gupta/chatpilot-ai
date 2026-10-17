/**
 * Safe, minimal markdown -> DOM renderer for assistant messages.
 *
 * Security model: the input is NEVER parsed as HTML. We only create a fixed set of elements
 * (p, br, strong, em, code, pre, ul, ol, li, a) and put all text in via text nodes.
 * Links are only emitted for http:, https:, mailto: and tel: URLs; anything else
 * (javascript:, data:, vbscript:, relative URLs...) is rendered as plain text.
 */

const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/** Returns a normalised absolute URL if its protocol is allowed, otherwise null. */
export function safeUrl(raw: string | undefined | null, allowed: string[] = LINK_PROTOCOLS): string | null {
  if (typeof raw !== 'string') return null;
  // Strip whitespace and control characters (browsers ignore them, e.g. "java\tscript:").
  const s = raw.replace(/[\u0000- \u007f-\u009f]+/g, '');
  if (!s || s.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  return allowed.indexOf(u.protocol) >= 0 ? u.href : null;
}

/** Creates an external link that opens in a new tab without leaking window.opener or referrer. */
export function createLink(href: string, text?: string | Node): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  if (/^https?:/i.test(href)) {
    a.target = '_blank';
  }
  a.rel = 'noopener noreferrer nofollow';
  if (text != null) a.append(text);
  return a;
}

// Inline token groups:
//  1,2  `code`
//  3    **bold**   (__bold__ is deliberately unsupported: it mangles identifiers like window.__x__)
//  4,5  [label](url)
//  6    bare URL (http(s):// or www.)
//  7,8  *italic* (7 = preceding char)
//  9,10 _italic_ only at word boundaries (9 = preceding whitespace/bracket), so snake_case and __x stay text
//  11   email address
const INLINE =
  /(`+)([^`\n]+?)\1|\*\*(?=\S)([^\n]+?)\*\*|\[([^\]\n]{1,300})\]\(\s*<?([^)\s>]{1,2048})>?(?:\s+"[^"\n]*")?\s*\)|((?:https?:\/\/|www\.)[^\s<>"'`]+)|(^|[^\w*])\*(?=\S)([^*\n]+?)\*(?![\w*])|(^|[\s(\[])_(?=[^\s_])([^_\n]+?)_(?=$|[\s.,;:!?)\]])|([\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

const MAX_DEPTH = 4;

function text(parent: Node, s: string) {
  if (s) parent.appendChild(document.createTextNode(s));
}

/** Appends inline-formatted text to `parent`. */
export function appendInline(parent: Node, input: string, depth = 0): void {
  if (depth > MAX_DEPTH) return text(parent, input);
  const re = new RegExp(INLINE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    text(parent, input.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] !== undefined) {
      const c = document.createElement('code');
      c.textContent = m[2];
      parent.appendChild(c);
    } else if (m[3] !== undefined) {
      const b = document.createElement('strong');
      appendInline(b, m[3], depth + 1);
      parent.appendChild(b);
    } else if (m[4] !== undefined) {
      const href = safeUrl(m[5]);
      if (href) parent.appendChild(createLink(href, m[4]));
      else text(parent, m[4]); // unsafe/relative link: keep the label, drop the URL
    } else if (m[6] !== undefined) {
      let url = m[6];
      // Trailing punctuation is almost never part of the URL.
      let trail = '';
      const tm = /[.,;:!?'")\]}*_]+$/.exec(url);
      if (tm) {
        trail = tm[0];
        url = url.slice(0, -trail.length);
        // Keep a closing paren that balances one inside the URL (e.g. Wikipedia links).
        if (trail[0] === ')' && url.indexOf('(') >= 0) {
          url += ')';
          trail = trail.slice(1);
        }
      }
      const href = safeUrl(/^www\./i.test(url) ? 'https://' + url : url, ['http:', 'https:']);
      if (href) parent.appendChild(createLink(href, url));
      else text(parent, url);
      text(parent, trail);
    } else if (m[8] !== undefined || m[10] !== undefined) {
      text(parent, (m[7] ?? m[9]) as string);
      const em = document.createElement('em');
      appendInline(em, (m[8] ?? m[10]) as string, depth + 1);
      parent.appendChild(em);
    } else if (m[11] !== undefined) {
      const href = safeUrl('mailto:' + m[11]);
      if (href) parent.appendChild(createLink(href, m[11]));
      else text(parent, m[11]);
    }
  }
  text(parent, input.slice(last));
}

const UL_RE = /^\s{0,6}[-*+•]\s+(.*)$/;
const OL_RE = /^\s{0,6}(\d{1,3})[.)]\s+(.*)$/;

/** Renders markdown-ish text into a DocumentFragment of safe DOM nodes. */
export function renderMarkdown(input: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    para.forEach((l, i) => {
      if (i) p.appendChild(document.createElement('br'));
      appendInline(p, l);
    });
    frag.appendChild(p);
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = body.join('\n');
      pre.appendChild(code);
      frag.appendChild(pre);
      continue;
    }

    const ul = UL_RE.exec(line);
    const ol = ul ? null : OL_RE.exec(line);
    if (ul || ol) {
      flush();
      const ordered = !!ol;
      const list = document.createElement(ordered ? 'ol' : 'ul');
      if (ol && ol[1] !== '1') list.setAttribute('start', String(parseInt(ol[1], 10)));
      let li: HTMLLIElement | null = null;
      while (i < lines.length) {
        const l = lines[i];
        const m = ordered ? OL_RE.exec(l) : UL_RE.exec(l);
        if (m) {
          li = document.createElement('li');
          appendInline(li, ordered ? m[2] : m[1]);
          list.appendChild(li);
          i++;
        } else if (li && l.trim() && /^\s{2,}\S/.test(l)) {
          // Indented continuation line of the previous item.
          li.appendChild(document.createElement('br'));
          appendInline(li, l.trim());
          i++;
        } else break;
      }
      frag.appendChild(list);
      continue;
    }

    const hd = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (hd) {
      flush();
      const p = document.createElement('p');
      const s = document.createElement('strong');
      appendInline(s, hd[1]);
      p.appendChild(s);
      frag.appendChild(p);
      i++;
      continue;
    }

    if (!line.trim()) flush();
    else para.push(line);
    i++;
  }
  flush();
  return frag;
}
