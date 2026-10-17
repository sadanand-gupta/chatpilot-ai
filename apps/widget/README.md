# @chatpilot/widget

The embeddable ChatPilot AI chat widget: one dependency-free script (`dist/widget.js`, IIFE, ES2018) that
renders inside a **Shadow DOM**, so the customer's CSS can't break it and its CSS can't leak out.

```bash
npm run build -w @chatpilot/widget     # dist/widget.js + dist/v1/widget.js (minified, no sourcemaps)
npm run dev   -w @chatpilot/widget     # watch mode (unminified, inline sourcemaps)
npm test      -w @chatpilot/widget     # vitest + jsdom (run a build first to include the bundle smoke test)
```

The API serves the build at `/widget.js` (and `/v1/widget.js`).

### Build-time configuration (set these for production builds)

These values are baked into `dist/widget.js` at build time. For each one, the first non-empty variable wins:

| Value | Env vars | Dev default |
|---|---|---|
| Default API URL (used when the snippet has no `data-api-url`) | `WIDGET_DEFAULT_API_URL` → `PUBLIC_API_URL` | `http://localhost:8787` |
| Product name ("Powered by …") | `WIDGET_PRODUCT_NAME` → `PRODUCT_NAME` | `ChatPilot AI` |
| Product URL (the "Powered by" link) | `WIDGET_PRODUCT_URL` → `PRODUCT_URL` | `http://localhost:5173` |

```bash
NODE_ENV=production WIDGET_DEFAULT_API_URL=https://api.chatpilot.example \
  WIDGET_PRODUCT_URL=https://chatpilot.example npm run build -w @chatpilot/widget
```

The defaults point at localhost, which is fine for dev. With `NODE_ENV=production`, the build warns if either URL
is still localhost.

## Embed snippet

```html
<script
  src="https://api.example.com/widget.js"
  data-chatbot-id="cb_xxxxxxxx"
  data-api-url="https://api.example.com"
  async
></script>
```

| Attribute | Required | Meaning |
|---|---|---|
| `data-chatbot-id` | yes | Public id of a **published** chatbot. Not a secret. |
| `data-api-url` | no | API origin. Defaults to the build's `WIDGET_DEFAULT_API_URL`. |
| `data-preview-token` | no | Owner preview: loads the **draft** config and shows a "Preview (draft)" badge. |
| `data-position` | no | `left` / `right`; overrides the configured position. |
| `data-open` | no | `true` opens the chat on load. |
| `data-chatpilot-manual` | no | Loader-only tag: never auto-mounts, use `ChatPilot.mount()`. |

Draft preview without editing the snippet: open any page of your site with `?chatpilot_preview=<token>`.
The token is remembered for the browser session (`?chatpilot_preview=` with an empty value exits preview).

Behaviour:
- The script is found through `document.currentScript`, or `script[data-chatbot-id]` as a fallback (tag managers).
- It waits for `DOMContentLoaded` if needed. If the same bot is embedded twice it mounts once and logs a `[ChatPilot]` warning.
- Init never throws into the host page.
- If the bot is unpublished or unknown, nothing is rendered and a `console.info` explains why.
- If the page's origin isn't in the bot's allowed origins, the widget hides itself and logs a `console.warn`.

## JavaScript API (`window.ChatPilot`)

```ts
ChatPilot.version: string
ChatPilot.mount(opts: WidgetMountOptions): WidgetInstance   // see packages/shared/src/embed.ts
ChatPilot.open() / close() / toggle()                       // first floating widget, e.g. from your own "Chat" button
ChatPilot.instances(): WidgetInstance[]

instance.open() / close() / toggle()
instance.update(config)   // live re-theme (colour, texts, icon, avatar, position, chips, branding, lead form); keeps messages
instance.reset()          // new conversation: clears messages + conversation id/token (keeps the anonymous visitor id)
instance.destroy()        // removes DOM, listeners, observers, timers, in-flight requests and the registry entry
```

Modes:
- **floating** (default): launcher bubble with a chat panel. With `container`, the widget is positioned
  `absolute` inside that element (it sets `position:relative` on a static container). The host element is 0×0 with
  `pointer-events:none`, so it never blocks the content under it. Only the launcher and the open panel take clicks.
  Mobile layout (full-screen panel, safe-area insets, host-page scroll lock) kicks in below 480px of viewport, or
  container width (via ResizeObserver), or with `forceMobile`.
- **fullpage**: fills `container` with no launcher. Used by the hosted page `/chat/:publicId` (`channel:'hosted'`).
- **preview**: Preview Studio. Renders `opts.config` without calling the public API. Messages go through
  `opts.sendPreview(message, history)`. Nothing is persisted, and lead submissions show "Preview: lead not saved".

Widget-local option extensions (not in the shared contract): `layout?: 'floating'|'fullpage'` (e.g. a fullpage preview),
`position?: 'left'|'right'`, `retryBaseMs?: number` (tests).

## Hosted page vs embedded widget

| | Hosted page (`/chat/:publicId`) | Embedded widget |
|---|---|---|
| Where | Our app domain, a full-screen chat | The customer's own site, a floating bubble |
| Install | Share a link / QR code; nothing to install | Paste the `<script>` snippet |
| Origin check | Our app origin | Customer's origin, checked against *allowed origins* |
| Context | No page context | Sends `pageUrl` (origin + path, no query/hash) so answers and analytics know the page |
| Channel | `hosted` | `widget` (`demo` for the landing-page demo) |

## CSP on customer sites

If the customer's site sends a Content-Security-Policy, it must allow our API origin:

```
script-src  'self' https://api.example.com;
connect-src 'self' https://api.example.com;
img-src     'self' https: data:;        # only if the bot uses an avatar image (any https URL)
```

- **No `'unsafe-inline'` needed for styles.** Where supported, the stylesheet uses constructable stylesheets
  (`adoptedStyleSheets`). Elsewhere it falls back to a `<style>` element inside the shadow root, which a strict
  `style-src` would block. Inline styles are only set through the CSSOM (`el.style.x = ...`), which CSP allows.
- **Trusted Types safe.** No `innerHTML` anywhere. Icons are built with `createElementNS`.
- No cookies (`credentials: 'omit'`), no `eval`, no third-party requests.

## Security & privacy

- Message content is rendered by a tiny markdown-to-DOM renderer (`src/render.ts`): **bold**, *italic*, `code`,
  code blocks, lists, line breaks and links. Text is inserted as text nodes, so HTML in messages is inert.
- Links are only created for `http(s):`, `mailto:` and `tel:` (and auto-linked bare URLs and emails).
  `javascript:`, `data:` and relative URLs render as plain text. External links get
  `target=_blank rel="noopener noreferrer nofollow"`.
- localStorage key `chatpilot:<publicId>` (`:draft` suffix in preview-token mode) holds the anonymous `visitorId`,
  `conversationId`/`conversationToken`, the last 50 messages, `leadSubmitted`, and whether the teaser/launcher was seen.
  The open state is never stored. If storage is blocked, an in-memory fallback is used.
- If the API rejects a stored conversation (expired / bad token), the widget starts a fresh one.

## API usage & resilience

- `GET /api/public/chatbots/:id/config[?previewToken]`: 15s timeout, 2 retries (network / 5xx / timeout).
- `POST .../messages`: 30s timeout, 1 retry on network / 5xx only (never after a timeout, to avoid duplicate replies).
- `POST .../leads`: 20s timeout, 1 retry.
- 4xx responses are never retried. In the UI:
  - network / 5xx: inline error with **Retry**
  - `rate_limited`: notice, and the composer is disabled for `Retry-After` (default 10s)
  - `quota_exceeded`: friendly notice with contact buttons (email / call / WhatsApp from `config.contact`)
  - `origin_not_allowed`: the widget hides itself

## E2E hooks

- Open shadow root on the host `<chatpilot-widget data-chatpilot-widget="<publicId>|preview">`.
- The panel has `role="dialog"` (`region` in fullpage mode). On full-screen mobile (viewport < 480px, not in a
  container) it also gets `aria-modal="true"` and traps Tab focus; it never does on desktop floating or in containers.
- Message bubbles (the element holding the message text) carry `data-testid="message-user"` /
  `data-testid="message-assistant"`. The welcome bubble also has `data-welcome="true"`.

## Manual test site

`demo/index.html` is a fake dental clinic site. Serve it from another origin (`npx serve apps/widget/demo -l 5500`)
and open `http://localhost:5500/?bot=cb_xxx` (optionally `&chatpilot_preview=TOKEN`, `&api=URL`, `&position=left`),
or replace `cb_REPLACE_ME` in its snippet.
