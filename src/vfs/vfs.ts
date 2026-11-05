import type { Id, Node, NodeKind } from '../data/schema';
import { hash32 } from '../util/hash';

export type Change =
  | { type: 'add'; id: Id; parent: Id | null }
  | { type: 'remove'; id: Id; parent: Id | null }
  | { type: 'modify'; id: Id; parent: Id | null }
  | { type: 'move'; id: Id; parent: Id | null; from: Id | null };

export type Unsubscribe = () => void;

export const TRASH_NAME = '.atrium-trash';

export class VfsError extends Error {
  constructor(
    public code: 'not-found' | 'exists' | 'invalid' | 'read-only' | 'permission',
    message: string,
  ) {
    super(message);
    this.name = 'VfsError';
  }
}

/**
 * The only way the app touches files. Two backends implement it: DemoVFS (in-memory + IndexedDB)
 * and, in a later phase, FsaVFS (File System Access API).
 */
export interface VFS {
  readonly rootId: Id;
  /** Immediate children of a folder (excluding the trash folder). */
  list(dir: Id): Promise<Node[]>;
  stat(id: Id): Promise<Node>;
  /** Every node under the root, trash included. Used for scans and indexing. */
  all(): Promise<Node[]>;
  read(id: Id): Promise<Blob>;
  write(id: Id, data: Blob | string): Promise<void>;
  /** Moves keep the node id, so spatial data (slots, threads) follows the file. */
  move(id: Id, newParent: Id, newName?: string): Promise<void>;
  copy(id: Id, newParent: Id): Promise<Id>;
  create(parent: Id, name: string, data?: Blob | string, kind?: NodeKind): Promise<Id>;
  rename(id: Id, newName: string): Promise<void>;
  setTags(id: Id, tags: string[]): Promise<void>;
  /** Moves into the trash folder, remembering the origin. Reversible. */
  trash(id: Id): Promise<void>;
  restore(id: Id): Promise<void>;
  /** The only irreversible operation. */
  emptyTrash(): Promise<void>;
  trashId(): Promise<Id>;
  watch(cb: (changes: Change[]) => void): Unsubscribe;
}

export function fingerprintOf(name: string, size: number, mtime: number): string {
  return hash32(`${name}|${size}|${mtime}`).toString(16);
}

/** "name.ext" -> "name (2).ext" until it no longer clashes. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}
