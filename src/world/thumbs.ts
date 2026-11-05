import { db } from '../data/idb';
import type { Node } from '../data/schema';
import type { VFS } from '../vfs/vfs';
import { TILE_H, TILE_W } from './atlas';

interface Job {
  node: Node;
  resolve: (b: ImageBitmap | null) => void;
}

/** Thumbnail service: IDB cache first, then a worker. Two at a time so the main thread stays free. */
export class ThumbService {
  private worker = new Worker(new URL('../workers/thumbs.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, { job: Job; key: string }>();
  private queue: Job[] = [];
  private inflight = 0;
  private nextId = 1;
  private aborted = false;

  constructor(private vfs: VFS) {
    this.worker.onmessage = (e: MessageEvent<{ id: number; bitmap?: ImageBitmap; webp?: Blob | null; error?: string }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      this.inflight--;
      if (e.data.webp) void this.store(p.key, e.data.webp);
      p.job.resolve(e.data.bitmap ?? null);
      this.pump();
    };
  }

  /** Drop queued work (used when leaving a room). */
  clearQueue() {
    for (const j of this.queue) j.resolve(null);
    this.queue = [];
  }

  get(node: Node): Promise<ImageBitmap | null> {
    return new Promise((resolve) => {
      this.queue.push({ node, resolve });
      this.pump();
    });
  }

  private key(n: Node) {
    return `${n.id}:${n.mtime}:${n.size}`;
  }

  private async cached(key: string): Promise<ImageBitmap | null> {
    try {
      const rec = (await (await db()).get('thumbs', key)) as Blob | undefined;
      return rec ? await createImageBitmap(rec) : null;
    } catch {
      return null;
    }
  }

  private async store(key: string, blob: Blob) {
    try {
      await (await db()).put('thumbs', blob, key);
    } catch {
      /* cache is best-effort */
    }
  }

  private pump() {
    while (this.inflight < 2 && this.queue.length && !this.aborted) {
      const job = this.queue.shift()!;
      this.inflight++;
      void this.run(job);
    }
  }

  private async run(job: Job) {
    const key = this.key(job.node);
    const hit = await this.cached(key);
    if (hit) {
      this.inflight--;
      job.resolve(hit);
      this.pump();
      return;
    }
    try {
      const blob = await this.vfs.read(job.node.id);
      const id = this.nextId++;
      this.pending.set(id, { job, key });
      this.worker.postMessage({ id, blob, w: TILE_W, h: TILE_H });
    } catch {
      this.inflight--;
      job.resolve(null);
      this.pump();
    }
  }

  dispose() {
    this.aborted = true;
    this.worker.terminate();
  }
}
