# Widget & hosted chat page

## Embed snippet

Copied from the dashboard after **Publish** (built by `buildEmbedCode` in `packages/shared/src/embed.ts`):

```html
<script
  src="https://<widget-host>/widget.js"
  data-chatbot-id="cb_xxxxxxxx"
  data-api-url="https://<api-host>"
  async
></script>
```

| Attribute | Required | Meaning |
|---|---|---|
| `src` | yes | `PUBLIC_WIDGET_URL`. Served by the API at `/widget.js` (and versioned `/widget/v1/widget.js`), or any static host/CDN. |
| `data-chatbot-id` | yes | The chatbot's `publicId`. Public identifier, not a secret. |
| `data-api-url` | recommended | API base. Falls back to the build-time `WIDGET_DEFAULT_API_URL`. |
| `data-preview-token` | no | Owner-only: load the **draft** config on your own site before publishing. Alternatively open the page with `?chatpilot_preview=<token>`. Don't leave it in a live snippet. |

Behaviour:

- Loads asynchronously and never blocks the page; renders inside a **Shadow DOM** (open mode) so the
  site's CSS can't break it and its CSS can't leak out.
- Fetches the **published config** (`GET /api/public/chatbots/:publicId/config`) on every page load —
  colour/welcome/knowledge changes go live on publish **without changing the snippet**.
- Floating launcher bottom-right (or left). Desktop: floating panel. Mobile (viewport or container narrower than 480 px): full-screen panel.
- Remembers `visitorId` and the current conversation in `localStorage` (no cookies, no PII).
- If the API is unreachable (e.g. a sleeping free backend) it shows a friendly error with **Retry**;
  if the bot is unpublished it renders nothing.

**Versioning:** `/widget.js` always serves the latest compatible build (short cache, e.g. 5 min).
`/widget/v1/widget.js` is pinned to the v1 contract — use it if you put the file on a CDN with long
caching. Breaking changes ship as `/widget/v2/…`.

**Programmatic API** (`window.ChatPilot`, types in `packages/shared/src/embed.ts`):

```js
const bot = window.ChatPilot.mount({ apiUrl: 'https://api.example.com', publicId: 'cb_xxx', mode: 'floating' });
bot.open(); bot.close(); bot.toggle(); bot.destroy();
```

`mode: 'fullpage'` fills a container (used by the hosted page); `mode: 'preview'` is used by the
dashboard's Preview Studio with the authenticated preview endpoint.

## Hosted page vs embedded widget

| | Hosted page `https://<app>/chat/<publicId>` | Embedded widget |
|---|---|---|
| Needs access to the website | No | Yes (paste a script tag) |
| Best for | WhatsApp/Instagram bio links, QR codes on flyers, email signatures, sites you can't edit | On-site support and lead capture |
| Layout | Full-page chat with business name | Floating launcher + panel |
| Origin checks | Hosted on your app domain (always allowed) | Subject to `allowedOrigins` if set |
| Analytics | `channel: 'hosted'` | `channel: 'widget'`, `pageUrl` recorded |

Both use the same published config, knowledge, quotas and inbox.

## `allowedOrigins`

Optional per-chatbot list (plan feature) such as `https://www.example.com`. The API compares the
browser's `Origin` header and rejects others with `origin_not_allowed`. This stops casual reuse of
your snippet on other sites, **but it is not a security boundary** — non-browser clients can send any
Origin. Abuse protection = rate limits + monthly quotas + conversation HMAC tokens
([SECURITY.md](SECURITY.md#5-abuse-and-cost-exhaustion)). Include every variant you use
(`https://example.com` **and** `https://www.example.com`, staging domains).

## Content-Security-Policy on customer sites

Most small-business sites have no CSP and need nothing. If a site sends a CSP header, it must allow:

| Directive | Add | Why |
|---|---|---|
| `script-src` | `https://<widget-host>` | load `widget.js` |
| `connect-src` | `https://<api-host>` | config, messages, leads (fetch) |
| `img-src` | `https:` (or the specific avatar/favicon hosts) | bot avatar images |
| `style-src` | usually nothing; `'unsafe-inline'` **only if** the widget injects a `<style>` element | the widget's styles live inside its shadow root. Constructable stylesheets (`adoptedStyleSheets`) and CSSOM `style.setProperty` are not treated as inline `<style>` by browsers' CSP checks — prefer them in the widget. |
| `frame-src` | not needed | the widget does not use iframes |

Example:

```
Content-Security-Policy: script-src 'self' https://api.example.com; connect-src 'self' https://api.example.com; img-src 'self' https: data:
```

If the hosted page is ever embedded in an iframe on another site, the app host must not send
`X-Frame-Options: DENY`/`frame-ancestors 'none'` for `/chat/*`.

## Install guides

> Paste the snippet exactly as copied from the dashboard. After installing, the dashboard's
> **Install status** shows the last origin that loaded the widget (`GET /api/chatbots/:id/install-status`).
> Site-builder menus change often; the paths below are the typical location — check the platform's
> own help page if a menu has moved. Some builders only allow custom code on paid plans.

### Plain HTML
Paste the snippet just before `</body>` on every page (or in your shared layout/footer include).

### WordPress (self-hosted)
- Easiest: install a "header & footer code" plugin (e.g. WPCode) → **Footer** → paste → Save.
- Or theme: **Appearance → Theme File Editor → footer.php**, paste before `</body>` (use a child theme
  so updates don't erase it).
- WordPress.com: adding scripts/plugins depends on your WordPress.com plan — check your plan's features.
- Caching/optimisation plugins (Autoptimize, WP Rocket…) may combine or delay scripts; exclude
  `widget.js` if the launcher doesn't appear.

### Shopify
**Online Store → Themes → … → Edit code → `layout/theme.liquid`**, paste before `</body>`, Save.
Repeat after switching themes.

### Wix
**Settings → Custom Code (Advanced) → + Add Custom Code** → paste → *All pages* → *Load code once* →
place in **Body – end**. Wix may require a Premium plan with a connected domain for custom code.

### Squarespace
**Settings → Advanced → Code Injection → Footer** → paste → Save. Code injection may require a
higher-tier plan.

### Webflow
**Site settings → Custom code → Footer code** → paste → Save → **Publish**. Custom code only runs on
the published site (and may require a paid site plan), not in the Designer.

### Google Tag Manager
**Tags → New → Custom HTML** → paste the snippet → Trigger **All Pages** (or *Initialization – All
Pages*) → Save → **Submit/Publish**. GTM injects the script dynamically, so the widget must read its
attributes via `document.currentScript` **or** fall back to `document.querySelector('script[data-chatbot-id]')`.
If your container strips `data-*` attributes, use the programmatic form instead:

```html
<script>
  (function () {
    var s = document.createElement('script');
    s.src = 'https://<widget-host>/widget.js';
    s.async = true;
    s.dataset.chatbotId = 'cb_xxxxxxxx';
    s.dataset.apiUrl = 'https://<api-host>';
    document.body.appendChild(s);
  })();
</script>
```

### React (Vite/CRA SPA)
Simplest: put the snippet in `index.html` before `</body>`. The widget mounts on `document.body` and
survives client-side route changes. If you must load it from a component:

```tsx
useEffect(() => {
  if (document.querySelector('script[data-chatbot-id]')) return; // load once
  const s = document.createElement('script');
  s.src = 'https://<widget-host>/widget.js';
  s.async = true;
  s.dataset.chatbotId = 'cb_xxxxxxxx';
  s.dataset.apiUrl = 'https://<api-host>';
  document.body.appendChild(s);
}, []);
```

### Next.js (App Router)
In `app/layout.tsx`:

```tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://<widget-host>/widget.js"
          data-chatbot-id="cb_xxxxxxxx"
          data-api-url="https://<api-host>"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
```
(Pages Router: same `<Script>` in `pages/_app.tsx`.) Add the widget/API hosts to your CSP if you use one.

## Testing an install

1. Build the widget: `npm run build -w @chatpilot/widget` (output `apps/widget/dist/widget.js`, served by the API at `/widget.js`).
2. Open `apps/widget/demo/index.html` (edit its `data-chatbot-id`/`data-api-url`), or any static page,
   or a CodePen with the snippet in the HTML panel.
3. Check the browser console/network tab: `widget.js` 200, `/config` 200, no CSP errors.
4. Common issues: `404 not_published` → publish first; `origin_not_allowed` → add the exact origin
   (scheme + host + port); nothing appears on a free backend → the API is waking up (~1 min), retry.
