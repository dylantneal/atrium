import { openDB, type IDBPDatabase } from 'idb';
import { LATEST_VERSION, runUpgrades } from './migrations';
import type { AccessEvent, Id, Inventory, Node, Room, Thread, VersionRef } from './schema';
import { INVENTORY_SLOTS } from './schema';

export type AtriumDB = IDBPDatabase<any>;

let dbName = 'atrium';

/** Tests and "Reset demo" use a distinct database name. */
export function setDbName(name: string) {
  dbName = name;
  cached = null;
}

let cached: Promise<AtriumDB> | null = null;

export function db(): Promise<AtriumDB> {
  cached ??= openDB(dbName, LATEST_VERSION, {
    upgrade(database, oldVersion, _new, tx) {
      runUpgrades(database, oldVersion, tx);
    },
  });
  return cached;
}

export async function closeDb() {
  if (!cached) return;
  (await cached).close();
  cached = null;
}

export async function deleteDb() {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

// ---- typed helpers ----

export async function putNodes(nodes: Node[]) {
  const d = await db();
  const tx = d.transaction('nodes', 'readwrite');
  await Promise.all([...nodes.map((n) => tx.store.put(n)), tx.done]);
}

export async function allNodes(): Promise<Node[]> {
  return (await db()).getAll('nodes');
}

export async function deleteNode(id: Id) {
  await (await db()).delete('nodes', id);
}

export async function getRoom(id: Id): Promise<Room | undefined> {
  return (await db()).get('rooms', id);
}

export async function putRoom(room: Room) {
  await (await db()).put('rooms', room);
}

export async function allRooms(): Promise<Room[]> {
  return (await db()).getAll('rooms');
}

export async function getInventory(): Promise<Inventory> {
  const inv = (await (await db()).get('inventory', 'main')) as Inventory | undefined;
  return inv ?? { slots: Array<Id | null>(INVENTORY_SLOTS).fill(null) };
}

export async function putInventory(inv: Inventory) {
  await (await db()).put('inventory', inv, 'main');
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db()).get('settings', key);
}

export async function setSetting<T>(key: string, value: T) {
  await (await db()).put('settings', value, key);
}

interface StoredBlob {
  type: string;
  data: ArrayBuffer;
}

/** Blobs are stored as bytes + type so they round-trip in every environment. */
export async function putBlob(key: string, blob: Blob) {
  const stored: StoredBlob = { type: blob.type, data: await blob.arrayBuffer() };
  await (await db()).put('blobs', stored, key);
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const stored = (await (await db()).get('blobs', key)) as StoredBlob | undefined;
  return stored ? new Blob([stored.data], { type: stored.type }) : undefined;
}

export async function deleteBlob(key: string) {
  await (await db()).delete('blobs', key);
}

export async function addAccess(ev: Omit<AccessEvent, 'id'>) {
  await (await db()).add('access', ev);
}

export const NINETY_DAYS = 90 * 24 * 3600 * 1000;

export async function recentAccess(since: number): Promise<AccessEvent[]> {
  const d = await db();
  return d.getAllFromIndex('access', 'ts', IDBKeyRange.lowerBound(since));
}

export async function addVersion(v: Omit<VersionRef, 'id'>) {
  const d = await db();
  await d.add('versions', v);
  const all = (await d.getAllFromIndex('versions', 'nodeId', v.nodeId)) as VersionRef[];
  all.sort((a, b) => a.ts - b.ts);
  while (all.length > 20) {
    const old = all.shift()!;
    await d.delete('versions', old.id!);
    await d.delete('blobs', old.blobKey);
  }
}

export async function versionsFor(nodeId: Id): Promise<VersionRef[]> {
  const all = (await (await db()).getAllFromIndex('versions', 'nodeId', nodeId)) as VersionRef[];
  return all.sort((a, b) => b.ts - a.ts);
}

export async function putThread(t: Thread) {
  await (await db()).put('threads', t);
}
