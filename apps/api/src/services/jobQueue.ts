import { rateLimited } from '../lib/errors';

/**
 * In-process job queue: global concurrency N, at most one running job per key
 * (owner). Jobs are not durable: if the process restarts, running jobs are lost
 * (CrawlService marks them failed on boot).
 */

type Runner = (signal: AbortSignal) => Promise<void>;

interface QueuedJob {
  id: string;
  key: string;
  run: Runner;
  controller: AbortController;
}

export class JobQueue {
  private queue: QueuedJob[] = [];
  private running = new Map<string, QueuedJob>();
  private runningKeys = new Set<string>();
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly globalConcurrency = 2,
    private readonly maxQueued = 200,
  ) {}

  get queuedCount(): number {
    return this.queue.length;
  }

  enqueue(key: string, id: string, run: Runner): void {
    if (this.queue.length >= this.maxQueued) throw rateLimited('The crawler is busy right now. Please try again in a few minutes.');
    this.queue.push({ id, key, run, controller: new AbortController() });
    this.pump();
  }

  /** Returns where the job was when cancelled, or null if unknown. */
  cancel(id: string): 'queued' | 'running' | null {
    const qi = this.queue.findIndex((j) => j.id === id);
    if (qi !== -1) {
      this.queue.splice(qi, 1);
      this.checkIdle();
      return 'queued';
    }
    const r = this.running.get(id);
    if (r) {
      r.controller.abort();
      return 'running';
    }
    return null;
  }

  has(id: string): boolean {
    return this.running.has(id) || this.queue.some((j) => j.id === id);
  }

  get size(): number {
    return this.queue.length + this.running.size;
  }

  /** Resolves once the given job is no longer queued or running. */
  async idleFor(id: string): Promise<void> {
    while (this.has(id)) await new Promise((r) => setTimeout(r, 25));
  }

  /** Resolves when no jobs are queued or running (used by tests and graceful shutdown). */
  idle(): Promise<void> {
    if (!this.size) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  abortAll(): void {
    this.queue = [];
    for (const j of this.running.values()) j.controller.abort();
  }

  private checkIdle(): void {
    if (this.size) return;
    const w = this.idleWaiters.splice(0);
    w.forEach((r) => r());
  }

  private pump(): void {
    while (this.running.size < this.globalConcurrency) {
      const idx = this.queue.findIndex((j) => !this.runningKeys.has(j.key));
      if (idx === -1) break;
      const job = this.queue.splice(idx, 1)[0];
      this.running.set(job.id, job);
      this.runningKeys.add(job.key);
      void job
        .run(job.controller.signal)
        .catch(() => undefined)
        .finally(() => {
          this.running.delete(job.id);
          this.runningKeys.delete(job.key);
          this.pump();
          this.checkIdle();
        });
    }
  }
}
