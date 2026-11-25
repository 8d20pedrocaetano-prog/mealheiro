/**
 * Local persistence in IndexedDB (ARCHITECTURE §3, §5): raw files by path + blob sha, small key/values
 * (config, head sha, sealed token), and the pending-ops queue. All reads come from here, so the app
 * opens offline with the last synced data.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SealedSecret } from './crypto';
import type { RepoRef } from './github';

export interface CachedFile {
  path: string;
  sha: string;
  text: string;
}

export interface StoredOp {
  seq?: number;
  id: string;
  file: string;
  kind: 'upsert' | 'delete' | 'import';
  key: Record<string, string>;
  row?: Record<string, string>;
  at: string;
  label: string;
  /** `import` ops carry the statement rows. */
  txns?: Record<string, string>[];
}

interface Schema extends DBSchema {
  kv: { key: string; value: unknown };
  files: { key: string; value: CachedFile };
  ops: { key: number; value: StoredOp };
}

const DB_NAME = 'mealheiro';
let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbp) {
    dbp = openDB<Schema>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore('kv');
        d.createObjectStore('files', { keyPath: 'path' });
        d.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true });
      },
    });
  }
  return dbp;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}

export interface Connection extends RepoRef {
  connectedAt: string;
  /** Lets the lock screen unlock as soon as enough digits are typed. */
  pinLength: number;
}

export const getConnection = () => kvGet<Connection>('connection');
export const getSealedToken = () => kvGet<SealedSecret>('token');
export const getHeadSha = () => kvGet<string>('headSha');
export const getLastSync = () => kvGet<string>('lastSync');

export async function saveConnection(c: Connection, token: SealedSecret): Promise<void> {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  await tx.store.put(c, 'connection');
  await tx.store.put(token, 'token');
  await tx.done;
}

export async function readAllFiles(): Promise<CachedFile[]> {
  return (await db()).getAll('files');
}

/** Replaces the cached file set in one transaction, together with the head sha it came from. */
export async function writeFiles(
  upserts: CachedFile[],
  deletes: string[],
  headSha: string,
  syncedAt: string,
): Promise<void> {
  const d = await db();
  const tx = d.transaction(['files', 'kv'], 'readwrite');
  for (const f of upserts) await tx.objectStore('files').put(f);
  for (const p of deletes) await tx.objectStore('files').delete(p);
  await tx.objectStore('kv').put(headSha, 'headSha');
  await tx.objectStore('kv').put(syncedAt, 'lastSync');
  await tx.done;
}

export async function addOp(op: StoredOp): Promise<number> {
  return (await db()).add('ops', op);
}

export async function listOps(): Promise<StoredOp[]> {
  return (await db()).getAll('ops');
}

export async function removeOps(seqs: number[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('ops', 'readwrite');
  for (const s of seqs) await tx.store.delete(s);
  await tx.done;
}

/** "Forgot PIN" / "Wipe this device": clears IndexedDB, caches and the service worker. */
export async function wipeDevice(): Promise<void> {
  if (dbp) {
    (await dbp).close();
    dbp = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  if ('caches' in globalThis) {
    for (const k of await caches.keys()) await caches.delete(k);
  }
  if ('serviceWorker' in navigator) {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  }
}
