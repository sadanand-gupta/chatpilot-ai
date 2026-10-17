import { describe, expect, it } from 'vitest';
import { BM25Index, stem, tokenize } from '../../src/knowledge/bm25';
import { chunkFaq, chunkManual, chunkSections, joinChunks, MAX_CHUNK_CHARS, splitText } from '../../src/knowledge/chunker';

const words = (n: number, prefix = 'word') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

describe('chunker', () => {
  it('keeps short text in one chunk', () => {
    expect(splitText('Hello world.')).toEqual(['Hello world.']);
  });

  it('splits long text with overlap and never mid-word', () => {
    const text = words(600);
    const pieces = splitText(text, 900, 120);
    expect(pieces.length).toBeGreaterThan(3);
    const vocab = new Set(text.split(' '));
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(900);
      for (const w of p.split(' ')) expect(vocab.has(w), `fragment "${w}"`).toBe(true);
    }
    // Consecutive pieces overlap.
    const lastWord = pieces[0].split(' ').pop()!;
    expect(pieces[1].includes(lastWord)).toBe(true);
  });

  it('packs small sections, keeps heading/title/url metadata, respects the max size', () => {
    const chunks = chunkSections(
      [
        { heading: 'Hours', text: 'Mon-Fri 9-5' },
        { heading: 'Location', text: 'MG Road, Pune' },
        { heading: 'Services', text: words(500, 'svc') },
      ],
      { title: 'Contact', url: 'https://x.example/contact' },
    );
    expect(chunks[0].heading).toBe('Hours');
    expect(chunks[0].text).toContain('Location');
    expect(chunks[0].title).toBe('Contact');
    expect(chunks[0].url).toBe('https://x.example/contact');
    expect(chunks.every((c) => c.text.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(chunks.map((c) => c.position)).toEqual(chunks.map((_, i) => i));
    const rebuilt = joinChunks(chunks);
    expect(rebuilt).toContain('svc0');
    expect(rebuilt).toContain('svc499');
    expect(rebuilt.match(/svc250 /g)?.length).toBe(1);
  });

  it('builds a single Q/A chunk for FAQs and chunks manual text by paragraphs', () => {
    const faq = chunkFaq('Do you open on Sunday?', 'No, we are closed on Sundays.');
    expect(faq).toHaveLength(1);
    expect(faq[0].text).toBe('Q: Do you open on Sunday?\nA: No, we are closed on Sundays.');
    const manual = chunkManual('Policies', `Refunds within 7 days.\n\n${words(400, 'pol')}`);
    expect(manual.length).toBeGreaterThan(1);
    expect(manual[0].title).toBe('Policies');
  });
});

describe('BM25', () => {
  it('tokenizes with stopwords, stemming and unicode', () => {
    expect(tokenize('What are the prices of your cleanings?')).toEqual(['price', 'clean']);
    expect(stem('booking')).toBe('book');
    expect(stem('services')).toBe('service');
    expect(tokenize('दांतों की सफाई')).toEqual(['दांतों', 'की', 'सफाई']);
  });

  it('ranks the most relevant chunk first and boosts title matches', () => {
    const idx = new BM25Index([
      { id: 'hours', text: 'We are open Monday to Friday from 9am to 7pm and Saturday mornings.', title: 'Opening hours' },
      { id: 'pricing', text: 'Teeth cleaning costs Rs 1500. Root canal treatment starts at Rs 6000.', title: 'Pricing' },
      { id: 'about', text: 'Founded in 2005, our clinic has friendly dentists and modern equipment.', title: 'About us' },
      { id: 'blog', text: 'Ten tips for healthy teeth: brush twice a day, floss, and visit regularly.', title: 'Blog' },
    ]);
    expect(idx.search('how much does a root canal cost?', 3)[0].id).toBe('pricing');
    expect(idx.search('when are you open on saturday', 3)[0].id).toBe('hours');
    expect(idx.search('pricing', 3)[0].id).toBe('pricing');
    expect(idx.search('zzzz qqqq', 3)).toEqual([]);
  });

  it('applies the FAQ boost', () => {
    const idx = new BM25Index([
      { id: 'page', text: 'Parking is available behind the building.' },
      { id: 'faq', text: 'Parking is available behind the building.', boost: 1.25 },
    ]);
    expect(idx.search('parking', 2)[0].id).toBe('faq');
  });
});
