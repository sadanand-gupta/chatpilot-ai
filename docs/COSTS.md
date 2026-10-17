# Costs

Honest monthly running-cost estimates in USD. List prices were checked on 2026-10-17; sources are in
[DEPLOYMENT.md](DEPLOYMENT.md) and [AI_PROVIDERS.md](AI_PROVIDERS.md). Taxes (GST/VAT) are excluded.
Re-check before you budget: these numbers changed several times in 2026.

## Usage assumptions

| Stage | Customers | Chat messages/mo | Widget page views/day | Notes |
|---|---|---|---|---|
| Launch / pilot | 0–3 | ≤ 1,000 | ≤ 1,000 | Mostly you and test sites |
| ~10 customers | 10 (mostly Starter) | ~10,000 | ~10,000 | 1 API instance |
| ~100 customers | 100 (mix of Starter and Pro) | ~100,000 | ~100,000 | still 1–2 instances |

Firestore usage, rough guide (exact numbers depend on the API's implementation):
- One chat message ≈ 5–8 reads and 3–5 writes.
- One widget page view ≈ 2 reads (config pointer + version), unless the API caches it in memory.
- Rebuilding a bot's BM25 cache reads all of its chunks (e.g. 300–2,000 reads). That happens after
  every restart or spin-down and after every knowledge change.

## Per component

| Component | Launch / pilot | ~10 customers | ~100 customers | Needs a card? |
|---|---|---|---|---|
| **API hosting (Render)** | Free $0. Spins down after 15 min and Render says it is not for production. Or Starter **$7**. | Starter **$7** (0.5 CPU, 512 MB) | 2 GB instance (Render "Standard", `1c-2g`; price **not verified**, check the pricing page) or 2× Starter + Redis | Free: not per the docs · paid: **yes** |
| Render workspace / bandwidth | Hobby $0 (5 GB bandwidth, 500 build min) | Hobby $0, **if `widget.js` is on a CDN** | Likely Pro workspace **$25** (25 GB), or put a CDN/cache in front of `GET /config` | yes (paid) |
| **Web app hosting** | Cloudflare Pages or Firebase Hosting **$0** | $0 | $0 (static requests are unlimited on Cloudflare) | no |
| Widget delivery | from the API, $0 | Cloudflare/Firebase static **$0** | $0 | no |
| **Firebase Auth** | $0 | $0 | $0 (Identity Platform tier 1: no cost up to 50k MAU) | no |
| **Firestore** | Spark **$0** (50k reads, 20k writes, 20k deletes per day; 1 GiB) | Spark $0 is likely enough; **Blaze recommended** for backups, around $0–1 | Blaze, about **$2–10** (asia-south1: $0.035 per 100k reads, $0.104 per 100k writes, $0.104 per GiB-month) | Spark: no · Blaze: **yes** |
| Backups (Blaze) | — | cents (export = 1 read per doc + GCS storage) | ~$1 | yes |
| **LLM** (Gemini 2.5 Flash-Lite, paid tier) | ~$0.25 (1k msgs) | ~$2.30 (10k msgs); budget **~$5** | ~$23 (100k msgs); budget **~$50** | **yes** (Google Cloud billing) |
| LLM, zero-cost alternative | Cloudflare Workers AI free 10k neurons/day ≈ 760 msgs/day (8B model) | still mostly free | exceeds free → Workers Paid ($5 min + usage) | free: no |
| Uptime monitoring | UptimeRobot free (50 monitors, 5 min) | $0 | $0 | no |
| Domain | registrar price, varies by TLD (not verified) | same | same | yes |
| Transactional email | Firebase Auth emails $0 (Spark: 1,000 verification and 150 password-reset emails per day) | $0 | a custom sender domain and an email provider may be needed | — |
| Payments | — | Razorpay ~2% (+0.9% for card subscriptions, to confirm) + 18% GST on fees | same, + MoR 5% + 50¢ for international sales | no card; fees are deducted |
| Vercel (only if you choose it) | Hobby is **not allowed** for commercial use | Pro **$20/seat** | Pro $20/seat + usage | yes |

## Totals (rough)

| Stage | Cheapest possible | Recommended | Revenue at list price |
|---|---|---|---|
| Launch / pilot | **$0**: Render free, Spark, Cloudflare Pages, Workers AI free or the Gemini free tier. *Demo only: cold starts, and the free Gemini tier's data is used for training.* | **~$8/mo**: Render Starter $7 + paid Gemini ~$1 + Spark | — |
| ~10 customers | ~$7 | **~$10–15/mo**: Starter $7, AI ~$5, Blaze with backups ~$1 | 10 × ₹999 ≈ ₹10k/mo |
| ~100 customers | ~$35 | **~$60–120/mo**: a bigger instance or 2 instances + Redis, Pro workspace or CDN, AI ~$25–50, Firestore ~$5–10 | ≈ ₹1.3–1.8 lakh/mo |

Takeaways:
- **The LLM is not the main cost.** At 1.5k input + 200 output tokens per message, cheap models cost
  $0.15–0.35 per 1,000 messages. The fixed costs are **always-on hosting** and your time.
- Two things are worth paying for from day one: an **always-on API ($7)** and the **paid tier of the AI
  provider** (data privacy). Both need a card.
- Bandwidth is the sneaky cost at scale. Serve `widget.js` from a CDN, and cache `GET /config` responses
  for a short time (in memory, or `Cache-Control` behind a CDN).
- Keep plan quotas in line with costs. Free plan: 100 messages/month ≈ $0.02 of AI. The main abuse risk
  is crawl volume and fake accounts, not tokens.

## What is free vs. what needs a card

| Free, no card | Needs a card or billing account |
|---|---|
| Firebase Spark (Auth, Firestore within quota, Hosting) | Firebase Blaze (TTL, backups/export, PITR, Storage, beyond-quota usage) |
| Render free web service (not for production) | Render paid instance ($7+) and Pro workspace |
| Cloudflare Pages / Workers static assets | Cloudflare Workers Paid ($5 min), only if you exceed the Workers AI free allowance |
| Cloudflare Workers AI free allowance | Gemini paid tier (recommended), Groq Developer, OpenAI, Together (≥ $15 prepay) |
| UptimeRobot free | Vercel Pro (if Vercel) |
| GitHub Actions on public repos (private repos get a monthly minutes allowance; check your plan) | Domain name |
