# AI providers

The API talks to LLMs through a small adapter selected by `AI_PROVIDER`:

| `AI_PROVIDER` | Use | Notes |
|---|---|---|
| `openai` | **Production.** Any OpenAI-compatible `POST {AI_BASE_URL}/chat/completions` | OpenAI, Google Gemini (OpenAI-compatible endpoint), Groq, OpenRouter, Together, Cloudflare Workers AI, … |
| `ollama` | Local development only | Runs models on your machine. Not for public production unless you operate your own GPU server (and then it's your capacity/uptime problem). |
| `mock` | Dev & tests | Deterministic replies, no network. **Refused when `NODE_ENV=production`.** |

Environment:

| Var | Example | Meaning |
|---|---|---|
| `AI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Provider base, **without** trailing slash (the adapter appends `/chat/completions`). |
| `AI_API_KEY` | — | Secret. Sent as `Authorization: Bearer …`. |
| `AI_MODEL` | `gemini-2.5-flash-lite` | Model id as the provider names it. |
| `AI_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `AI_MAX_RETRIES` | `2` | Retries on 429/5xx/timeouts with backoff. |
| `AI_MAX_CONCURRENCY` | `4` | Max simultaneous upstream calls per API instance (protects provider rate limits). |
| `MAX_OUTPUT_TOKENS` | `400` | Caps reply length and cost. Reasoning models (e.g. `gpt-oss-*`, `gpt-5-nano`) spend output tokens on reasoning — raise to ~800–1000 for them or replies may be cut off. |
| `AI_TEMPERATURE` | `0.3` | Low = more factual/grounded. |

When the provider fails after retries, the visitor gets the bot's `fallbackMessage` (`fallback: true`)
and `usage.failedRequests` increments — chats never hard-fail.

## Provider configuration (verified 2026-10-17)

| Provider | `AI_BASE_URL` | Example `AI_MODEL` | Source |
|---|---|---|---|
| Google Gemini API | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite` | https://ai.google.dev/gemini-api/docs/openai |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-20b`, `openai/gpt-oss-120b` | https://console.groq.com/docs/openai |
| OpenAI | `https://api.openai.com/v1` | `gpt-4.1-nano`, `gpt-4o-mini`, `gpt-5-nano` | https://developers.openai.com/api/reference/overview |
| OpenRouter | `https://openrouter.ai/api/v1` | any `vendor/model` or `…:free` | https://openrouter.ai/docs/quickstart |
| Together AI | `https://api.together.ai/v1` (changed from `api.together.xyz`) | e.g. Llama 3 8B Instruct Lite | https://docs.together.ai/docs/openai-api-compatibility |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1` | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (check the model catalog for exact ids) | https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/ |
| Ollama (local) | `http://localhost:11434` (`AI_PROVIDER=ollama`) | `llama3.2:3b` | — |

> **Groq model retirement:** Groq announced that `llama-3.1-8b-instant` and `llama-3.3-70b-versatile`
> are retired for free/Developer tiers as of 2026-08-16, with `openai/gpt-oss-20b` / `openai/gpt-oss-120b`
> as replacements (https://console.groq.com/docs/deprecations, checked 2026-10-17). Older tutorials that
> use the Llama ids will fail.
>
> **Gemini model churn:** Gemini 2.0 Flash is shut down; 2.5 Flash-Lite is listed as served until further
> notice, and Google recommends the newer Flash-Lite versions for new projects
> (https://ai.google.dev/gemini-api/docs/models, checked 2026-10-17). Re-check before launch.

## Free tiers & commercial-use terms (checked 2026-10-17)

| Provider | Free tier | Commercial use / data use | Sources |
|---|---|---|---|
| **Google Gemini API** | Yes — Flash/Flash-Lite models marked "Free of charge" on the free tier. Google does not publish fixed RPM/RPD numbers; they're shown per project in AI Studio (daily limits reset at midnight Pacific). Exact free limits: **not verified**. | Free tier ("Unpaid Services"): Google **uses prompts and responses to improve products, and human reviewers may read them**; Google says not to submit sensitive, confidential or personal information. Paid tier: not used to improve products; logged for a limited period for abuse detection. **Apps made available to users in the EEA, Switzerland or the UK must use Paid Services only.** Must be 18+; service is for professional/business use. India is an available region. No explicit ban on commercial use of the free tier — but it is **unsuitable for customer data** (business content + visitor messages/leads). | https://ai.google.dev/gemini-api/terms · https://ai.google.dev/gemini-api/docs/pricing · https://ai.google.dev/gemini-api/docs/rate-limits · https://ai.google.dev/gemini-api/docs/available-regions |
| **Groq** | Free plan exists. Published Developer-plan base limits for gpt-oss-20b/120b: 30 RPM, 1K RPD, 8K TPM, 200K TPD. Free-plan figures: **not verified** — see console.groq.com/settings/limits. 8K TPM ≈ 4–5 RAG messages/minute. | Services Agreement: no explicit ban on production use of free services, but free services carry a capped liability/no indemnity and the agreement forbids use intended to avoid fees. Groq may not use inputs/outputs for training; no inference data retained by default; Zero Data Retention toggle available. | https://console.groq.com/docs/rate-limits · https://console.groq.com/docs/legal/services-agreement · https://console.groq.com/docs/your-data |
| **OpenRouter `:free` models** | 20 RPM; **50 requests/day** if you've bought < 10 credits in total, **1,000/day** after buying ≥ 10. Negative balance → 402 even on free models. | No ban on commercial use, but you must follow each model's own terms; OpenRouter does not guarantee model availability. Free-model providers may log/train — set your privacy/training opt-out in account settings. Not suitable as the primary production model. | https://openrouter.ai/docs/api-reference/limits · https://openrouter.ai/terms · https://openrouter.ai/docs/guides/privacy/data-collection |
| **Cloudflare Workers AI** | **10,000 neurons/day free** on Free and Paid plans. Beyond: $0.011 / 1,000 neurons (Workers Paid, $5/month minimum). 300 RPM default for text models. llama-3.1-8b-fp8-fast ≈ 13 neurons per 1.5k-in/200-out message → ≈ 760 messages/day free. | Cloudflare does not use Workers AI customer content to train models. No free-tier commercial-use restriction found (specific clause not verified). | https://developers.cloudflare.com/workers-ai/platform/pricing/ · https://developers.cloudflare.com/workers-ai/platform/limits/ · https://developers.cloudflare.com/workers-ai/platform/data-usage/ |
| **OpenAI** | No free credits; the "Free" usage tier is a geography-gated spending cap, details not verified. Treat as paid. | Paid API: not used for training unless you opt in; abuse logs up to 30 days. | https://developers.openai.com/api/docs/pricing · https://developers.openai.com/api/docs/guides/rate-limits · https://developers.openai.com/api/docs/guides/your-data |
| **Together AI** | No free trial; minimum first purchase **$15** (prepaid credits). | Training is opt-in; **prompts and responses are stored by default** — an admin can disable storage (ZDR). | https://www.together.ai/pricing · https://docs.together.ai/docs/billing · https://docs.together.ai/docs/privacy-and-security |

## Cost per month (token math)

Assumption (from the product spec): **~1,500 input + ~200 output tokens per message**.

```
per 1,000 messages = 1.5M input tokens + 0.2M output tokens
cost / 1,000 msgs  = 1.5 × (input $/1M) + 0.2 × (output $/1M)
```

Prices USD per 1M tokens, list prices checked 2026-10-17 (before GST/taxes; sources above):

| Model | In / Out $ per 1M | Math (per 1,000) | **1,000 msgs/mo** | **10,000 msgs/mo** |
|---|---|---|---|---|
| Cloudflare `llama-3.1-8b-instruct-fp8-fast` | 0.045 / 0.384 | 0.0675 + 0.0768 | $0.14 | $1.44 list — **≈ $0** within the free 10k neurons/day (≈333 msgs/day) |
| OpenAI `gpt-5-nano` (reasoning; real output higher) | 0.05 / 0.40 | 0.075 + 0.08 | $0.16 | $1.55+ |
| Groq `openai/gpt-oss-20b` | 0.075 / 0.30 | 0.1125 + 0.06 | $0.17 | $1.73 |
| **Gemini `gemini-2.5-flash-lite` (paid)** | 0.10 / 0.40 | 0.15 + 0.08 | **$0.23** | **$2.30** |
| OpenAI `gpt-4.1-nano` | 0.10 / 0.40 | 0.15 + 0.08 | $0.23 | $2.30 |
| Together Llama 3 8B Instruct Lite | 0.14 / 0.14 | 0.21 + 0.028 | $0.24 | $2.38 |
| Groq `openai/gpt-oss-120b` | 0.15 / 0.60 | 0.225 + 0.12 | $0.35 | $3.45 |
| OpenAI `gpt-4o-mini` | 0.15 / 0.60 | 0.225 + 0.12 | $0.35 | $3.45 |
| Gemini `gemini-3.1-flash-lite` (paid) | 0.25 / 1.50 | 0.375 + 0.30 | $0.68 | $6.75 |
| OpenRouter `:free` | 0 | — | $0 | $0 but 1,000 req/day cap (after buying 10 credits), no availability guarantee |

Reality check: retrieving 4–5 chunks of ≤1,500 chars plus the system prompt and history is often
**2–3k input tokens**, and retries/preview messages add more. Budget **2× the table**: even then
10,000 messages/month on Gemini 2.5 Flash-Lite is ≈ **$5/month**. The AI bill is not the main
launch cost — hosting is ([COSTS.md](COSTS.md)).

## Recommendation

| Role | Choice | Why |
|---|---|---|
| **Launch default** | **Gemini `gemini-2.5-flash-lite` on the paid tier** (enable billing on the AI Studio / Google Cloud project) | ≈ $0.23 per 1,000 messages; paid-tier data not used for product improvement; usable for EEA/UK/CH users; India supported; OpenAI-compatible. Plan an upgrade path to `gemini-3.1-flash-lite` if answer quality needs it. |
| Fallback | **Groq `openai/gpt-oss-20b`** (Developer plan, Zero Data Retention on) | ≈ $0.17 per 1,000 msgs, no training by contract, very fast. Check the org's real TPM limit first; set `MAX_OUTPUT_TOKENS` ≥ 800 (reasoning model). |
| Zero-cost early traffic / staging | Cloudflare Workers AI `llama-3.1-8b-instruct-fp8-fast` | ~760 msgs/day free, no training; 8B-level quality. |
| Avoid as primary | Gemini **free** tier (training + human review of customer data; not allowed for EEA/UK/CH users), OpenRouter `:free` (daily caps, no availability guarantee), Together (stores prompts by default unless disabled). |

**Before launch:** set a spend cap/budget alert at the provider, list the provider as a sub-processor
in your privacy policy, and re-verify prices — they changed several times in 2026.

### Switching providers

Only env vars change (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, maybe `MAX_OUTPUT_TOKENS`) → redeploy.
Test with the dashboard Preview Studio before publishing. Answers will differ slightly between models;
the grounding/fallback rules in the system prompt are provider-independent.
