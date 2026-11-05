import { allNodes, deleteBlob, deleteNode, getBlob, putBlob, putNodes } from '../data/idb';
import type { Id, Node, NodeKind } from '../data/schema';
import { uuid } from '../util/hash';
import { kindFromName, mimeFromName } from './kind';
import { fingerprintOf, TRASH_NAME, uniqueName, VfsError, type Change, type Unsubscribe, type VFS } from './vfs';

export const ROOT_ID = 'root';
export const TRASH_ID = 'trash';

export interface DemoSeed {
  nodes: Node[];
  blobs: Map<Id, Blob>;
}

export interface DemoOptions {
  clock?: () => number;
  /** Called only when the database holds no nodes yet. */
  seed?: () => Promise<DemoSeed> | DemoSeed;
}

/** In-memory tree backed by IndexedDB. Same behaviour a real folder backend must provide. */
export class DemoVFS implements VFS {
  readonly rootId = ROOT_ID;
  private nodes = new Map<Id, Node>();
  private blobCache = new Map<Id, Blob>();
  private listeners = new Set<(c: Change[]) => void>();
  private now: () => number;

  private constructor(opts: DemoOptions) {
    this.now = opts.clock ?? Date.now;
  }

  static async open(opts: DemoOptions = {}): Promise<DemoVFS> {
    const vfs = new DemoVFS(opts);
    const stored = await allNodes();
    if (stored.length === 0) {
      const t = vfs.now();
      const base: Node[] = [
        mk(ROOT_ID, null, 'folder', 'Home', t),
        mk(TRASH_ID, ROOT_ID, 'folder', TRASH_NAME, t),
      ];
      const seed = opts.seed ? await opts.seed() : { nodes: [], blobs: new Map<Id, Blob>() };
      const nodes = [...base, ...seed.nodes];
      for (const n of nodes) vfs.nodes.set(n.id, n);
      await putNodes(nodes);
      for (const [id, blob] of seed.blobs) {
        vfs.blobCache.set(id, blob);
        await putBlob(id, blob);
      }
    } else {
      for (const n of stored) vfs.nodes.set(n.id, n);
    }
    return vfs;
  }

  // ---- reads ----

  async list(dir: Id): Promise<Node[]> {
    this.must(dir);
    const out: Node[] = [];
    for (const n of this.nodes.values()) if (n.parent === dir && n.id !== TRASH_ID) out.push(snap(n));
    return out.sort(byName);
  }

  async stat(id: Id): Promise<Node> {
    return snap(this.must(id));
  }

  async all(): Promise<Node[]> {
    return [...this.nodes.values()].map(snap);
  }

  async trashId(): Promise<Id> {
    return TRASH_ID;
  }

  async read(id: Id): Promise<Blob> {
    const n = this.must(id);
    if (n.kind === 'folder') throw new VfsError('invalid', 'Cannot read a folder');
    const cached = this.blobCache.get(id);
    if (cached) return cached;
    const b = (await getBlob(id)) ?? new Blob([], { type: mimeFromName(n.name) });
    this.blobCache.set(id, b);
    return b;
  }

  // ---- writes ----

  async write(id: Id, data: Blob | string): Promise<void> {
    const n = this.must(id);
    if (n.kind === 'folder') throw new VfsError('invalid', 'Cannot write a folder');
    const blob = typeof data === 'string' ? new Blob([data], { type: mimeFromName(n.name) }) : data;
    this.blobCache.set(id, blob);
    await putBlob(id, blob);
    this.touch(n, blob.size);
    await this.persist([n]);
    this.emit([{ type: 'modify', id, parent: n.parent }]);
  }

  async create(parent: Id, name: string, data?: Blob | string, kind?: NodeKind): Promise<Id> {
    const p = this.must(parent);
    if (p.kind !== 'folder') throw new VfsError('invalid', 'Parent is not a folder');
    const unique = uniqueName(name, this.namesIn(parent));
    const k = kind ?? (data === undefined ? 'folder' : kindFromName(unique));
    const id = uuid();
    const blob = data === undefined ? undefined : typeof data === 'string' ? new Blob([data], { type: mimeFromName(unique) }) : data;
    const t = this.now();
    const node: Node = {
      id, parent, kind: k, name: unique, size: blob?.size ?? 0, mtime: t, tags: [],
      fingerprint: fingerprintOf(unique, blob?.size ?? 0, t),
    };
    this.nodes.set(id, node);
    if (blob) {
      this.blobCache.set(id, blob);
      await putBlob(id, blob);
    }
    await this.persist([node]);
    this.emit([{ type: 'add', id, parent }]);
    return id;
  }

  async rename(id: Id, newName: string): Promise<void> {
    const n = this.must(id);
    if (n.id === ROOT_ID || n.id === TRASH_ID) throw new VfsError('invalid', 'Cannot rename this folder');
    const taken = this.namesIn(n.parent!);
    taken.delete(n.name);
    n.name = uniqueName(newName, taken);
    n.fingerprint = fingerprintOf(n.name, n.size, n.mtime);
    await this.persist([n]);
    this.emit([{ type: 'modify', id, parent: n.parent }]);
  }

  async setTags(id: Id, tags: string[]): Promise<void> {
    const n = this.must(id);
    n.tags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    await this.persist([n]);
    this.emit([{ type: 'modify', id, parent: n.parent }]);
  }

  async move(id: Id, newParent: Id, newName?: string): Promise<void> {
    const n = this.must(id);
    const target = this.must(newParent);
    if (id === ROOT_ID || id === TRASH_ID) throw new VfsError('invalid', 'Cannot move this folder');
    if (target.kind !== 'folder') throw new VfsError('invalid', 'Destination is not a folder');
    if (this.isSelfOrDescendant(newParent, id)) throw new VfsError('invalid', 'Cannot move a folder into itself');
    const from = n.parent;
    const taken = this.namesIn(newParent);
    if (newParent === from) taken.delete(n.name);
    n.name = uniqueName(newName ?? n.name, taken);
    n.parent = newParent;
    n.fingerprint = fingerprintOf(n.name, n.size, n.mtime);
    await this.persist([n]);
    this.emit([{ type: 'move', id, parent: newParent, from }]);
  }

  async copy(id: Id, newParent: Id): Promise<Id> {
    const n = this.must(id);
    const target = this.must(newParent);
    if (target.kind !== 'folder') throw new VfsError('invalid', 'Destination is not a folder');
    if (this.isSelfOrDescendant(newParent, id)) throw new VfsError('invalid', 'Cannot copy a folder into itself');
    const created: Node[] = [];
    const newId = await this.cloneInto(n, newParent, created);
    await this.persist(created);
    this.emit([{ type: 'add', id: newId, parent: newParent }]);
    return newId;
  }

  async trash(id: Id): Promise<void> {
    const n = this.must(id);
    if (id === ROOT_ID || id === TRASH_ID) throw new VfsError('invalid', 'Cannot trash this folder');
    if (this.isSelfOrDescendant(id, TRASH_ID)) return; // already trashed
    const from = n.parent;
    n.trashedFrom = from ?? ROOT_ID;
    const taken = this.namesIn(TRASH_ID);
    n.name = uniqueName(n.name, taken);
    n.parent = TRASH_ID;
    await this.persist([n]);
    this.emit([{ type: 'move', id, parent: TRASH_ID, from }]);
  }

  async restore(id: Id): Promise<void> {
    const n = this.must(id);
    if (n.parent !== TRASH_ID) throw new VfsError('invalid', 'Item is not in the trash');
    const dest = n.trashedFrom && this.nodes.has(n.trashedFrom) && !this.isSelfOrDescendant(n.trashedFrom, TRASH_ID) ? n.trashedFrom : ROOT_ID;
    delete n.trashedFrom;
    await this.move(id, dest);
  }

  async emptyTrash(): Promise<void> {
    const doomed: Id[] = [];
    const walk = (dir: Id) => {
      for (const n of this.nodes.values()) {
        if (n.parent === dir) {
          doomed.push(n.id);
          if (n.kind === 'folder') walk(n.id);
        }
      }
    };
    walk(TRASH_ID);
    const changes: Change[] = [];
    for (const id of doomed) {
      const n = this.nodes.get(id)!;
      this.nodes.delete(id);
      this.blobCache.delete(id);
      await deleteNode(id);
      await deleteBlob(id);
      changes.push({ type: 'remove', id, parent: n.parent });
    }
    this.emit(changes);
  }

  watch(cb: (changes: Change[]) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- internals ----

  private async cloneInto(src: Node, parent: Id, out: Node[]): Promise<Id> {
    const id = uuid();
    const name = uniqueName(src.name, this.namesIn(parent));
    const t = this.now();
    const copy: Node = { ...src, id, parent, name, mtime: t, tags: [...src.tags], fingerprint: fingerprintOf(name, src.size, t) };
    delete copy.trashedFrom;
    this.nodes.set(id, copy);
    out.push(copy);
    if (src.kind === 'folder') {
      for (const child of [...this.nodes.values()].filter((c) => c.parent === src.id)) await this.cloneInto(child, id, out);
    } else {
      const blob = await this.read(src.id);
      this.blobCache.set(id, blob);
      await putBlob(id, blob);
    }
    return id;
  }

  private must(id: Id): Node {
    const n = this.nodes.get(id);
    if (!n) throw new VfsError('not-found', `No such item: ${id}`);
    return n;
  }

  private namesIn(dir: Id): Set<string> {
    const s = new Set<string>();
    for (const n of this.nodes.values()) if (n.parent === dir) s.add(n.name);
    return s;
  }

  /** True when `id` equals `ancestor` or lies below it. */
  private isSelfOrDescendant(id: Id, ancestor: Id): boolean {
    let cur: Id | null = id;
    while (cur) {
      if (cur === ancestor) return true;
      cur = this.nodes.get(cur)?.parent ?? null;
    }
    return false;
  }

  private touch(n: Node, size: number) {
    n.size = size;
    n.mtime = this.now();
    n.fingerprint = fingerprintOf(n.name, n.size, n.mtime);
  }

  private async persist(nodes: Node[]) {
    await putNodes(nodes);
  }

  private emit(changes: Change[]) {
    if (changes.length === 0) return;
    for (const l of this.listeners) l(changes);
  }
}

function mk(id: Id, parent: Id | null, kind: NodeKind, name: string, t: number): Node {
  return { id, parent, kind, name, size: 0, mtime: t, tags: [], fingerprint: fingerprintOf(name, 0, t) };
}

/** Reads return copies so callers can never mutate backend state by accident. */
function snap(n: Node): Node {
  return { ...n, tags: [...n.tags] };
}

function byName(a: Node, b: Node): number {
  if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}
