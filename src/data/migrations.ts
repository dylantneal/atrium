import type { IDBPDatabase, IDBPTransaction } from 'idb';

export type Upgrade = (db: IDBPDatabase<any>, tx: IDBPTransaction<any, any, 'versionchange'>) => void;

/** Ordered list; entry i upgrades from version i to i+1. */
export const UPGRADES: Upgrade[] = [
  // v0 -> v1: create every store.
  (db) => {
    const nodes = db.createObjectStore('nodes', { keyPath: 'id' });
    nodes.createIndex('parent', 'parent');
    nodes.createIndex('fingerprint', 'fingerprint');
    nodes.createIndex('kind', 'kind');
    db.createObjectStore('rooms', { keyPath: 'id' });
    db.createObjectStore('blobs');
    const threads = db.createObjectStore('threads', { keyPath: 'id' });
    threads.createIndex('a', 'a');
    threads.createIndex('b', 'b');
    db.createObjectStore('inventory');
    const versions = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
    versions.createIndex('nodeId', 'nodeId');
    const access = db.createObjectStore('access', { keyPath: 'id', autoIncrement: true });
    access.createIndex('nodeId', 'nodeId');
    access.createIndex('ts', 'ts');
    db.createObjectStore('thumbs');
    db.createObjectStore('settings');
    db.createObjectStore('searchindex');
  },
];

export const LATEST_VERSION = UPGRADES.length;

export function runUpgrades(
  db: IDBPDatabase<any>,
  oldVersion: number,
  tx: IDBPTransaction<any, any, 'versionchange'>,
) {
  for (let v = oldVersion; v < UPGRADES.length; v++) UPGRADES[v](db, tx);
}
