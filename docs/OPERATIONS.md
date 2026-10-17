# Operations runbook

For a solo operator. Each incident has: **symptoms → check → act → follow-up**.

## Daily / weekly routine

| When | Do |
|---|---|
| Daily (2 min) | Glance at Render logs for 5xx / `ai_unavailable`; uptime monitor status; Firestore **Usage** vs. daily quota. |
| Weekly | AI provider spend; top owners by `usage` (abuse?); failed crawl jobs; `npm audit`; Firebase Auth new sign-ups (spam?). |
| Monthly | Usage resets (UTC month); review plan limits vs. actual costs ([COSTS.md](COSTS.md)); test a backup restore (Blaze). |

## Incidents

### AI provider down / slow / rate-limited
- **Symptoms:** replies are the fallback message; logs show `ai_unavailable`, 429/5xx/timeouts from upstream; `usage.failedRequests` climbs.
- **Check:** provider status page; `curl` the provider with the same key/model; is it a 401 (key revoked / billing failed) or 429 (rate limit)?
- **Act:**
  1. 401/402 → fix billing / rotate key (`AI_API_KEY`) → redeploy.
  2. 429 → lower `AI_MAX_CONCURRENCY`, raise provider tier/limits.
  3. Outage → switch provider by env only: e.g. `AI_BASE_URL=https://api.groq.com/openai/v1`, `AI_MODEL=openai/gpt-oss-20b`, `AI_API_KEY=…`, `MAX_OUTPUT_TOKENS=800` → redeploy (≈ 2–3 min on Render). Keep a funded fallback account ready ([AI_PROVIDERS.md](AI_PROVIDERS.md)).
  4. Model retired (404 model not found) → update `AI_MODEL` (providers retire models with notice — subscribe to deprecation pages).
- **Follow-up:** visitors got fallbacks, not errors; consider posting a status note to affected owners.

### Customer hits their quota
- **Symptoms:** `429 quota_exceeded` with `details.metric` (`messages`, `crawls`, `leads`), widget shows a "temporarily unavailable" message.
- **Act:** expected behaviour. If it's a legit customer, upgrade their plan (`users/{uid}.planId`, see [MONETIZATION.md](MONETIZATION.md)) or temporarily raise limits via `plans/{planId}`. Quotas reset at the start of the UTC month.
- **If it's abuse** (one bot getting thousands of messages from few IPs): set `allowedOrigins` for the bot, lower `PUBLIC_CHAT_RATE_LIMIT`, or unpublish it.

### Crawl abuse
- **Symptoms:** many crawl jobs from new accounts, crawls of unrelated/large sites, demo endpoint hammered, outbound bandwidth spike (Render may suspend free services for unusually high outbound traffic).
- **Act:**
  1. `DEMO_ENABLED=false` (redeploy) if the demo is the vector.
  2. Lower `DEMO_PER_IP_PER_HOUR`, `MAX_CRAWL_PAGES`, `CRAWL_CONCURRENCY`.
  3. Disable abusive users in Firebase Auth (Authentication → Users → Disable). `verifyIdToken(…, checkRevoked=true)` rejects them on the next request.
  4. Check logs for SSRF attempts (blocked private IPs) — that's an attacker probing; disable the account.
- **Follow-up:** require email verification before crawling; add reCAPTCHA/App Check on sign-up.

### Firestore quota exhausted (Spark) or cost spike (Blaze)
- **Symptoms (Spark):** Firestore calls fail (quota exhausted) → API returns 5xx on most routes until the daily reset (~midnight Pacific).
- **Check:** Firebase console → Firestore → **Usage**; find the hot path (widget config loads? inbox polling? a crawl writing thousands of chunks?).
- **Act:** upgrade to **Blaze** (same free quota, then pay-per-use) — the fastest fix; set a budget alert. Reduce reads: cache published configs in memory (short TTL), lower dashboard polling frequency, cap list `limit`.
- **Follow-up:** add an in-memory cache for `publicConfigs` and the BM25 chunk cache (already keyed by `knowledgeVersion`).

### API down / crash loop
- **Check:** Render → Events/Logs. Common: missing env var (the API validates config at boot and logs which), the production guard tripped (`AUTH_MODE=dev`/`DATA_STORE=file`/`AI_PROVIDER=mock`), malformed `FIREBASE_PRIVATE_KEY` (newline escaping), out of memory (512 MB — large crawls + chunk caches).
- **Act:** fix env → *Manual Deploy*; roll back with Render's **Rollback** to the previous deploy; for OOM move to a 2 GB instance or reduce `CRAWL_CONCURRENCY`.
- Crawl jobs running during a crash are marked `failed` on boot; users retry.

### Widget not showing on a customer site
Ask for the URL; open DevTools → Console/Network. See [WIDGET.md → Testing an install](WIDGET.md#testing-an-install) (unpublished bot, origin not allowed, CSP, sleeping API, optimisation plugin deferring scripts).

## Rotating secrets

| Secret | Steps | Impact |
|---|---|---|
| Firebase service-account key | GCP Console → IAM → Service accounts → *firebase-adminsdk* → Keys → **Add key** (JSON) → update `FIREBASE_PRIVATE_KEY`/`FIREBASE_CLIENT_EMAIL` on Render → deploy → verify `/health` + a private route → **delete the old key**. | None if done in this order. |
| `AI_API_KEY` | Create new key at provider → update env → deploy → revoke old. | None. |
| `CONVERSATION_SECRET` | Render → env → *Generate* new value → deploy. | Existing conversation tokens become invalid → returning visitors start a new conversation. Old conversations remain in the inbox. |
| `ADMIN_TOKEN` | Generate new → deploy. | Update any scripts using it. |
| Leaked web API key (`VITE_FIREBASE_API_KEY`) | It is public by design. Ensure it is restricted (HTTP referrers + APIs). Rotating = create new browser key, rebuild web, delete old. | Rebuild/redeploy web. |
| Suspected account takeover | Firebase Auth → disable user or `admin.auth().revokeRefreshTokens(uid)`; `checkRevoked` makes it effective immediately. | User must sign in again. |

Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## Data deletion requests

| Request from | Action |
|---|---|
| **Owner** (delete my account) | They use *Settings → Delete account* (`DELETE /api/me`), which cascades everything ([SECURITY.md §8](SECURITY.md#8-account-deletion)). If they can't log in, verify identity by email, then delete as admin (same code path) and delete the Auth user. |
| **Website visitor** (delete my chat/lead) | Visitors are the *owner's* data subjects; the owner is the controller and ChatPilot the processor. Forward the request to the owner; they delete the lead (`DELETE /api/leads/:id`) and conversation (`DELETE /api/conversations/:id`). Assist if asked. |
| **Backups** | Data persists in backups until they expire (≤ 14 weeks for scheduled backups). State this in the privacy policy. |

Log the request date, requester, and completion date (outside Firestore, e.g. a private spreadsheet).

## Retention

- Conversations + messages: deleted after the plan's `retentionDays` by the API's periodic job (based on `lastMessageAt`).
- Demo bots: deleted ~2 h after creation by the hourly cleanup (TTL on `chatbots.expiresAt` as a backstop on Blaze).
- Crawl jobs: keep the last N per chatbot (old ones deleted with their chatbot).
- Leads: until deleted by the owner or account deletion.
- Logs: Render log retention depends on plan; don't put PII in logs.
- If the cleanup job is down (e.g. free instance asleep for days), it catches up on the next run — jobs query by date, not by "since last run".

## Scaling notes

| Trigger | Change |
|---|---|
| Running > 1 API instance | **Rate limits:** in-memory `express-rate-limit` is per instance → use a shared store (Redis/Upstash + `rate-limit-redis`). **Cleanup job:** run on one instance only (env flag) or as Cloud Scheduler → admin endpoint with `ADMIN_TOKEN`. **Retrieval cache:** per-instance is fine (keyed by `knowledgeVersion`). |
| Crawls lost on restarts / long crawls | Move crawling to a queue + worker: **Cloud Tasks** (HTTP push to a worker endpoint, pairs well with Cloud Run) or **BullMQ** (Redis). Job state already lives in `crawlJobs` docs. |
| Many concurrent chats | Raise `AI_MAX_CONCURRENCY` with the provider's limits; consider streaming responses. |
| Knowledge > a few thousand chunks per bot, or multilingual retrieval | Add embeddings (provider embedding API) + vector search (Firestore vector search, pgvector, or a hosted vector DB) behind the retriever interface; keep BM25 for hybrid ranking. Re-embed on `knowledgeVersion` change. |
| Firestore cost | Cache `publicConfigs` in memory, reduce polling, add exemptions for large text fields (see [DATA_MODEL.md](DATA_MODEL.md#indexes)). |
| Global audience | Widget on a CDN; API region near Firestore; consider a second region only when latency matters. |
