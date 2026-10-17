# scripts/

Developer tooling for running and checking ChatPilot AI locally. Both scripts use **only Node built-ins**
(Node 20+), work on Windows, macOS and Linux, and are run from the repo root after `npm install`.

| Script | What it does |
| --- | --- |
| `node scripts/dev.mjs` | Runs the whole stack in dev mode: widget (esbuild watch), API (port 8787), dashboard (port 5173). |
| `node scripts/smoke.mjs` | End-to-end API smoke test against a running API. Prints a ✔/✘ table and exits 1 on any failure. |

---

## `dev.mjs` — one command for the local stack

```bash
node scripts/dev.mjs                 # mock AI, dev auth, JSON file store: works offline
node scripts/dev.mjs --ai=ollama     # local Ollama (default model llama3.2:3b, http://localhost:11434)
node scripts/dev.mjs --ai=openai     # any OpenAI-compatible provider (AI_API_KEY + AI_MODEL in apps/api/.env.development)
node scripts/dev.mjs --smoke         # boot, run smoke.mjs once the API is healthy, then stop (exit code = smoke result)
```

What it does, in order:

1. **Env files.** Creates `apps/api/.env.development` and `apps/web/.env.development` if they are missing. Existing
   files are never overwritten.
   - If `apps/<app>/.env.development.example` exists, it is copied. Any required dev key the example leaves out is
     appended.
   - Otherwise the file is written with dev defaults:
     - API: `NODE_ENV=development PORT=8787 AUTH_MODE=dev DEV_JWT_SECRET=dev-only-secret-change-me DATA_STORE=file
       FILE_STORE_DIR=.data AI_PROVIDER=mock FRONTEND_URLS=http://localhost:5173 PUBLIC_APP_URL=http://localhost:5173
       PUBLIC_API_URL=http://localhost:8787 PUBLIC_WIDGET_URL=http://localhost:8787/widget.js
       CONVERSATION_SECRET=dev-conversation-secret ADMIN_TOKEN=dev-admin-token`
     - Web: `VITE_API_URL=http://localhost:8787 VITE_AUTH_MODE=dev VITE_WIDGET_URL=http://localhost:8787/widget.js
       VITE_PUBLIC_APP_URL=http://localhost:5173`

   These values are for local development only. The API refuses to start with `AUTH_MODE=dev`, `DATA_STORE=file` or
   `AI_PROVIDER=mock` in production.
2. **Port check.** Exits early with a clear message if 8787 or 5173 is already taken. You can pick other ports with
   `--api-port` / `--web-port`.
3. **Widget build.** Runs `npm run build -w @chatpilot/widget` once, so `/widget.js` works as soon as the API is up.
   The API serves it from `apps/widget/dist`.
4. **Long-running processes**, each with a prefixed, coloured log:
   - `[widget]` `npm run dev -w @chatpilot/widget` (`node build.mjs --watch`)
   - `[api]` `npm run dev -w @chatpilot/api` (tsx watch)
   - `[web]` `npm run dev -w @chatpilot/web` (Vite)
5. **Ready banner.** Shown once `GET /health` answers, with the URLs to open.
6. **Ctrl+C** stops every child process tree. On Windows this uses `taskkill /pid <pid> /T /F`; on POSIX it kills the
   process group. Press Ctrl+C twice to force.
7. **Crash handling.** If any child exits on its own, everything is stopped and `dev.mjs` exits non-zero. A child that
   exits in the first 30 s is reported as crashing during startup.

   `tsx watch` stays alive even when the API dies at boot, so `[api]` output is also checked until `/health` first
   answers. Lines such as `Refusing to start`, `Invalid environment configuration`, `EADDRINUSE` or
   `Cannot find module` count as a startup crash and stop everything with exit 1. After startup, a crash in the API
   code leaves `tsx watch` waiting for a file change: look at the `[api]` output. The script also warns when `/health`
   hasn't answered after 90 s.

### Options

| Flag | Effect |
| --- | --- |
| `--ai=mock\|openai\|ollama` | Passed to the API as `AI_PROVIDER` (overrides the .env file). For `ollama`, also sets `AI_MODEL` (env `OLLAMA_MODEL`, default `llama3.2:3b`) and `AI_BASE_URL` (env `OLLAMA_URL`, default `http://localhost:11434`) unless they are already configured for Ollama. For `openai`, warns if `AI_API_KEY` / `AI_MODEL` are missing. |
| `--ai-model=NAME` | Passed as `AI_MODEL`. |
| `--api-port=N` | Runs the API on port N and rewires `PUBLIC_API_URL`, `PUBLIC_WIDGET_URL`, `VITE_API_URL` and `VITE_WIDGET_URL` to match. |
| `--web-port=N` | Runs Vite on port N and rewires `FRONTEND_URLS`, `PUBLIC_APP_URL` and `VITE_PUBLIC_APP_URL`. |
| `--no-web` | Starts only the widget and API. |
| `--no-widget-watch` | Builds the widget once but does not watch it. |
| `--smoke` | Runs `scripts/smoke.mjs` against the started API, then shuts down with the smoke exit code. |
| `--exit-after=SECONDS` | Stops everything after N seconds and exits 0 if nothing crashed. Useful in CI or for a quick boot check. |

Real environment variables always win over values in the `.env.development` files. This matches how the API loads
dotenv. So `AI_PROVIDER=ollama node scripts/dev.mjs` also works.

Data written by the file store goes to `apps/api/.data/`, which is git-ignored. Delete it for a clean slate.

> **Git Bash / mintty on Windows:** if Ctrl+C doesn't stop the children, run the script from PowerShell, cmd or
> Windows Terminal, or with `winpty node scripts/dev.mjs`.

---

## `smoke.mjs` — end-to-end API smoke test

Needs a running API in dev auth mode (`AUTH_MODE=dev`), for example from `node scripts/dev.mjs`. Crawling the default
site needs internet access.

```bash
node scripts/smoke.mjs
API_URL=http://localhost:8788 SITE_URL=https://www.python.org node scripts/smoke.mjs
node scripts/dev.mjs --no-web --smoke     # self-contained: boot API + widget, smoke, stop
```

PowerShell: `$env:SITE_URL='https://www.python.org'; node scripts/smoke.mjs`

| Env | Default | Meaning |
| --- | --- | --- |
| `API_URL` | `http://localhost:8787` | API under test |
| `SITE_URL` | `https://example.com` | Site to create the chatbot for and crawl |
| `WEB_URL` | `http://localhost:5173` | Origin sent on public demo requests (the landing page) |
| `SMOKE_MAX_PAGES` | `5` | `maxPages` for the crawl |
| `SMOKE_TIMEOUT_MS` | `90000` | Timeout for polling the crawl job and the demo |
| `SMOKE_REQUEST_TIMEOUT_MS` | `45000` | Per-request timeout |
| `SMOKE_SKIP_DEMO` | unset | `1` skips the public demo steps (for example with `DEMO_ENABLED=false`, or after hitting `DEMO_PER_IP_PER_HOUR`) |
| `SMOKE_VERBOSE` | unset | `1` logs every request and response |

Steps, in order. A step whose prerequisite failed is shown as `–` (skipped) and also fails the run.

1. `GET /health`
2. `POST /api/dev/login` as a fresh owner A (unique email per run, so re-runs don't hit the free-plan chatbot limit),
   then `GET /api/me`
3. `POST /api/chatbots` for `SITE_URL`
4. `POST /api/chatbots/:id/crawl`. A `409` is tolerated and the latest crawl job is used instead.
5. Poll `GET /api/chatbots/:id/crawl-jobs/:jobId` until `completed|failed|cancelled` (≤ 90 s). Passes only on
   `completed`; otherwise shows `error` / `hint`.
6. `GET /api/chatbots/:id/sources` returns ≥ 1 source
7. `PUT /api/chatbots/:id/config` with the full current config plus `primaryColor=#0EA5E9`, a new `welcomeMessage`,
   `leadCapture.enabled=true` with the email field on, and a contact email. The step checks that the response
   reflects the changes.
8. `POST /api/chatbots/:id/preview/messages` returns a non-empty reply
9. `POST /api/chatbots/:id/publish` returns a `publicId`, and `embedCode` contains it
10. `GET /api/public/chatbots/:publicId/config` returns `mode=published` with the new colour, welcome message and
    lead capture
11. `GET /widget.js` returns 200 with a JavaScript content type and a non-trivial size
12. Public message #1 starts a new conversation and returns `conversationId` + `conversationToken`. Message #2, sent
    with that token, stays in the same conversation. A forged token must be rejected (4xx) or must start a new
    conversation.
13. `POST /api/public/chatbots/:publicId/leads` (with consent) returns `{ ok: true, leadId }`
14. As owner: `GET /api/conversations?chatbotId=`, `GET /api/conversations/:id` (≥ 4 messages) and
    `GET /api/leads?chatbotId=` include the new conversation and lead
15. Tenant isolation: a second dev user B gets **404** on `GET /api/chatbots/:id` of A's bot. B also gets 404/403 on
    A's sources, A's conversation and `DELETE` of A's bot, and an empty list (or 404/403) for A's leads.
16. Public demo: `POST /api/public/demo`, poll `GET /api/public/demo/:demoId` until `ready` (≤ 90 s), then send one
    demo message

Public requests send an `Origin` header the way a browser would: the `SITE_URL` origin for widget calls, and `WEB_URL`
for the demo. Failures quote the API's error shape, for example `HTTP 404 not_found: Chatbot not found`.

The run uses about 4 public chat messages, 1 lead, 1 crawl and 1 demo. With the default per-IP limits
(`PUBLIC_CHAT_RATE_LIMIT`, `LEADS_RATE_LIMIT`, `DEMO_PER_IP_PER_HOUR`), several runs in quick succession can hit
`429 rate_limited`, most likely on the demo. Wait, raise the limits in `apps/api/.env.development`, or set
`SMOKE_SKIP_DEMO=1`.
