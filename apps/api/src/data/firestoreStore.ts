import type { App } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import {
  chunkOps,
  clean,
  DeleteField,
  Increment,
  type BatchOp,
  type DocDB,
  type DocSnap,
  type QuerySpec,
  type Where,
} from './docdb';
import { createStore, type Store } from './store';

/**
 * Firestore engine. Date fields (ISO strings in the domain model) are stored as
 * Firestore Timestamps so that TTL policies (expiresAt) and range queries work
 * natively; they are converted back to ISO strings at this boundary.
 */

const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'lastMessageAt',
  'publishedAt',
  'expiresAt',
  'startedAt',
  'finishedAt',
  'lastSeenAt',
  'resetAt',
]);

const isDateKey = (key: string): boolean => DATE_FIELDS.has(key.split('.').pop() ?? key);

function toFsValue(key: string, v: unknown): unknown {
  if (v instanceof Increment) return FieldValue.increment(v.by);
  if (v instanceof DeleteField) return FieldValue.delete();
  if (typeof v === 'string' && isDateKey(key)) {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? v : Timestamp.fromMillis(ms);
  }
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? toFs(x as Record<string, unknown>) : x));
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return toFs(v as Record<string, unknown>);
  return v;
}

function toFs(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = toFsValue(k, v);
  }
  return out;
}

function fromFs(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(fromFs);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = fromFs(x);
    return out;
  }
  return v;
}

export class FirestoreDocDB implements DocDB {
  readonly kind = 'firestore' as const;
  readonly db: Firestore;

  constructor(app: App) {
    this.db = getFirestore(app);
    try {
      this.db.settings({ ignoreUndefinedProperties: true });
    } catch {
      /* settings() can only be called once per instance */
    }
  }

  async get<T>(path: string): Promise<T | null> {
    const snap = await this.db.doc(path).get();
    return snap.exists ? (fromFs(snap.data()) as T) : null;
  }

  async set(path: string, data: Record<string, unknown>): Promise<void> {
    await this.db.doc(path).set(toFs(clean(data)));
  }

  async update(path: string, data: Record<string, unknown>): Promise<void> {
    await this.db.doc(path).update(toFs(clean(data)));
  }

  async upsert(path: string, data: Record<string, unknown>): Promise<void> {
    await this.db.doc(path).set(toFs(clean(data)), { merge: true });
  }

  async delete(path: string): Promise<void> {
    await this.db.doc(path).delete();
  }

  private apply(q: Query, spec: QuerySpec, group: boolean): Query {
    for (const [field, op, value] of spec.where ?? []) {
      q = q.where(field, op, Array.isArray(value) ? value.map((x) => toFsValue(field, x)) : toFsValue(field, value));
    }
    if (spec.orderBy) {
      q = q.orderBy(spec.orderBy.field, spec.orderBy.dir);
      if (!group) q = q.orderBy(FieldPath.documentId(), spec.orderBy.dir);
      if (spec.startAfter) {
        const sv = toFsValue(spec.orderBy.field, spec.startAfter.value);
        q = group ? q.startAfter(sv) : q.startAfter(sv, spec.startAfter.id);
      }
    } else if (!group) {
      q = q.orderBy(FieldPath.documentId());
      if (spec.startAfter) q = q.startAfter(spec.startAfter.id);
    }
    if (spec.select?.length) q = q.select(...spec.select);
    if (spec.limit !== undefined) q = q.limit(spec.limit);
    return q;
  }

  async query<T>(collectionPath: string, spec: QuerySpec = {}): Promise<DocSnap<T>[]> {
    const snap = await this.apply(this.db.collection(collectionPath), spec, false).get();
    return snap.docs.map((d) => ({ id: d.id, path: d.ref.path, data: fromFs(d.data()) as T }));
  }

  async queryGroup<T>(collectionId: string, spec: QuerySpec = {}): Promise<DocSnap<T>[]> {
    const snap = await this.apply(this.db.collectionGroup(collectionId), spec, true).get();
    return snap.docs.map((d) => ({ id: d.id, path: d.ref.path, data: fromFs(d.data()) as T }));
  }

  async count(collectionPath: string, where: Where[] = []): Promise<number> {
    let q: Query = this.db.collection(collectionPath);
    for (const [field, op, value] of where) q = q.where(field, op, toFsValue(field, value));
    const agg = await q.count().get();
    return agg.data().count;
  }

  async batch(ops: BatchOp[]): Promise<void> {
    for (const group of chunkOps(ops)) {
      const b = this.db.batch();
      for (const op of group) {
        const ref = this.db.doc(op.path);
        if (op.type === 'delete') b.delete(ref);
        else if (op.type === 'set') b.set(ref, toFs(clean(op.data)));
        else if (op.type === 'update') b.update(ref, toFs(clean(op.data)));
        else b.set(ref, toFs(clean(op.data)), { merge: true });
      }
      // Resolves only after the commit is durable.
      await b.commit();
    }
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {
    await this.db.terminate().catch(() => undefined);
  }
}

export function createFirestoreStore(app: App): Store {
  return createStore(new FirestoreDocDB(app));
}
