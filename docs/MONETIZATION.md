# Monetization

Status: **plans and quotas are enforced; billing is not wired yet.** Prices in `DEFAULT_PLANS` are
display values. This document covers plan configuration and enforcement, and gives a verified plan
for adding payments as an India-based business.

## Plans

The default catalogue lives in [`packages/shared/src/plans.ts`](../packages/shared/src/plans.ts):

| Plan | ₹/mo (display) | Bots | Msgs/mo | Crawls/mo | Pages/crawl | Leads/mo | Knowledge chars/bot | Retention | Branding off | CSV | allowedOrigins |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `free` | 0 | 1 | 100 | 5 | 15 | 25 | 150k | 30 d | – | – | – |
| `starter` | 999 | 1 | 1,000 | 20 | 50 | 500 | 500k | 90 d | – | ✓ | ✓ |
| `pro` | 2,499 | 5 | 5,000 | 60 | 100 | 5,000 | 1.5M | 180 d | ✓ | ✓ | ✓ |
| `business` | contact | 25 | 25,000 | 200 | 200 | 25,000 | 3M | 365 d | ✓ | ✓ | ✓ |

### Overriding plans at runtime (no code change)

1. **`PLANS_JSON`** env var: a JSON array of complete `Plan` objects, which replaces the defaults. Use it to
   change prices or limits with a redeploy:
   ```bash
   PLANS_JSON='[{"id":"free","name":"Free Trial","description":"…","priceMonthly":0,"currency":"INR","limits":{"chatbots":1,"messagesPerMonth":50,"crawlsPerMonth":3,"pagesPerCrawl":10,"leadsPerMonth":10,"knowledgeCharsPerBot":100000,"retentionDays":14},"features":{"leadCapture":true,"removeBranding":false,"csvExport":false,"allowedOrigins":false}}, …]'
   ```
2. **Firestore `plans/{planId}`** documents: optional overrides, editable in the Firebase console without
   a redeploy. The API may cache them for a few minutes.

Intended precedence: `plans/{id}` → `PLANS_JSON` → `DEFAULT_PLANS`. Confirm this against the API's plan
loader. The UI must always read plans from `GET /api/plans` and never hard-code prices.

A user's plan is `users/{uid}.planId`, which defaults to `free`. Only the server changes it: an admin
action now, a payment webhook later.

## How quotas are enforced

| Limit | Checked when | Error |
|---|---|---|
| `chatbots` | `POST /api/chatbots` | `403 quota_exceeded` (`metric: chatbots`) |
| `messagesPerMonth` | each public chat message **and** each Preview Studio message | `429 quota_exceeded`. The widget shows a polite "unavailable" message. |
| `crawlsPerMonth`, `pagesPerCrawl` | `POST …/crawl`. `maxPages` is clamped to the plan and to `MAX_CRAWL_PAGES`. | `quota_exceeded` |
| `leadsPerMonth` | `POST …/leads` | `quota_exceeded` |
| `knowledgeCharsPerBot` | adding sources and crawl ingestion. Ingestion stops when the limit is reached. | `quota_exceeded` / the job notes it |
| `retentionDays` | periodic cleanup job | — |
| Features (`removeBranding`, `csvExport`, `allowedOrigins`) | config save and the export route | `403 forbidden` |

- Usage counters live in `usage/{ownerId}_{YYYY-MM}` (UTC month) and are incremented with
  `FieldValue.increment`. `resetAt` is the first day of the next month.
- `QuotaErrorDetails` is `{ metric, limit, used, resetAt, planId }`. The dashboard uses it to show an upgrade prompt.
- Check-then-increment is not transactional, so under concurrency an owner can go a few messages over
  the limit. That's acceptable for SMB plans. Use a transaction if exact limits ever matter.
- AI cost guardrails are separate from plans: `MAX_OUTPUT_TOKENS`, `AI_MAX_CONCURRENCY` and the
  provider spend cap ([AI_PROVIDERS.md](AI_PROVIDERS.md)).

## Payment integration plan

### Options for an India-based seller (checked 2026-10-17)

| Provider | Fit | Fees (excl. GST) | Notes | Sources |
|---|---|---|---|---|
| **Razorpay Subscriptions** | **INR customers (primary)** | Standard 2% per successful transaction; international cards up to 3%; subscriptions on cards "0.9% + platform fees". Whether that 0.9% is on top of the 2% is unclear on the page, so confirm with Razorpay. UPI/NACH/e-mandate pricing is on request. 18% GST on fees. | Cards (Visa/MC/RuPay standing instructions), UPI AutoPay (early access), and e-mandate (limited access) need account enablement. UPI subscriptions are INR-only and capped at ₹15,000 per debit. International cards need extra activation: KYC, and website Terms/Privacy/Refund/Shipping pages are mandatory. Webhooks: `subscription.activated`, `.charged`, `.pending`, `.halted`, `.cancelled`, etc. | https://razorpay.com/pricing/ · https://razorpay.com/docs/payments/subscriptions/supported-payment-methods/ · https://razorpay.com/docs/payments/subscriptions/faqs/ · https://razorpay.com/docs/webhooks/subscriptions/ · https://razorpay.com/docs/payments/international-payments/international-debit-credit-cards/ |
| **Paddle** (merchant of record) | International customers. Paddle handles global VAT/sales tax. | 5% + 50¢ per checkout transaction | Accepts software/SaaS sellers worldwide except listed countries, and India is not excluded. **Payouts are not in INR**: you receive USD (or another listed currency) by bank/wire. Domain review requires a live site with pricing, Terms, Refund and Privacy pages, plus your legal name in the Terms. Generative-AI products may face extra checks. | https://www.paddle.com/pricing · https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle · https://www.paddle.com/help/manage/get-paid/can-i-be-paid-in-my-local-currency · https://www.paddle.com/help/start/account-verification/what-is-domain-verification |
| **Dodo Payments** (MoR) | International alternative | India domestic 4% + 15¢; US cards 4% + 40¢; +1.5% for international cards, +0.5% for subscriptions; payout fees apply | India is an accepted merchant country. Payouts only in USD/GBP/EUR, and the INR wallet has been discontinued. | https://dodopayments.com/pricing · https://docs.dodopayments.com/miscellaneous/accepted-countries-and-territories · https://docs.dodopayments.com/miscellaneous/faq |
| **Polar** (MoR) | International alternative | Starter 5% + 50¢ (+1.5% for non-US cards); cheaper tiers from $20/mo; Stripe payout fees passed through | Lists India for payouts. | https://polar.sh/docs/fees · https://polar.sh/docs/merchant-of-record/supported-countries |
| **Lemon Squeezy** (MoR) | Not recommended now | 5% + 50¢ | Sellers from India without an approved Stripe account must use **PayPal payouts**. It is moving users to Stripe Managed Payments, which does **not** support India-based businesses. | https://www.lemonsqueezy.com/pricing · https://docs.lemonsqueezy.com/help/getting-started/supported-countries · https://www.lemonsqueezy.com/blog/2026-update · https://docs.stripe.com/payments/managed-payments/eligibility |
| **Stripe (India)** | Not available by default | — | *"Stripe services are invite-only in India."* New Indian businesses can't sign up on the website and must request an invite through sales. | https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india |
| Cashfree Subscriptions | INR alternative to Razorpay | Per-mandate/per-debit fees (e.g. ₹7.5 + ₹7.5 for cards/eNACH). The fee breakdown wasn't clear, so confirm with Cashfree. | — | https://www.cashfree.com/payment-gateway-charges/ |

**Recommendation:** start with **Razorpay Subscriptions for INR** (the plans are already priced in INR).
Add **Paddle** (or Dodo/Polar) for USD customers once international demand exists, because a merchant
of record removes the work of foreign sales-tax compliance. Prepare the legal pages (Terms, Privacy,
Refund/Cancellation, contact and business name) **before** applying: every provider checks them.

### RBI e-mandate rules (Indian cards and UPI)

Under RBI's *Digital Payments – E-mandate Framework, 2026* (RBI/DPSS/2026-27/396, dated 21 Apr 2026,
https://rbi.org.in/SCRIPTs/BS_ViewMasDirections.aspx?id=13374):
- Recurring debits up to **₹15,000** per transaction run without extra authentication. Above that, the
  customer must authenticate each debit.
- A pre-debit notification must go out at least 24 hours before each charge.

All current plans are below ₹15,000/month. Annual plans above ₹15,000 would need AFA (additional
authentication) on each renewal.

### Implementation sketch (when you build it)

1. Add `billing` fields to `users/{uid}`: `provider`, `customerId`, `subscriptionId`, `status`,
   `currentPeriodEnd` and `planId`. Add a `billingEvents/{eventId}` collection (deny-all rules already cover it).
2. `POST /api/billing/checkout { planId }`: the API creates the subscription or checkout session at the
   provider and returns its **hosted** checkout URL (or the Razorpay Checkout options). The provider's
   page collects all payment details.
3. `POST /api/billing/webhook`: verify the signature over the **raw body** with the webhook secret.
   Make it idempotent: store the event id and skip duplicates. Map events to `planId` and `status`:
   - activated/charged → paid plan
   - pending/halted → grace period, then `free`
   - cancelled → `free` at period end
4. Never upgrade a plan from a client-side "success" redirect. **The webhook is the only source of truth.**
5. Downgrades: keep data and enforce limits going forward (e.g. extra chatbots become read-only or unpublished).
6. Invoices: Razorpay and the MoR providers issue invoices/receipts. Make sure they show your GSTIN once registered.

### Never store card data

Use only provider-hosted checkout (a redirect or the provider's own hosted fields). The PCI SSC says
merchants that fully outsource card handling can qualify for the shortest self-assessment, **SAQ A**.
A **redirect** to the provider's page is the cleanest case. For an *embedded iframe*, the merchant must
also protect the hosting page against script attacks or get confirmation from the provider. Confirm
the applicable SAQ with your acquirer.
- PCI SSC FAQ 1588: https://www.pcisecuritystandards.org/faqs/1588/
- SAQ A: https://listings.pcisecuritystandards.org/documents/PCI-DSS-v4-0-SAQ-A.pdf

Cloudflare's free-plan terms also prohibit collecting card information on a property that uses Free
Services, which is one more reason to redirect. Never log or store card numbers, CVV or UPI PINs. Store
only provider ids.

## GST (India): consult a Chartered Accountant

Basics checked against CBIC sources on 2026-10-17. **This is not tax advice.**

| Rule | Detail | Source |
|---|---|---|
| Registration threshold | Aggregate turnover above **₹20 lakh** (₹10 lakh in special-category States) | CGST Act s.22: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter6/section22_v1.00.html |
| Inter-State supplies | s.24 makes registration compulsory for inter-State taxable supplies. Notification 10/2017-IT exempts inter-State *service* suppliers under the threshold. Whether it has been amended since was not verified. | https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter6/section24_v1.00.html · https://cbic-gst.gov.in/hindi/pdf/integrated-tax/10_2017_IT.pdf |
| Exports of services | Zero-rated when the IGST s.2(6) conditions are met: recipient outside India, payment in convertible foreign exchange, and so on. You can export without paying IGST under an **LUT**. | IGST s.2(6), s.16 |
| MoR sales | With Paddle, Dodo or Polar, the MoR is the seller to the end customer, and you supply services to the MoR. Your CA should confirm how that is treated. | — |

The GST rate applicable to SaaS subscriptions was **not verified** here. Ask your CA, along with
TDS/TCS on payment-gateway settlements, invoicing format and place-of-supply rules.
