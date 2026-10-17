import { describe, expect, it } from 'vitest';
import { evaluateFrameHeaders } from '../../src/crawler/frameCheck';
import { extractPage, extractSiteMeta, looksLikeChallenge, removeBoilerplate } from '../../src/crawler/extract';

const HOME = `<!doctype html>
<html lang="en"><head>
  <title>Acme Dental Clinic | Pune</title>
  <meta name="description" content="Family dentistry in Pune since 2005.">
  <meta property="og:site_name" content="Acme Dental">
  <meta property="og:image" content="/img/og.jpg">
  <meta name="theme-color" content="#0ea5e9">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script>window.tracking = "SECRET_SCRIPT_TEXT";</script>
  <style>.x{color:red}</style>
</head><body>
  <div id="cookie-banner">We use cookies. Accept all cookies?</div>
  <header><img class="site-logo" src="/logo.png" alt="Acme logo"><nav>
    <a href="/">Home</a><a href="/services">Services</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a>
  </nav></header>
  <main>
    <h1>Gentle dental care for the whole family</h1>
    <p>We offer cleanings, fillings, root canals and braces for children and adults in Pune.</p>
    <h2>Opening hours</h2>
    <ul><li>Mon-Fri: 9am - 7pm</li><li>Saturday: 10am - 2pm</li></ul>
    <h2>Pricing</h2>
    <table><tr><th>Treatment</th><th>Price</th></tr><tr><td>Cleaning</td><td>Rs 1500</td></tr></table>
    <img src="/img/clinic.jpg" width="800" height="600" alt="Clinic">
    <img src="data:image/gif;base64,R0lGOD" alt="pixel">
    <div class="social-share">Share on Facebook</div>
    <form><input name="q"><button>Search</button></form>
    <div class="modal">Subscribe to our newsletter!</div>
  </main>
  <footer>© 2026 Acme Dental · Privacy</footer>
  <noscript>Enable JS</noscript>
</body></html>`;

describe('extractPage', () => {
  const page = extractPage(HOME, 'https://acme-dental.example/');

  it('keeps headings as sections and main content', () => {
    expect(page.title).toBe('Acme Dental Clinic | Pune');
    expect(page.description).toBe('Family dentistry in Pune since 2005.');
    const headings = page.sections.map((s) => s.heading);
    expect(headings).toEqual(['Gentle dental care for the whole family', 'Opening hours', 'Pricing']);
    expect(page.text).toContain('root canals');
    expect(page.text).toContain('- Mon-Fri: 9am - 7pm');
    expect(page.text).toMatch(/Cleaning \| Rs 1500/);
  });

  it('removes scripts, styles, nav, footer, cookie banners, modals, forms and social widgets', () => {
    for (const bad of ['SECRET_SCRIPT_TEXT', 'color:red', 'Accept all cookies', 'Share on Facebook', 'newsletter', 'Search', 'All rights', 'Privacy', 'Enable JS']) {
      expect(page.text, bad).not.toContain(bad);
    }
  });

  it('collects absolute links (including nav links for discovery)', () => {
    expect(page.links).toContain('https://acme-dental.example/services');
    expect(page.links).toContain('https://acme-dental.example/contact');
  });

  it('dedupes boilerplate repeated across pages', () => {
    const mk = (u: string, unique: string) =>
      extractPage(`<html><body><main><h1>${unique}</h1><p>Call us on 020-1234567 for appointments today.</p><p>${unique} details here and more text.</p></main></body></html>`, u);
    const pages = removeBoilerplate([mk('https://a.example/', 'Home'), mk('https://a.example/x', 'Xray'), mk('https://a.example/y', 'Yoga'), mk('https://a.example/z', 'Zumba')]);
    expect(pages[0].text).toContain('Call us on');
    expect(pages[2].text).not.toContain('Call us on');
    expect(pages[2].text).toContain('Yoga details');
  });
});

describe('extractSiteMeta', () => {
  const meta = extractSiteMeta(HOME, 'https://acme-dental.example/');
  it('extracts brand metadata with absolute https URLs', () => {
    expect(meta.siteName).toBe('Acme Dental');
    expect(meta.ogImage).toBe('https://acme-dental.example/img/og.jpg');
    expect(meta.favicon).toBe('https://acme-dental.example/apple-touch-icon.png');
    expect(meta.logo).toBe('https://acme-dental.example/logo.png');
    expect(meta.themeColor).toBe('#0ea5e9');
    expect(meta.navLinks).toEqual(['Home', 'Services', 'Pricing', 'Contact']);
    expect(meta.heroHeading).toBe('Gentle dental care for the whole family');
    expect(meta.heroText).toContain('cleanings');
    expect(meta.images).toEqual(['https://acme-dental.example/img/clinic.jpg']);
  });

  it('skips non-https assets', () => {
    const m = extractSiteMeta('<html><head><meta property="og:image" content="http://x.example/a.jpg"></head><body></body></html>', 'http://x.example/');
    expect(m.ogImage).toBeUndefined();
  });
});

describe('challenge + frame detection', () => {
  it('detects CAPTCHA / bot challenges', () => {
    expect(looksLikeChallenge('<div class="g-recaptcha"></div>')).toBe(true);
    expect(looksLikeChallenge('<title>Just a moment...</title>')).toBe(true);
    expect(looksLikeChallenge(HOME)).toBe(false);
  });

  it('evaluates X-Frame-Options and CSP frame-ancestors', () => {
    const app = 'https://app.chatpilot.example';
    expect(evaluateFrameHeaders({}, app).frameable).toBe(true);
    expect(evaluateFrameHeaders({ 'x-frame-options': 'DENY' }, app).frameable).toBe(false);
    expect(evaluateFrameHeaders({ 'x-frame-options': 'SAMEORIGIN' }, app).frameable).toBe(false);
    expect(evaluateFrameHeaders({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }, app).frameable).toBe(false);
    expect(evaluateFrameHeaders({ 'content-security-policy': 'frame-ancestors *' }, app).frameable).toBe(true);
    expect(evaluateFrameHeaders({ 'content-security-policy': `frame-ancestors 'self' ${app}`, 'x-frame-options': 'DENY' }, app).frameable).toBe(true);
    expect(evaluateFrameHeaders({ 'content-security-policy': 'frame-ancestors https://*.chatpilot.example' }, app).frameable).toBe(true);
  });
});
