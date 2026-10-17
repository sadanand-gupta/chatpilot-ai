import { describe, expect, it } from 'vitest';
import { renderMarkdown, safeUrl } from '../src/render';

const render = (md: string) => {
  const div = document.createElement('div');
  div.append(renderMarkdown(md));
  return div;
};

describe('safeUrl', () => {
  it('allows http, https, mailto and tel', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeUrl('http://example.com')).toBe('http://example.com/');
    expect(safeUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    expect(safeUrl('tel:+15551234')).toBe('tel:+15551234');
  });

  it('rejects script-ish and relative URLs', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      '\u0001javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '/relative/path',
      '//evil.example.com',
      '',
    ]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });
});

describe('renderMarkdown', () => {
  it('renders bold, italic, code, line breaks and paragraphs', () => {
    const el = render('Hello **world** and *you* with `npm i`\nline two\n\nPara 2 _under_');
    const ps = el.querySelectorAll('p');
    expect(ps).toHaveLength(2);
    expect(el.querySelector('strong')!.textContent).toBe('world');
    expect(Array.from(el.querySelectorAll('em')).map((e) => e.textContent)).toEqual(['you', 'under']);
    expect(el.querySelector('code')!.textContent).toBe('npm i');
    expect(ps[0].querySelectorAll('br')).toHaveLength(1);
  });

  it('renders bullet and numbered lists', () => {
    const el = render('Options:\n- Cleaning\n- **Whitening**\n\n1. Call us\n2. Book online');
    expect(el.querySelectorAll('ul > li')).toHaveLength(2);
    expect(el.querySelector('ul li strong')!.textContent).toBe('Whitening');
    expect(el.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('keeps list numbering start', () => {
    const el = render('3. third\n4. fourth');
    expect(el.querySelector('ol')!.getAttribute('start')).toBe('3');
  });

  it('renders safe markdown links and auto-links bare URLs/emails', () => {
    const el = render('See [our prices](https://clinic.example/prices). Or https://clinic.example/book. Mail info@clinic.example');
    const links = Array.from(el.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://clinic.example/prices',
      'https://clinic.example/book',
      'mailto:info@clinic.example',
    ]);
    expect(links[1].textContent).toBe('https://clinic.example/book'); // trailing "." stripped
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toBe('noopener noreferrer nofollow');
  });

  it('renders raw HTML as inert text', () => {
    const el = render('<img src=x onerror=alert(1)> <script>alert(1)</script> <a href="javascript:alert(1)">x</a>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('drops javascript:/data: markdown links but keeps the label', () => {
    const el = render('[click me](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) [rel](/x)');
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('click me');
    expect(el.textContent).toContain('data');
    expect(el.textContent).not.toContain('javascript:');
  });

  it('does not produce attributes from user content', () => {
    const el = render('**"><svg onload=alert(1)>**');
    expect(el.querySelector('svg')).toBeNull();
    for (const node of Array.from(el.querySelectorAll('*'))) {
      expect(Array.from(node.attributes).map((a) => a.name)).toEqual([]);
    }
  });

  it('renders fenced code blocks as text', () => {
    const el = render('```\n<b>not bold</b>\n```');
    expect(el.querySelector('pre code')!.textContent).toBe('<b>not bold</b>');
    expect(el.querySelector('b')).toBeNull();
  });
});

describe('renderMarkdown regressions (UI QA)', () => {
  it('does not treat __ inside identifiers as bold, or snake_case as italic', () => {
    const el = render('Run window.__xss__ or __init__ and use my_var_name, then __proto__.');
    expect(el.querySelector('strong')).toBeNull();
    expect(el.querySelector('em')).toBeNull();
    expect(el.textContent).toBe('Run window.__xss__ or __init__ and use my_var_name, then __proto__.');
  });

  it('still supports _italic_ at word boundaries and **bold** inside words', () => {
    const el = render('This is _really_ good and un**believ**able.');
    expect(el.querySelector('em')!.textContent).toBe('really');
    expect(el.querySelector('strong')!.textContent).toBe('believ');
  });

  it('keeps long URLs (with _ and *) as a single link text node', () => {
    const url = 'https://clinic.example/a_very_long_path/with_under_scores/and*stars*/page?query_param=1&b=2';
    const el = render(`Book here: ${url} today`);
    const a = el.querySelector('a')!;
    expect(a.childNodes).toHaveLength(1);
    expect(a.textContent).toBe(url);
    expect(a.getAttribute('href')).toBe(url);
  });
});
