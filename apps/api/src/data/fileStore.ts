import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
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
 * DEV/TEST ONLY document engine: an in-memory cache persisted to a single JSON
 * file with debounced atomic writes (write temp file + rename). It mirrors the
 * Firestore semantics the Store relies on (ordering, cursors, missing-field
 * exclusion on orderBy, no implicit subcollection deletes).
 * The API refuses DATA_STORE=file in production.
 */

type Collections = Map<string, Map<string, Record<string, unknown>>>;

function splitPath(p: string): { collection: string; id: string } {
  const parts = p.split('/').filter(Boolean);
  if (parts.length % 2 !== 0) throw new Error(`Invalid document path: ${p}`);
  return { collection: parts.slice(0, -1).join('/'), id: parts[parts.length - 1] };
}

function getField(obj: Record<string, unknown>, field: string): unknown {
  let cur: unknown = obj;
  for (const k of field.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function setField(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] === null || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value instanceof DeleteField) {
    delete cur[last];
  } else if (value instanceof Increment) {
    const prev = typeof cur[last] === 'number' ? (cur[last] as number) : 0;
    cur[last] = prev + value.by;
  } else {
    cur[last] = structuredClone(value);
  }
}

function resolveSentinels(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Increment) out[k] = v.by;
    else if (v instanceof DeleteField || v === undefined) continue;
    else out[k] = structuredClone(v);
  }
  return out;
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

function matches(doc: Record<string, unknown>, where: Where[] = []): boolean {
  return where.every(([field, op, value]) => {
    const v = getField(doc, field);
    switch (op) {
      case '==':
        return v === value;
      case 'in':
        return Array.isArray(value) && value.includes(v);
      case '<':
        return v !== undefined && cmp(v, value) < 0;
      case '<=':
        return v !== undefined && cmp(v, value) <= 0;
      case '>':
        return v !== undefined && cmp(v, value) > 0;
      case '>=':
        return v !== undefined && cmp(v, value) >= 0;
      default:
        return false;
    }
  });
}

function runQuery<T>(entries: { id: string; path: string; data: Record<string, unknown> }[], spec: QuerySpec = {}): DocSnap<T>[] {
  let rows = entries.filter((e) => matches(e.data, spec.where));
  const ob = spec.orderBy;
  if (ob) {
    rows = rows.filter((r) => getField(r.data, ob.field) !== undefined);
    const dir = ob.dir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const c = cmp(getField(a.data, ob.field), getField(b.data, ob.field));
      return (c !== 0 ? c : cmp(a.id, b.id)) * dir;
    });
    if (spec.startAfter) {
      const { value, id } = spec.startAfter;
      rows = rows.filter((r) => {
        const c = cmp(getField(r.data, ob.field), value);
        const rel = c !== 0 ? c : cmp(r.id, id);
        return rel * dir > 0;
      });
    }
  } else {
    rows.sort((a, b) => cmp(a.id, b.id));
    if (spec.startAfter) rows = rows.filter((r) => r.id > spec.startAfter!.id);
  }
  if (spec.limit !== undefined) rows = rows.slice(0, spec.limit);
  return rows.map((r) => ({ id: r.id, path: r.path, data: structuredClone(r.data) as T }));
}

export interface FileDocDBOptions {
  dir: string;
  /** Disable persistence (pure in-memory). */
  persist?: boolean;
  debounceMs?: number;
}

export class FileDocDB implements DocDB {
  readonly kind = 'file' as const;
  private cols: Collections = new Map();
  private file: string;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;
  private persist: boolean;
  private debounceMs: number;

  constructor(opts: FileDocDBOptions) {
    this.persist = opts.persist ?? true;
    this.debounceMs = opts.debounceMs ?? 250;
    this.file = path.resolve(opts.dir, 'store.json');
    if (this.persist) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      if (fs.existsSync(this.file)) {
        try {
          const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
          for (const [col, docs] of Object.entries(raw)) this.cols.set(col, new Map(Object.entries(docs)));
        } catch (e) {
          throw new Error(`FileStore: cannot parse ${this.file}: ${(e as Error).message}`);
        }
      }
    }
  }

  private col(name: string): Map<string, Record<string, unknown>> {
    let c = this.cols.get(name);
    if (!c) {
      c = new Map();
      this.cols.set(name, c);
    }
    return c;
  }

  private schedule(): void {
    if (!this.persist) return;
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeNow();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  private writeNow(): Promise<void> {
    if (!this.persist || !this.dirty) return this.writing;
    this.dirty = false;
    const snapshot: Record<string, Record<string, unknown>> = {};
    for (const [name, docs] of this.cols) if (docs.size) snapshot[name] = Object.fromEntries(docs);
    const json = JSON.stringify(snapshot);
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, json, 'utf8');
      await fsp.rename(tmp, this.file);
    }).catch(() => {
      this.dirty = true;
    });
    return this.writing;
  }

  async get<T>(p: string): Promise<T | null> {
    const { collection, id } = splitPath(p);
    const d = this.cols.get(collection)?.get(id);
    return d ? (structuredClone(d) as T) : null;
  }

  private applyOp(op: BatchOp): void {
    const { collection, id } = splitPath(op.path);
    const c = this.col(collection);
    if (op.type === 'delete') {
      c.delete(id);
      return;
    }
    if (op.type === 'set') {
      c.set(id, resolveSentinels(clean(op.data)));
      return;
    }
    const existing = c.get(id);
    if (!existing && op.type === 'update') {
      const err = new Error(`NOT_FOUND: no document to update: ${op.path}`) as Error & { code: number };
      err.code = 5;
      throw err;
    }
    const doc = existing ? structuredClone(existing) : {};
    for (const [k, v] of Object.entries(clean(op.data))) {
      if (v === undefined) continue;
      // upsert keys are literal top-level fields; update keys may be dotted paths.
      setField(doc, op.type === 'upsert' ? [k] : k.split('.'), v);
    }
    c.set(id, doc);
  }

  async set(p: string, data: Record<string, unknown>): Promise<void> {
    this.applyOp({ type: 'set', path: p, data });
    this.schedule();
  }

  async update(p: string, data: Record<string, unknown>): Promise<void> {
    this.applyOp({ type: 'update', path: p, data });
    this.schedule();
  }

  async upsert(p: string, data: Record<string, unknown>): Promise<void> {
    this.applyOp({ type: 'upsert', path: p, data });
    this.schedule();
  }

  async delete(p: string): Promise<void> {
    this.applyOp({ type: 'delete', path: p });
    this.schedule();
  }

  async query<T>(collectionPath: string, spec?: QuerySpec): Promise<DocSnap<T>[]> {
    const c = this.cols.get(collectionPath);
    if (!c) return [];
    const entries = [...c.entries()].map(([id, data]) => ({ id, path: `${collectionPath}/${id}`, data }));
    return runQuery<T>(entries, spec);
  }

  async queryGroup<T>(collectionId: string, spec?: QuerySpec): Promise<DocSnap<T>[]> {
    const entries: { id: string; path: string; data: Record<string, unknown> }[] = [];
    for (const [name, docs] of this.cols) {
      if (name.split('/').pop() !== collectionId) continue;
      for (const [id, data] of docs) entries.push({ id, path: `${name}/${id}`, data });
    }
    return runQuery<T>(entries, spec);
  }

  async count(collectionPath: string, where?: Where[]): Promise<number> {
    const c = this.cols.get(collectionPath);
    if (!c) return 0;
    let n = 0;
    for (const d of c.values()) if (matches(d, where)) n++;
    return n;
  }

  async batch(ops: BatchOp[]): Promise<void> {
    for (const group of chunkOps(ops)) {
      // Validate updates first so a group is all-or-nothing.
      for (const op of group) {
        if (op.type === 'update') {
          const { collection, id } = splitPath(op.path);
          const exists = this.cols.get(collection)?.has(id);
          const createdInGroup = group.some((o) => o !== op && o.path === op.path && (o.type === 'set' || o.type === 'upsert'));
          if (!exists && !createdInGroup) {
            const err = new Error(`NOT_FOUND: no document to update: ${op.path}`) as Error & { code: number };
            err.code = 5;
            throw err;
          }
        }
      }
      for (const op of group) this.applyOp(op);
    }
    this.schedule();
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.writeNow();
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

export function createFileStore(opts: FileDocDBOptions): Store {
  return createStore(new FileDocDB(opts));
}
