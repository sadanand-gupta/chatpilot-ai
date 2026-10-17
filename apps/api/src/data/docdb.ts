/**
 * Minimal document-database abstraction implemented by Firestore (production)
 * and an in-memory/JSON-file engine (dev/test). The Store implementation is
 * written once against this interface so both backends share exact semantics.
 *
 * Paths use Firestore syntax: "collection/docId/subcollection/docId".
 */

export type WhereOp = '==' | '<' | '<=' | '>' | '>=' | 'in';
export type Where = [field: string, op: WhereOp, value: unknown];

export interface QuerySpec {
  where?: Where[];
  /** Results are always tie-broken by document id in the same direction as the last orderBy. */
  orderBy?: { field: string; dir: 'asc' | 'desc' };
  limit?: number;
  /** Cursor: the sort value of the last doc and its id. */
  startAfter?: { value: unknown; id: string };
  /** Restrict returned fields (Firestore projection); purely an optimisation. */
  select?: string[];
}

export interface DocSnap<T> {
  id: string;
  path: string;
  data: T;
}

/** Sentinel for atomic counters. */
export class Increment {
  constructor(public readonly by: number) {}
}
/** Sentinel to remove a field in update(). */
export class DeleteField {}

export const increment = (by: number): Increment => new Increment(by);
export const deleteField = (): DeleteField => new DeleteField();

export type BatchOp =
  | { type: 'set'; path: string; data: Record<string, unknown> }
  | { type: 'update'; path: string; data: Record<string, unknown> }
  | { type: 'upsert'; path: string; data: Record<string, unknown> }
  | { type: 'delete'; path: string };

export interface DocDB {
  readonly kind: 'firestore' | 'file';
  get<T>(path: string): Promise<T | null>;
  /** Full replace. */
  set(path: string, data: Record<string, unknown>): Promise<void>;
  /** Merge into an existing doc (fails if missing). Supports dotted paths, Increment and DeleteField. */
  update(path: string, data: Record<string, unknown>): Promise<void>;
  /** Merge, creating the doc if missing. Top-level keys only; Increment supported. */
  upsert(path: string, data: Record<string, unknown>): Promise<void>;
  delete(path: string): Promise<void>;
  query<T>(collectionPath: string, spec?: QuerySpec): Promise<DocSnap<T>[]>;
  /** Collection-group query over every collection with this id (equality filters only). */
  queryGroup<T>(collectionId: string, spec?: QuerySpec): Promise<DocSnap<T>[]>;
  count(collectionPath: string, where?: Where[]): Promise<number>;
  /**
   * Applies operations. Batches of up to 400 ops commit atomically; larger
   * inputs are split into several sequential commits.
   */
  batch(ops: BatchOp[]): Promise<void>;
  /** Flush pending writes (file engine) / no-op (Firestore). */
  flush(): Promise<void>;
  close(): Promise<void>;
}

export const MAX_BATCH_OPS = 400;

export function chunkOps<T>(ops: T[], size = MAX_BATCH_OPS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ops.length; i += size) out.push(ops.slice(i, i + size));
  return out;
}

/** Strip undefined values (Firestore rejects them; the file engine mirrors that). */
export function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Increment) && !(v instanceof DeleteField) && Object.getPrototypeOf(v) === Object.prototype) {
      out[k] = clean(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((x) => (x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype ? clean(x as Record<string, unknown>) : x));
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
