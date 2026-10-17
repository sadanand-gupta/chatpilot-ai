# Data model (Cloud Firestore)

All access is server-side through the API (Firebase Admin SDK). Client rules deny everything
([`firebase/firestore.rules`](../firebase/firestore.rules)). Types live in
[`packages/shared/src/types.ts`](../packages/shared/src/types.ts); the API converts ISO strings ⇄
Firestore `Timestamp` at the data-access boundary. In dev, `DATA_STORE=file` mirrors the same
layout in JSON files under `apps/api/.data`.

## Collections

```
users/{uid}
plans/{planId}                                   optional runtime overrides
chatbots/{chatbotId}
  ├─ versions/{version}                          immutable published configs
  ├─ sources/{sourceId}                          knowledge source metadata
  ├─ chunks/{chunkId}                            ≤1,500-char text chunks
  └─ crawlJobs/{jobId}
publicConfigs/{publicId}                         pointer → current published version
conversations/{conversationId}
  └─ messages/{messageId}
leads/{leadId}
usage/{ownerId}_{YYYY-MM}
```

| Path | Key fields | Written by | Notes |
|---|---|---|---|
| `users/{uid}` | `email, displayName, businessName, planId, createdAt, updatedAt` | first authenticated request, `PATCH /api/me` | `uid` = Firebase Auth uid. `planId` is changed only server-side (billing webhook / admin). |
| `plans/{planId}` | full `Plan` object | admin | Optional. Precedence: `plans` collection → `PLANS_JSON` → `DEFAULT_PLANS`. See [MONETIZATION.md](MONETIZATION.md). |
| `chatbots/{id}` | `ownerId, publicId, name, businessName, websiteUrl, category, language, status, config (draft), publishedVersion, publishedAt, hasUnpublishedChanges, allowedOrigins[], siteMeta, previewToken, knowledgeVersion, stats{sources,chunks,conversations,leads}, install{lastSeenOrigin,lastSeenAt}, isDemo, expiresAt, createdAt, updatedAt` | owner via API | `publicId` (`cb_…`) is public, not a secret. `previewToken` is a secret-ish capability to load the draft — never return it from public routes. Demo bots: `ownerId='__demo__'`, `isDemo=true`, `expiresAt=now+2h`. |
| `chatbots/{id}/versions/{n}` | `chatbotId, publicId, version, config, businessName, publishedAt` | publish | Never updated → safe rollback/audit. |
| `publicConfigs/{publicId}` | `chatbotId, ownerId, version, status` (+ optionally a denormalised copy of the published config) | publish / unpublish / delete | One small read per widget load. **Publish writes the version doc + this pointer + chatbot status in one batch.** Unpublish/delete removes or disables the pointer. |
| `chatbots/{id}/sources/{sid}` | `type (page/faq/manual), url, title, status (active/excluded/failed), charCount, chunkCount, preview (≈300 chars), crawlJobId, ownerId, chatbotId, timestamps` | crawler, owner | Metadata only; full text = its chunks in order. |
| `chatbots/{id}/chunks/{cid}` | `sourceId, ownerId, chatbotId, url, title, heading, text (≤1,500 chars), position` | crawler / source edits | Loaded in bulk into the per-chatbot BM25 cache; cache key = `knowledgeVersion`. |
| `chatbots/{id}/crawlJobs/{jid}` | `startUrl, status, stats{discovered,processed,skipped,failed}, pages[≤200], maxPages, error, hint, timestamps` | crawler | `pages` capped at 200 entries to stay far below 1 MiB. On API boot, `queued/running` jobs → `failed` ("server restarted"). |
| `conversations/{id}` | `chatbotId, ownerId, visitorId, channel, messageCount, lastMessagePreview, hasLead, pageUrl, createdAt, lastMessageAt` | public chat route | Top-level (not under chatbot) so the inbox can query across all of an owner's bots. `ownerId` is denormalised for tenant-scoped queries. |
| `conversations/{id}/messages/{mid}` | `role, content, sources[], fallback, createdAt` | public chat route | Ordered by `createdAt`. |
| `leads/{id}` | `chatbotId, ownerId, conversationId, name, email, phone, message, consent, pageUrl, createdAt` | public lead route | PII. Exported via CSV (plan feature). |
| `usage/{ownerId}_{YYYY-MM}` | `ownerId, period, messages, crawls, pagesCrawled, leads, aiTokens, failedRequests, resetAt` | API (`FieldValue.increment`) | Period is UTC month. Quota check reads this doc; the increment happens after a successful action. |

### Tenant isolation rule (API)

Every private query includes `where('ownerId', '==', uidFromToken)` or loads a document and checks
`doc.ownerId === uid` before returning or mutating it (otherwise respond `404`, not `403`, to avoid
leaking existence). Subcollection access always goes through the parent chatbot ownership check.

## Indexes

Firestore creates single-field indexes automatically (collection scope). Composite indexes and
**collection-group** single-field indexes must be declared in
[`firebase/firestore.indexes.json`](../firebase/firestore.indexes.json) (owned by the API) and
deployed with `firebase deploy --only firestore:indexes`. A missing index makes the query fail
with `FAILED_PRECONDITION` and a console link that creates it — copy it into the JSON file.

Expected queries → indexes (align with the API's actual queries):

| Query | Index |
|---|---|
| Chatbots list: `chatbots where ownerId == U orderBy createdAt desc` | `chatbots (ownerId ASC, createdAt DESC)` |
| Demo cleanup: `chatbots where isDemo == true and expiresAt < now` | `chatbots (isDemo ASC, expiresAt ASC)` |
| Inbox: `conversations where ownerId == U orderBy lastMessageAt desc` | `conversations (ownerId ASC, lastMessageAt DESC)` |
| Inbox by bot: `+ where chatbotId == B` | `conversations (ownerId ASC, chatbotId ASC, lastMessageAt DESC)` |
| Dashboard series / date filter: `ownerId == U and createdAt >= from` | `conversations (ownerId ASC, createdAt DESC)` |
| Retention: `conversations where ownerId == U and lastMessageAt < cutoff` | `conversations (ownerId ASC, lastMessageAt ASC)` |
| Leads list: `leads where ownerId == U orderBy createdAt desc` (+ `chatbotId == B`) | `leads (ownerId ASC, createdAt DESC)`, `leads (ownerId ASC, chatbotId ASC, createdAt DESC)` |
| Boot recovery: `collectionGroup('crawlJobs') where status in [queued, running]` | collection-group field override on `crawlJobs.status` |
| Source delete: `chunks where sourceId == S` (inside one chatbot) | automatic single-field |

**Index exemptions (recommended):** large text fields are never queried, and indexing them costs
writes and storage. Add `fieldOverrides` with `"indexes": []` for `chunks.text`,
`messages.content`, `sources.preview`, `chatbots.config`, `chatbots.siteMeta`,
`versions.config`, `crawlJobs.pages`.

Free-text search in the inbox (`?q=`): Firestore has no full-text search. The API filters the
fetched page in memory (`lastMessagePreview`, lead name/email). Acceptable at small scale; use a
search service or a keyword field later.

## Pagination

- Lists return `{ items, nextCursor }`. `limit` default 20, max 100.
- Cursor = opaque base64url of the last document's order-by value + id; the API uses
  `orderBy(field).orderBy(documentId()).startAfter(value, id).limit(limit + 1)` — fetching one extra
  doc tells whether a next page exists.
- Never use `offset()` — offset docs are still billed as reads.

## Document size strategy (1 MiB limit)

| Risk | Mitigation |
|---|---|
| Large page text | Split into ≤1,500-char chunks, one doc each; sources keep only a ≈300-char preview. |
| Per-bot knowledge growth | Plan limit `knowledgeCharsPerBot` (150k–3M chars) enforced before writing chunks. |
| Crawl job logs | `pages` array capped at the last 200 results. |
| Config bloat | `avatarUrl` must be an https URL — no `data:` URLs (schema-enforced); strings length-capped by zod. |
| Long conversations | One doc per message; conversation doc keeps only counters + preview. |
| Batches | Current Firestore docs cap a commit by request size (10 MiB) rather than the old 500-operation rule; keep chunk writes/deletes in batches of ≤500 anyway (safe and small) and use `BulkWriter` for large deletes. |
| Hot documents | `usage/{owner}_{month}` is incremented per message. Firestore's guidance is ~1 sustained write/second per document; fine for SMB traffic. If a single owner exceeds that, shard the counter. |

## Retention, TTL and deletion

| Data | Rule | Mechanism |
|---|---|---|
| Demo chatbots (`isDemo`) | 2 hours | Hourly API cleanup job deletes the bot **and its subcollections** + demo conversations (primary mechanism; works on Spark). A Firestore **TTL policy on `chatbots.expiresAt`** is an optional backstop — **TTL requires billing (Blaze)**. |
| Conversations + messages | Plan `retentionDays` (30–365) after `lastMessageAt` | Hourly/daily API job per owner. Messages subcollection deleted before the parent. |
| Leads | Until the owner deletes them / account deletion | `DELETE /api/leads/:id`. |
| Usage docs | Keep (billing history); small | — |
| Account | `DELETE /api/me` | Cascades chatbots (+versions, sources, chunks, crawlJobs), publicConfigs, conversations (+messages), leads, usage, `users/{uid}`, then deletes the Firebase Auth user. |

TTL caveats (verified 2026-10-17, https://firebase.google.com/docs/firestore/ttl and
https://firebase.google.com/docs/firestore/quotas; setup in [DEPLOYMENT.md §4](DEPLOYMENT.md#4-deploy-rules-indexes-and-ttl)):

- **TTL deletes have no free usage and need billing enabled (Blaze).** On Spark, rely on the API cleanup job.

- The TTL field **must be a Firestore `Timestamp`** (not an ISO string) or the doc is never deleted.
- TTL deletion is not immediate ("typically within 24 hours after its expiration date"), so never
  rely on TTL for correctness — the API must also treat `expiresAt < now` as gone.
- TTL **does not delete subcollections**. Therefore the hourly cleanup removes subcollections first.
  Optional hardening: also write `expiresAt` on demo bots' `sources`, `chunks`, `crawlJobs`,
  `conversations` and `messages`, and enable TTL on those collection groups (docs without the field
  are never touched).
- TTL deletes count toward document delete costs. One TTL field per collection group.
