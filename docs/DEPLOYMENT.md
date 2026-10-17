# Deployment

Target setup: **Firebase** (Auth + Firestore) · **Render** (API + `widget.js`) · **Cloudflare Pages or
Firebase Hosting** (dashboard SPA) · an **OpenAI-compatible LLM** (see [AI_PROVIDERS.md](AI_PROVIDERS.md)).

> **A successful deploy is not the same as production-ready.** The free path below works for a demo
> or pilot. Before paying customers depend on it, finish the [launch readiness checklist](#launch-readiness-checklist).

Provider facts below were **checked on 2026-10-17** against the linked official pages. Prices and
free tiers change, so re-check before you rely on them.

## Billing at a glance

| Step | Needs a billing account or payment method? |
|---|---|
| 1 Firebase project + web app | **No** (Spark plan) |
| 2 Auth (Google sign-in) | **No** |
| 3 Firestore (default) database | **No** |
| 4 Rules + indexes deploy | **No** · TTL policy: **Yes (Blaze)** |
| 5 Service account key | **No** |
| 6 API on Render | Free instance: payment method not required by the docs (see note) · production instance: **Yes** ($7/mo) |
| 7 Web app | Cloudflare Pages / Firebase Hosting: **No** · Vercel for a commercial app: **Yes** (Pro) |
| 8 Widget hosting | **No** (served by the API or the same static host) |
| 9–11 Config, publish, test | **No** |
| 12 Monitoring | **No** · budget alerts only matter on Blaze |
| 13 Keep-awake pinging | **No**, but the real fix is a paid instance |
| 14 Backups/exports | **Yes (Blaze)** + Cloud Storage bucket |
| 15 Moving hosts | Depends on the host |
| AI provider | Recommended paid tier: **Yes** (usage-billed; see AI_PROVIDERS.md) |

### Firebase Spark vs Blaze (checked 2026-10-17)

| | Spark (no cost, no card) | Blaze (pay-as-you-go, card required) |
|---|---|---|
| Firestore free quota (Standard edition, one free database per project) | 1 GiB stored · 50,000 reads/day · 20,000 writes/day · 20,000 deletes/day · 10 GiB egress/month. Resets around midnight Pacific. | **The same free quota**, then pay per use. asia-south1 example: $0.035 per 100k reads, $0.104 per 100k writes, $0.012 per 100k deletes, $0.104 per GiB-month. |
| Over the quota | Usage of that product is shut off until the quota resets. Firestore resets daily. | Billed. |
| Named (non-default) databases | No | Yes, but they don't get the free quota |
| TTL deletes, PITR, scheduled backups, export/import | **No** | Yes |
| Cloud Storage for Firebase (even default buckets) | **No.** Blaze has been required since 2026-02-03 for existing buckets. | Yes |
| Auth email sending per day | Verification 1,000 · password reset 150 · email-link 5 | 100,000 · 10,000 · 25,000 |

Sources:
- https://firebase.google.com/docs/firestore/quotas
- https://cloud.google.com/firestore/pricing
- https://firebase.google.com/pricing
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://firebase.google.com/docs/auth/limits
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024

ChatPilot does not use Cloud Storage, so **Spark is enough to launch**. Move to Blaze when you need
TTL policies or backups, or when you outgrow 50k reads/day. One widget page view costs about two
reads (config pointer + version). A chat message costs a few reads and writes, so a busy day with
5,000 messages can approach the read quota.

---

## 1. Create the Firebase project
*Requires billing? **No.***

1. https://console.firebase.google.com → **Add project**. Name it, e.g. `chatpilot-prod`. Analytics is optional.
2. **Project settings → General → Your apps → Web (`</>`)** → register an app. Hosting setup is not needed here. Copy the config into the web env:
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
3. Locally: `cp .firebaserc.example .firebaserc` and set your project id. Then `npx firebase login`.
4. Optional: create a second project for staging (`chatpilot-staging`).

## 2. Authentication: Google sign-in, authorized domains
*Requires billing? **No.***

Owners sign in with **Google only**. The dashboard has no email/password form, and the API rejects
Firebase tokens whose `firebase.sign_in_provider` is not `google.com` (`403 google_sign_in_required`).
Custom tokens minted with the service account are also accepted, for the smoke test and admin tooling.

1. **Authentication → Sign-in method → Google → Enable.** Set the project's public-facing name and support email.
2. **Disable Email/Password** on the same page (and leave email-link sign-in off). Users created with a
   password can sign in with Google using the same address: with *One account per email address*
   (the default), Firebase links the Google login to the existing user, so the `uid` and their data stay the same.
3. **Authentication → Settings → Authorized domains** (the newer console may group this under *Security*). Add:
   - your app domain (`app.example.com`)
   - the static-host domain (`<project>.pages.dev`, `<project>.web.app` or `<project>.vercel.app`)
   - `localhost` if you test Firebase mode locally. Projects created after 2025-04-28 don't include `localhost` by default.

   The Google popup fails with `auth/unauthorized-domain` on any domain that isn't listed. Every time the
   dashboard domain changes, add it here **and** to the API's `FRONTEND_URLS` / `PUBLIC_APP_URL` (§9).
4. **Restrict the browser API key:** Google Cloud Console → APIs & Services → Credentials → *Browser key* →
   set application restrictions to HTTP referrers (your domains), and API restrictions to Identity Toolkit API and Token Service API.

The upgrade to Identity Platform is **not** needed for Google sign-in.

## 3. Create Firestore
*Requires billing? **No** for the `(default)` database.*

1. **Build → Firestore Database → Create database.**
2. Edition: **Standard** (formerly "Native mode"). Don't choose Enterprise/MongoDB compatibility.
3. Database ID: `(default)`. Named databases need billing and get no free quota.
4. Location: **`asia-south1` (Mumbai)** for India-centric users. This **cannot be changed later**.
   Pick the same broad region as the API host. Render's closest region is Singapore.
5. Start in **production mode**. Our deny-all rules replace the defaults in step 4.

CLI alternative: `gcloud firestore databases create --database="(default)" --location=asia-south1 --edition=standard`

## 4. Deploy rules, indexes and TTL
*Requires billing? Rules and indexes **No** · TTL **Yes (Blaze)**.*

```bash
npx firebase deploy --only firestore            # rules + indexes from firebase.json
# or separately:
npx firebase deploy --only firestore:rules
npx firebase deploy --only firestore:indexes
```

- `firebase.json` points to `firebase/firestore.rules` (deny all) and `firebase/firestore.indexes.json`.
- Index builds take minutes. Watch **Firestore → Indexes** until every index is *Enabled*.
- **Do not** run a bare `firebase deploy`. `firebase.json` also declares storage rules, and Storage
  needs Blaze plus a bucket, so the storage deploy fails on Spark. Always use `--only`.

**TTL policy** (optional backstop for demo bots; the API's hourly cleanup is the primary mechanism):

```bash
gcloud firestore fields ttls update expiresAt --collection-group=chatbots --enable-ttl --project=<project-id>
```

Console alternative: Firestore → **Time-to-live** → Create policy → collection group `chatbots`, field `expiresAt`.

Facts (https://firebase.google.com/docs/firestore/ttl):
- The field must be a **Timestamp**.
- Deletion happens "typically within 24 hours" after expiry.
- **Subcollections are not deleted.**
- TTL deletes are billed as deletes and have no free quota, so billing must be enabled.

## 5. Service account → backend secrets
*Requires billing? **No.***

1. **Project settings → Service accounts → Generate new private key.** A JSON file downloads.
   Keep it out of the repo. `service-account*.json` is git-ignored.
2. Copy three values from the JSON into the backend env:
   - `FIREBASE_PROJECT_ID` = `project_id`
   - `FIREBASE_CLIENT_EMAIL` = `client_email`
   - `FIREBASE_PRIVATE_KEY` = `private_key` **with newlines escaped as `\n`** on one line.
3. Print the escaped key:
   ```bash
   node -e "console.log(JSON.stringify(require('./service-account.json').private_key))"
   ```
   Paste the output **without** the surrounding double quotes into the Render env var. The API turns `\n` back into newlines.
   Alternative: upload the JSON with Render's *Secret Files* feature and set `GOOGLE_APPLICATION_CREDENTIALS` to its path.
4. Delete the downloaded file from your Downloads folder once it's stored in your password manager.
5. Rotation: see [OPERATIONS.md](OPERATIONS.md#rotating-secrets).

## 6. Deploy the API to Render
*Requires billing? Free instance: the docs don't require a payment method (anecdotal reports of card verification are unverified). Production instance: **Yes**.*

1. Push the repo to GitHub.
2. Render Dashboard → **New → Blueprint** → select the repo. Render reads [`render.yaml`](../render.yaml):
   - `runtime: node`, `region: singapore`, `rootDir: .`
   - build: `npm ci --include=dev && npm run build -w @chatpilot/widget && npm run build -w @chatpilot/api`.
     `--include=dev` is needed because `NODE_ENV=production` would otherwise skip the build tools.
   - start: `npm run start -w @chatpilot/api`, `healthCheckPath: /health`
   - Render prompts once for every `sync: false` value: URLs, Firebase credentials and AI settings.
     It generates `CONVERSATION_SECRET` and `ADMIN_TOKEN`.
3. After the first deploy, note the URL (`https://chatpilot-ai-api.onrender.com`). Set `PUBLIC_API_URL` and
   `PUBLIC_WIDGET_URL=<api>/widget.js`, then redeploy.
4. Verify:
   - `curl https://<api>/health` returns 200
   - `curl -I https://<api>/widget.js` returns 200 with `application/javascript`
5. Optional custom domain: Settings → Custom Domains (`api.example.com`). Custom domains are allowed on free instances.

**Free instance behaviour** (https://render.com/docs/free, checked 2026-10-17):
- It **spins down after 15 minutes without inbound traffic**. The next request waits **about one minute**.
  The first widget load after idle shows the error/retry state or a long spinner.
- 750 free instance hours per workspace per month. When they run out, free services are suspended until the next month.
- Render "might restart a Free web service at any time". The filesystem is ephemeral. Free services run one instance only.
- Render's own words: *"Do not use them for production applications."* The ToS has no explicit
  commercial-use ban for the free tier. The docs advise against production use and the
  Acceptable Use Policy prohibits bypassing usage restrictions (https://render.com/acceptable-use).
- In-process crawl jobs are lost on every spin-down or restart. Users see them as *failed* and can retry.

**Production recommendation:** change `plan: free` to **`starter`** (legacy alias of `0.5c-512mb`: 0.5 CPU,
512 MB, **$7/month**, prorated per second). It does not spin down. The Hobby workspace plan is $0, so the
total is $7/month (https://render.com/pricing). Hobby includes 5 GB bandwidth and 500 build minutes.
Watch bandwidth: `widget.js` downloads count. Put it on a CDN (step 8) if it grows.

## 7. Deploy the web app (dashboard, landing page, hosted chat page)
*Requires billing? Cloudflare Pages / Firebase Hosting: **No** · Vercel for a commercial app: **Yes***

**Vercel Hobby is not allowed here.** The Fair Use Guidelines say: *"Hobby teams are restricted to
non-commercial personal use only. All commercial usage of the platform requires either a Pro or
Enterprise plan."* Selling subscriptions or advertising a service counts as commercial use
(https://vercel.com/docs/limits/fair-use-guidelines, checked 2026-10-17). Vercel Pro costs **$20/month
per developer seat** (https://vercel.com/pricing). Use Pro, or one of these free options.

Build (all options), with production values for the env vars:

```bash
VITE_API_URL=https://<api> VITE_WIDGET_URL=https://<api>/widget.js VITE_PUBLIC_APP_URL=https://<app> \
VITE_AUTH_MODE=firebase VITE_FIREBASE_API_KEY=... VITE_FIREBASE_AUTH_DOMAIN=... \
VITE_FIREBASE_PROJECT_ID=... VITE_FIREBASE_APP_ID=... VITE_PRODUCT_NAME="ChatPilot AI" \
npm run build -w @chatpilot/web          # → apps/web/dist
```

`VITE_*` values are baked in at build time, so a change needs a rebuild.

### Option A: Cloudflare Pages (recommended free option)

- Pages Free limits: 500 builds/month; static requests are free and unlimited
  (https://developers.cloudflare.com/pages/platform/limits/, https://developers.cloudflare.com/pages/functions/pricing/).
- Cloudflare now suggests Workers static assets for *new* projects (https://developers.cloudflare.com/pages/).
  Pages still works. On Workers, set `[assets] not_found_handling = "single-page-application"`.
- Terms (https://www.cloudflare.com/terms/ §2.2.1(h)) prohibit *collecting card details on a web
  property that uses Free Services*. Use a **redirect/hosted** payment page (see [MONETIZATION.md](MONETIZATION.md)),
  never card fields on your site.

Setup:
1. Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose the repo.
2. Framework preset: *None*. Build command: `npm ci && npm run build -w @chatpilot/web`. Output directory: `apps/web/dist`.
3. Add the `VITE_*` variables under **Settings → Variables**. Also set `NODE_VERSION=22`.
4. **SPA routing:** with no top-level `404.html`, Pages treats the site as an SPA and serves `/` for unknown paths
   (https://developers.cloudflare.com/pages/configuration/serving-pages/). Don't add a `404.html`.
5. Custom domain: `app.example.com`. Then add it to Firebase authorized domains and to the API's `FRONTEND_URLS`.

### Option B: Firebase Hosting (same project, Spark)

- Spark: 10 GB storage and about 10 GB/month transfer. The docs state the transfer as "10 GB/month" or "360 MB/day"
  (https://firebase.google.com/docs/hosting/usage-quotas-pricing).
- Over quota, the site is disabled until next month. Commercial use on Spark is fine: Firebase says you
  "can use the Spark pricing plan in production apps".

```bash
npm run build -w @chatpilot/web
npx firebase deploy --only hosting      # firebase.json: public apps/web/dist + SPA rewrite ** → /index.html
```

### Option C: Vercel Pro

1. Import the repo. Root directory: repo root.
2. Build command: `npm run build -w @chatpilot/web`. Output: `apps/web/dist`.
3. Add a `vercel.json` with the SPA rewrite:
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```

## 8. Build and host the widget
*Requires billing? **No.***

- **Default:** the API serves `apps/widget/dist/widget.js` at `/widget.js` and `/widget/v1/widget.js`.
  It's built in the Render build command. Set `PUBLIC_WIDGET_URL=https://<api>/widget.js`.
  - Cons: every widget load hits the API instance, and its bandwidth counts against Render's quota.
  - On a sleeping free instance, the script itself takes about a minute to load.
- **CDN (recommended once live):** copy `apps/widget/dist/widget.js` into the static host, e.g. `apps/web/dist/widget/v1/widget.js`
  as a post-build step, or a separate Pages project. Set `PUBLIC_WIDGET_URL=https://<app>/widget/v1/widget.js`
  and `VITE_WIDGET_URL` to the same value.
  - The script then loads instantly even while the API wakes up, and the widget shows its retry state.
  - Build it with `WIDGET_DEFAULT_API_URL=https://<api>` so snippets without `data-api-url` still work.
- Existing snippets keep working as long as the old URL keeps serving the file. Don't delete old paths.

## 9. CORS and public URLs
*Requires billing? **No.***

| Variable | Where | Value |
|---|---|---|
| `FRONTEND_URLS` | API | `https://app.example.com` (comma-separate staging or `*.pages.dev` preview origins explicitly; no wildcards) |
| `PUBLIC_APP_URL` | API | `https://app.example.com` (used for hosted URLs `/chat/<publicId>`) |
| `PUBLIC_API_URL` | API | `https://api.example.com` |
| `PUBLIC_WIDGET_URL` | API | `https://api.example.com/widget.js` or the CDN URL |
| `TRUST_PROXY` | API | `1` on Render |
| `VITE_API_URL` / `VITE_WIDGET_URL` / `VITE_PUBLIC_APP_URL` | Web build | same values |
| Firebase authorized domains | Console | app domain(s) |

Private routes allow only `FRONTEND_URLS`. Public routes (`/api/public/*`) accept any origin, then apply
each chatbot's `allowedOrigins`. A CORS error in the dashboard almost always means an exact-origin mismatch
(scheme, `www`, port or trailing slash).

## 10. Create and publish a chatbot
*Requires billing? **No.***

1. Open `https://<app>` → **Register**. Verify your email: Firebase sends it, so check spam.
2. **New chatbot** → enter the website URL and business name → wait for the crawl. If the site is
   JavaScript-heavy and little text is found, add FAQ or manual content.
3. Review the knowledge: exclude junk pages and add FAQs.
4. Configure the colour, welcome message and lead capture → **Preview** on desktop and mobile → send test questions.
5. **Publish** → copy the embed code and the hosted link.

## 11. Test the widget on a separate website
*Requires billing? **No.***

- `apps/widget/demo/index.html`: set `data-chatbot-id` and `data-api-url`, then serve it from another origin
  (`npx serve apps/widget/demo`) or open the file directly.
- Or paste the snippet into a CodePen HTML panel or any static site (e.g. a throwaway Pages project).
- Check:
  - the launcher appears;
  - the reply cites sources;
  - the conversation shows in the **Inbox**;
  - a submitted lead shows in **Leads**;
  - **Install status** shows the origin.
- If you set `allowedOrigins`, confirm that an unlisted origin is rejected.

## 12. Monitoring logs and quotas
*Requires billing? **No**. Budget alerts are only relevant on Blaze.*

| What | Where |
|---|---|
| API logs and errors | Render → service → **Logs**. Add a log drain or Better Stack/Axiom later. Look for `ai_unavailable`, `quota_exceeded`, crawl failures and 5xx. |
| Health | `GET /health`. Add an uptime monitor (UptimeRobot free: 50 monitors at 5-minute intervals; its current terms allow commercial use, https://uptimerobot.com/terms/). |
| Firestore usage | Firebase console → Firestore → **Usage**. Compare with 50k reads, 20k writes and 20k deletes per day. |
| Auth | Authentication → Users, plus the usage tab |
| AI spend | Provider dashboard; set its spend cap or alerts |
| Google Cloud budgets | Billing → Budgets & alerts. **Alerts-only budgets do not cap spending** (https://docs.cloud.google.com/billing/docs/how-to/budgets). Spend caps exist only for some Firebase products and **not Firestore** (https://firebase.google.com/docs/projects/billing/avoid-surprise-bills). |
| Product usage | Dashboard → usage per owner (`usage/{owner}_{YYYY-MM}`) |

## 13. Handling a sleeping or unavailable backend
*Requires billing? **No** for pinging · a paid instance is the fix.*

What visitors see when the API is asleep or down: the widget shows *"We're having trouble connecting"*
with **Retry**, and never breaks the host page. The dashboard shows a "server waking up" message.

| Option | Cost | Trade-off |
|---|---|---|
| Accept cold starts | $0 | First visitor after 15 minutes idle waits about a minute. Fine for a demo, bad for customers. |
| In-app keep-warm (built in) | $0 | The dashboard pings `/health` on every page load (landing, auth pages, hosted chat) and every ~4.5 min while a signed-in user has a visible tab, so a cold start begins while the visitor reads the page. Auth pages show "Waking up the server…" if `/health` takes over 3 s. Covers active use only. Off against a localhost API. |
| Ping `/health` every 5 min (UptimeRobot or a cron) | $0 | Keeps one free instance up ~24/7, using about 720–744 of the 750 monthly free hours, so nothing is left for a second free service. Render may still restart it anytime. Render's AUP forbids bypassing usage restrictions, and staff have reportedly called arbitrary keep-awake pinging abuse (not verified on an official page). **Not recommended** for a business. |
| **Paid Starter instance** | $7/mo | No spin-down. **Recommended for launch.** |
| Widget on a CDN (step 8) | $0 | The script loads instantly and the retry state is shown while the API wakes up |

## 14. Backups and exports
*Requires billing? **Yes (Blaze)** + a Cloud Storage bucket.*

- **Managed export/import:** *"Only Google Cloud projects with billing enabled can use the export and
  import functionality. Firebase projects must be on the Blaze plan."* It also needs a Cloud Storage bucket
  in a compatible location. Each exported document is billed as one read
  (https://firebase.google.com/docs/firestore/manage-data/export-import).
  ```bash
  gsutil mb -l asia-south1 gs://<project>-firestore-backups
  gcloud firestore export gs://<project>-firestore-backups/$(date +%F) --project=<project>
  gcloud firestore import gs://<project>-firestore-backups/2026-10-17 --project=<project>
  ```
- **Scheduled backups** (Blaze; retention up to 14 weeks; backups don't include TTL policies):
  `firebase firestore:backups:schedules:create --database "(default)" --recurrence DAILY --retention 14w`
  (https://firebase.google.com/docs/firestore/backups).
- **PITR** (point-in-time recovery: a 7-day window to undo bad writes) needs billing
  (https://firebase.google.com/docs/firestore/pitr).
- **On Spark:** there are no managed backups. Run a small Admin SDK script that streams each collection
  to JSON on your machine. Reads count against the 50k/day quota, so run it off-peak.
  Treat that file as sensitive: it contains leads.
- Re-deploy rules and indexes from git after any restore.

## 15. Migrating hosting (free → paid, or off Render)
*Requires billing? Depends on the target.*

- **Free → paid on Render:** change `plan: free` to `plan: starter` in `render.yaml` (or Settings → Instance type).
  No downtime is needed and the URL stays the same.
- **Off Render:** the API is a plain Node 22 HTTP server. It reads `PORT`, stores no local state in
  production (Firestore), and exposes `/health`. Any container host works: Google Cloud Run in
  `asia-south1` next to Firestore, Fly.io, Railway, or a VPS with Docker.
- Before switching, point the custom domain `api.example.com` at the new host (DNS). Snippets that use the
  custom domain keep working; snippets with `onrender.com` URLs need the old service kept alive or the
  widget on a CDN that you control. **Use a custom API domain from day one.**
- Multiple instances: switch rate limiting to a shared store and move crawl jobs to a queue
  ([OPERATIONS.md](OPERATIONS.md#scaling-notes)).

Dockerfile for the API. Save it as `apps/api/Dockerfile` (the API owner maintains it) and build from the
**repo root**: `docker build -f apps/api/Dockerfile -t chatpilot-api .`

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/widget/package.json apps/widget/
COPY apps/web/package.json apps/web/
RUN npm ci --include=dev
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/widget apps/widget
RUN npm run build -w @chatpilot/widget && npm run build -w @chatpilot/api \
 && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/widget/dist ./apps/widget/dist
WORKDIR /app/apps/api
USER node
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
```

The API build (tsup) must **bundle `@chatpilot/shared`**, because the shared package ships TypeScript
source. Otherwise Node can't import it at runtime. Pass env vars with `--env-file` or the host's secret manager.

---

## Launch readiness checklist

Deploying successfully only proves the pieces start. Before taking paying customers:

**Infrastructure**
- [ ] API on a paid, always-on instance. No cold starts.
- [ ] Custom domains for the app and API. HTTPS everywhere.
- [ ] Web app on a host whose terms allow commercial use (not Vercel Hobby).
- [ ] Widget served from a CDN path with a stable URL (`/widget/v1/widget.js`).
- [ ] Firestore in the intended region, deny-all rules deployed, all indexes *Enabled*.
- [ ] Blaze with a budget alert, if you want TTL, backups or PITR (recommended once you have customers).
- [ ] Backups: a scheduled backup or a tested export/import restore.

**Configuration**
- [ ] `NODE_ENV=production`, `AUTH_MODE=firebase`, `DATA_STORE=firestore`, a real AI provider (paid tier). The API starts.
- [ ] `FRONTEND_URLS`, `PUBLIC_*` and `VITE_*` URLs are correct. Firebase authorized domains are trimmed.
- [ ] `TRUST_PROXY=1` (check that client IPs in the logs are real).
- [ ] Rate limits and plan quotas are tuned. An AI spend cap is set at the provider.
- [ ] Email templates, sender name and action URL are set. A test sign-up email arrives in the inbox, not spam.

**Product verification**
- [ ] End-to-end on production: register, verify, crawl a real site, publish, embed on another site,
      chat, see the inbox and leads, export CSV, delete a conversation, delete the account.
- [ ] Widget tested on mobile (iOS Safari, Android Chrome) and desktop, and on a site with a CSP.
- [ ] Crawl edge cases: robots-blocked site, JS-only site (shows a hint), a 404 URL, and a slow site.
- [ ] AI provider outage simulated (bad key): the bot answers with the fallback message and nothing crashes.

**Security & legal:** the full [SECURITY.md checklist](SECURITY.md#pre-launch-security-checklist), plus
a privacy policy, terms, a refund policy (required by payment providers), and a sub-processor list.

**Operations:** uptime monitor on `/health`, a log-review routine, and the runbook read
([OPERATIONS.md](OPERATIONS.md)).
