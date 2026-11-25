/** Sync down (ARCHITECTURE §3): ref → tree → changed blobs → IndexedDB. */
import type { FileMap } from '../core/dataset';
import { isDataPath, type GitHub } from './github';
import { getHeadSha, readAllFiles, writeFiles, type CachedFile } from './storage';

export interface SyncDownResult {
  changed: boolean;
  head: string;
  files: FileMap;
  fetched: number;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function toFileMap(files: CachedFile[]): FileMap {
  return Object.fromEntries(files.map((f) => [f.path, f.text]));
}

export async function syncDown(gh: GitHub, now: () => string): Promise<SyncDownResult> {
  const [head, cachedHead, cached] = await Promise.all([gh.getHeadSha(), getHeadSha(), readAllFiles()]);
  if (head === cachedHead && cached.length) {
    return { changed: false, head, files: toFileMap(cached), fetched: 0 };
  }
  const tree = await gh.getTree(head);
  if (tree.truncated) throw new Error('The data repo is too large to list in one request.');
  const wanted = tree.tree.filter((e) => e.type === 'blob' && isDataPath(e.path));
  const byPath = new Map(cached.map((f) => [f.path, f]));
  const stale = wanted.filter((e) => byPath.get(e.path)?.sha !== e.sha);
  const fresh = await pool(stale, 6, async (e) => ({
    path: e.path,
    sha: e.sha,
    text: await gh.getBlobText(e.sha),
  }));
  const wantedPaths = new Set(wanted.map((e) => e.path));
  const deletes = cached.filter((f) => !wantedPaths.has(f.path)).map((f) => f.path);
  await writeFiles(fresh, deletes, head, now());
  for (const f of fresh) byPath.set(f.path, f);
  for (const p of deletes) byPath.delete(p);
  return { changed: true, head, files: toFileMap([...byPath.values()]), fetched: fresh.length };
}
