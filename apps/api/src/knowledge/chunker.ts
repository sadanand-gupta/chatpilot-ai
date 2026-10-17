/**
 * Splits extracted content into retrieval chunks of roughly 900 characters with
 * about 120 characters of overlap, never cutting through a word. Each chunk keeps
 * heading + page title + url metadata. Chunks are always <= MAX_CHUNK_CHARS.
 */

export const TARGET_CHUNK_CHARS = 900;
export const CHUNK_OVERLAP_CHARS = 120;
export const MAX_CHUNK_CHARS = 1500;

export interface Section {
  heading?: string;
  text: string;
}

export interface ChunkDraft {
  text: string;
  heading?: string;
  title?: string;
  url?: string;
  position: number;
  /** Leading characters duplicated from the previous chunk (used to rebuild full text). */
  overlap?: number;
}

function findCut(text: string, start: number, end: number, size: number): number {
  const min = start + Math.floor(size * 0.5);
  const para = text.lastIndexOf('\n', end);
  if (para > min) return para;
  const sentence = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('? ', end), text.lastIndexOf('! ', end));
  if (sentence > min) return sentence + 1;
  const space = text.lastIndexOf(' ', end);
  if (space > start) return space;
  return end; // a single giant "word" (e.g. a URL): hard cut is unavoidable
}

/** Splits text into overlapping windows on word boundaries; `overlap` = leading chars repeated from the previous piece. */
export function splitTextWithOverlap(input: string, size = TARGET_CHUNK_CHARS, overlap = CHUNK_OVERLAP_CHARS): { text: string; overlap: number }[] {
  const text = input.trim();
  if (!text) return [];
  if (text.length <= size) return [{ text, overlap: 0 }];
  const pieces: { text: string; overlap: number }[] = [];
  let start = 0;
  let prevEnd = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) end = findCut(text, start, end, size);
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const piece = raw.trim();
    if (piece) pieces.push({ text: piece, overlap: pieces.length ? Math.max(0, Math.min(piece.length, prevEnd - start - lead)) : 0 });
    prevEnd = end;
    if (end >= text.length) break;
    let next = end - overlap;
    if (next <= start) next = end;
    else {
      // Move forward to the start of the next word so the overlap never begins mid-word.
      const sp = text.slice(next, end).search(/\s/);
      next = sp === -1 ? end : next + sp + 1;
    }
    start = next;
  }
  return pieces;
}

export function splitText(input: string, size = TARGET_CHUNK_CHARS, overlap = CHUNK_OVERLAP_CHARS): string[] {
  return splitTextWithOverlap(input, size, overlap).map((p) => p.text);
}

/** Packs small consecutive sections together and splits large ones. */
export function chunkSections(sections: Section[], meta: { title?: string; url?: string }, size = TARGET_CHUNK_CHARS): ChunkDraft[] {
  const out: ChunkDraft[] = [];
  let buf = '';
  let bufHeading: string | undefined;
  const push = (text: string, heading?: string, overlap = 0) => {
    const t = text.trim();
    if (!t) return;
    out.push({ text: t.slice(0, MAX_CHUNK_CHARS), heading: heading?.slice(0, 200), title: meta.title, url: meta.url, position: out.length, overlap });
  };
  const flush = () => {
    if (buf.trim()) push(buf, bufHeading);
    buf = '';
    bufHeading = undefined;
  };
  for (const s of sections) {
    const body = s.text.trim();
    if (!body) continue;
    const heading = s.heading?.trim() || undefined;
    if (body.length > size) {
      flush();
      for (const piece of splitTextWithOverlap(body, size)) push(piece.text, heading, piece.overlap);
      continue;
    }
    const addition = buf ? (heading && heading !== bufHeading ? `\n${heading}\n${body}` : `\n${body}`) : body;
    if (buf && buf.length + addition.length > size) flush();
    if (!buf) {
      buf = body;
      bufHeading = heading;
    } else {
      buf += addition;
    }
  }
  flush();
  return out;
}

export function chunkFaq(question: string, answer: string): ChunkDraft[] {
  const q = question.trim();
  const a = answer.trim();
  const full = `Q: ${q}\nA: ${a}`;
  if (full.length <= MAX_CHUNK_CHARS) return [{ text: full, heading: q.slice(0, 200), title: 'FAQ', position: 0 }];
  return splitText(a, TARGET_CHUNK_CHARS).map((piece, i) => ({
    text: `Q: ${q.slice(0, 400)}\nA: ${piece}`,
    heading: q.slice(0, 200),
    title: 'FAQ',
    position: i,
  }));
}

export function chunkManual(title: string, content: string): ChunkDraft[] {
  const paragraphs = content.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return chunkSections(
    paragraphs.map((p) => ({ text: p.replace(/[ \t]+/g, ' ').trim() })),
    { title },
  );
}

/** Rebuilds readable full text from ordered chunks (overlaps removed, headings restored). */
export function joinChunks(chunks: { text: string; heading?: string; overlap?: number }[]): string {
  let out = '';
  let lastHeading: string | undefined;
  for (const c of chunks) {
    const piece = c.text.slice(c.overlap ?? 0).trim();
    if (!piece) continue;
    if (c.overlap) out += ` ${piece}`;
    else if (c.heading && c.heading !== lastHeading && !piece.startsWith(c.heading)) out += `${out ? '\n\n' : ''}${c.heading}\n${piece}`;
    else out += `${out ? '\n\n' : ''}${piece}`;
    lastHeading = c.heading;
  }
  return out;
}
