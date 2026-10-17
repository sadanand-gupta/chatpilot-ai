import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalUrl, crawlSite, JS_SITE_HINT, priorityOf } from '../../src/crawler/crawler';
import { htmlPage, startSite, type SiteServer } from '../helpers/siteServer';

const para = (topic: string) =>
  `<p>${topic} information for our patients. We explain every ${topic.toLowerCase()} detail clearly so that visitors understand how ${topic.toLowerCase()} works at Acme Dental in Pune.</p>`;

describe('crawler (local site)', () => {
  let site: SiteServer;
  beforeAll(async () => {
    const blogLinks = Array.from({ length: 12 }, (_, i) => `<a href="/blog/page/${i + 2}">Page ${i + 2}</a>`).join('');
    site = await startSite({
      '/robots.txt': { body: 'User-agent: *\nDisallow: /\n\nUser-agent: ChatPilotBot\nDisallow: /secret\nDisallow: /private\nCrawl-delay: 0\n', headers: { 'content-type': 'text/plain' } },
      '/': {
        body: htmlPage({
          title: 'Acme Dental',
          head: '<meta property="og:site_name" content="Acme Dental">',
          body: `<main><h1>Acme Dental Pune</h1>${para('Welcome')}
            ${blogLinks}
            <a href="/secret/plans">Secret</a><a href="/private/x">Private</a>
            <a href="/pricing?utm_source=x#top">Pricing</a><a href="/about/">About</a><a href="/contact">Contact</a>
            <a href="/brochure.pdf">PDF</a><a href="https://other-site.example/">Elsewhere</a><a href="/login">Login</a>
            <a href="/app">App</a><a href="/dup">Dup</a></main>`,
        }),
      },
      '/pricing': { body: htmlPage({ title: 'Pricing', body: `<main><h1>Pricing</h1>${para('Pricing')}<p>Cleaning costs Rs 1500.</p></main>` }) },
      '/about': { body: htmlPage({ title: 'About', body: `<main><h1>About us</h1>${para('About')}</main>` }) },
      '/contact': { body: htmlPage({ title: 'Contact', body: `<main><h1>Contact</h1>${para('Contact')}</main>` }) },
      '/dup': { body: htmlPage({ title: 'Contact copy', body: `<main><h1>Contact</h1>${para('Contact')}</main>` }) },
      '/secret/plans': { body: htmlPage({ title: 'Secret', body: `<main>${para('Secret')}</main>` }) },
      '/private/x': { body: htmlPage({ title: 'Private', body: `<main>${para('Private')}</main>` }) },
      '/login': { status: 403, body: 'denied' },
      '/app': { body: '<html><body><div id="root"></div><script src="/app.js"></script></body></html>' },
      ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/blog/page/${i + 2}`, { body: htmlPage({ title: `Blog ${i + 2}`, body: `<main>${para(`Blog ${i + 2}`)}</main>` }) }])),
    });
  });
  afterAll(() => site.close());

  const base = () => ({
    startUrl: `${site.url}/`,
    maxDepth: 3,
    concurrency: 2,
    pageTimeoutMs: 4000,
    maxPageBytes: 500_000,
    userAgent: 'ChatPilotBot/1.0 (+test)',
    allowPrivateForTests: { hosts: [site.host] },
    useSitemap: false,
  });

  it('respects robots.txt, prioritises business pages, dedupes and enforces maxPages', async () => {
    const out = await crawlSite({ ...base(), maxPages: 4 });
    expect(out.error).toBeUndefined();
    const urls = out.pages.map((p) => new URL(p.url).pathname);
    expect(urls).toHaveLength(4);
    expect(urls[0]).toBe('/');
    // High-priority pages come before blog pagination.
    expect(urls).toEqual(expect.arrayContaining(['/pricing', '/about', '/contact']));
    expect(urls.some((u) => u.startsWith('/blog/page'))).toBe(false);
    // robots.txt: never fetched.
    expect(site.hits).not.toContain('/secret/plans');
    expect(site.hits).not.toContain('/private/x');
    // Non-HTML extensions and other sites are never requested.
    expect(site.hits).not.toContain('/brochure.pdf');
    expect(out.siteMeta?.siteName).toBe('Acme Dental');
    expect(out.totalChars).toBeGreaterThan(200);
  });

  it('skips 403 pages, JS-only pages and duplicates with reasons', async () => {
    const out = await crawlSite({ ...base(), maxPages: 30 });
    const byPath = new Map(out.results.map((r) => [new URL(r.url).pathname, r]));
    expect(byPath.get('/login')?.status).toBe('skipped');
    expect(byPath.get('/login')?.reason).toMatch(/403/);
    expect(byPath.get('/app')?.reason).toMatch(/JavaScript/);
    const dupOrContact = [byPath.get('/dup'), byPath.get('/contact')].filter((r) => r?.status === 'skipped');
    expect(dupOrContact[0]?.reason).toMatch(/Duplicate/);
  });

  it('gives a JS-site hint when almost no text could be extracted', async () => {
    const out = await crawlSite({ ...base(), startUrl: `${site.url}/app`, maxPages: 3, maxDepth: 0 });
    expect(out.hint).toBe(JS_SITE_HINT);
  });

  it('fails cleanly when robots.txt disallows the start URL', async () => {
    const out = await crawlSite({ ...base(), startUrl: `${site.url}/secret/plans`, maxPages: 3 });
    expect(out.errorCode).toBe('crawl_blocked');
    expect(out.pages).toHaveLength(0);
  });

  it('canonicalises URLs and scores priority', () => {
    expect(canonicalUrl('https://Example.com/a/?utm_source=x&b=2&a=1#frag')).toBe('https://example.com/a?a=1&b=2');
    expect(priorityOf('https://x.example/pricing', 1)).toBeLessThan(priorityOf('https://x.example/blog/page/3', 1));
    expect(priorityOf('https://x.example/privacy-policy', 1)).toBeGreaterThan(priorityOf('https://x.example/team', 1));
  });
});
