import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakePage {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  /** Respond with a redirect to this location. */
  redirect?: string;
}

export interface SiteServer {
  url: string;
  host: string;
  hits: string[];
  pages: Record<string, FakePage>;
  close(): Promise<void>;
}

/** Tiny local website used by crawler/demo tests (reached only via allowPrivateForTests). */
export async function startSite(pages: Record<string, FakePage>): Promise<SiteServer> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('#')[0];
    hits.push(path);
    const page = pages[path] ?? pages[path.split('?')[0]];
    if (!page) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html><body>Not found</body></html>');
      return;
    }
    if (page.redirect) {
      res.writeHead(page.status ?? 302, { location: page.redirect });
      res.end();
      return;
    }
    res.writeHead(page.status ?? 200, { 'content-type': 'text/html; charset=utf-8', ...(page.headers ?? {}) });
    res.end(page.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    hits,
    pages,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function htmlPage(opts: { title: string; body: string; head?: string }): string {
  return `<!doctype html><html lang="en"><head><title>${opts.title}</title>${opts.head ?? ''}</head><body>
<header class="site-header"><nav><a href="/">Home</a><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a></nav></header>
${opts.body}
<footer>© 2026 Acme Dental. All rights reserved. Follow us on social media.</footer>
</body></html>`;
}
