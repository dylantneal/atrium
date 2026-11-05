import { db } from '../data/idb';
import type { Id, Node } from '../data/schema';
import type { SearchDoc, SearchHit } from '../core/search';
import type { Change, VFS } from '../vfs/vfs';

const MAX_TEXT = 200 * 1024;
const TEXTUAL = new Set(['text', 'markdown']);

interface Cached {
  fp: string;
  path: string;
  doc: SearchDoc;
}

/**
 * Keeps the worker's index in step with the file tree. Documents are cached in IndexedDB by fingerprint,
 * so a reload only re-reads files that changed.
 */
export class SearchService {
  private worker = new Worker(new URL('../workers/search.ts', import.meta.url), { type: 'module' });
  private waiting = new Map<number, (h: SearchHit[]) => void>();
  private qid = 1;
  readonly paths = new Map<Id, string>();
  private names = new Map<Id, Node>();
  private pending = new Map<Id, 'upsert' | 'remove'>();
  private timer = 0;
  ready: Promise<void> = Promise.resolve();

  constructor(private vfs: VFS) {
    this.worker.onmessage = (e: MessageEvent<{ qid: number; hits: SearchHit[] }>) => {
      this.waiting.get(e.data.qid)?.(e.data.hits);
      this.waiting.delete(e.data.qid);
    };
    vfs.watch((changes) => this.onChanges(changes));
  }

  private pathOf(n: Node): string {
    const parts: string[] = [];
    let cur = n.parent ? this.names.get(n.parent) : undefined;
    while (cur && cur.parent) {
      parts.unshift(cur.name);
      cur = this.names.get(cur.parent);
    }
    return parts.join(' / ');
  }

  private async docFor(n: Node): Promise<SearchDoc> {
    let text = '';
    if (TEXTUAL.has(n.kind) && n.size <= MAX_TEXT * 5) {
      try {
        text = (await (await this.vfs.read(n.id)).slice(0, MAX_TEXT).text()).slice(0, 20000);
      } catch {
        /* unreadable: index the name only */
      }
    }
    return { id: n.id, name: n.name, path: this.paths.get(n.id) ?? this.pathOf(n), kind: n.kind, tags: n.tags, text, mtime: n.mtime };
  }

  /** Build (or refresh from cache) the whole index. */
  init(): Promise<void> {
    this.ready = (async () => {
      const nodes = (await this.vfs.all()).filter((n) => n.id !== this.vfs.rootId);
      this.names = new Map((await this.vfs.all()).map((n) => [n.id, n]));
      const trash = await this.vfs.trashId();
      const d = await db();
      const docs: SearchDoc[] = [];
      const live = new Set<Id>();
      for (const n of nodes) {
        if (n.id === trash || this.isTrashed(n, trash)) continue;
        live.add(n.id);
        const path = this.pathOf(n);
        this.paths.set(n.id, path);
        const hit = (await d.get('searchindex', n.id)) as Cached | undefined;
        if (hit && hit.fp === n.fingerprint && hit.path === path) {
          docs.push(hit.doc);
          continue;
        }
        const doc = await this.docFor(n);
        docs.push(doc);
        await d.put('searchindex', { fp: n.fingerprint, path, doc } satisfies Cached, n.id);
      }
      for (const key of (await d.getAllKeys('searchindex')) as Id[]) if (!live.has(key)) await d.delete('searchindex', key);
      this.worker.postMessage({ type: 'load', docs });
    })();
    return this.ready;
  }

  private isTrashed(n: Node, trash: Id): boolean {
    let cur: Node | undefined = n;
    while (cur) {
      if (cur.id === trash) return true;
      cur = cur.parent ? this.names.get(cur.parent) : undefined;
    }
    return false;
  }

  private onChanges(changes: Change[]) {
    for (const c of changes) this.pending.set(c.id, c.type === 'remove' ? 'remove' : 'upsert');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 200);
  }

  private async flush() {
    await this.ready;
    const batch = [...this.pending];
    this.pending.clear();
    const trash = await this.vfs.trashId();
    // names may have changed (renames, moves): refresh the lookup first
    this.names = new Map((await this.vfs.all()).map((n) => [n.id, n]));
    const d = await db();
    for (const [id, what] of batch) {
      const n = what === 'remove' ? null : this.names.get(id) ?? null;
      if (!n || n.id === trash || this.isTrashed(n, trash)) {
        this.worker.postMessage({ type: 'remove', id });
        this.paths.delete(id);
        await d.delete('searchindex', id);
        continue;
      }
      this.paths.set(id, this.pathOf(n));
      const doc = await this.docFor(n);
      await d.put('searchindex', { fp: n.fingerprint, path: doc.path, doc } satisfies Cached, id);
      this.worker.postMessage({ type: 'upsert', doc });
    }
  }

  /** Resolves once pending file changes have reached the index (tests wait on this). */
  async settled() {
    await this.ready;
    clearTimeout(this.timer);
    await this.flush();
  }

  async query(q: string, limit = 60): Promise<SearchHit[]> {
    await this.ready;
    if (!q.trim()) return [];
    return new Promise((resolve) => {
      const id = this.qid++;
      this.waiting.set(id, resolve);
      this.worker.postMessage({ type: 'query', qid: id, q, limit });
    });
  }
}
