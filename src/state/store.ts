/**
 * App state: where the data comes from (demo or the GitHub data repo), the lock, the base files,
 * pending ops, the computed model and the sync status.
 */
import { create } from 'zustand';
import type { CsvTable } from '../core/csv';
import { parseTables, type FileMap } from '../core/dataset';
import { nowLocalTimestamp, todayIso } from '../core/dates';
import { buildModel, type Model } from '../core/model';
import { parseSettings, type RootFile, type Settings, APP_WRITABLE } from '../core/schema';
import { isValidPin, seal, unseal } from '../sync/crypto';
import { GitHub, GitHubError, type RepoRef } from '../sync/github';
import { applyOps, applyOp, commitMessage, serializeTable, type Op } from '../sync/ops';
import {
  addOp,
  getConnection,
  getHeadSha,
  getLastSync,
  getSealedToken,
  listOps,
  readAllFiles,
  removeOps,
  saveConnection,
  wipeDevice,
  writeFiles,
  type StoredOp,
} from '../sync/storage';
import { syncDown, toFileMap } from '../sync/syncDown';

export type Source = { kind: 'demo' } | ({ kind: 'github' } & RepoRef);

export type Phase = 'boot' | 'connect' | 'locked' | 'loading' | 'ready' | 'error';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

interface AppState {
  phase: Phase;
  source: Source | null;
  error: string | null;
  /** Base tables as of the last sync (or the demo files). */
  base: Map<string, CsvTable>;
  settings: Settings;
  ops: Op[];
  model: Model | null;
  sync: { state: SyncState; lastSync: string | null; error: string | null };

  boot: () => Promise<void>;
  startDemo: () => Promise<void>;
  connect: (ref: RepoRef, token: string, pin: string) => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
  leaveDemo: () => void;
  forgetDevice: () => Promise<void>;
  syncNow: () => Promise<void>;
  /** Records edits: persisted first, then applied optimistically, then flushed in the background. */
  commit: (ops: Omit<Op, 'id' | 'at'>[]) => Promise<void>;
  flush: () => Promise<void>;
}

/** The decrypted token lives only in memory while unlocked (never in the store or storage). */
let session: { gh: GitHub } | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

function today(source: Source | null): string {
  return source?.kind === 'demo' ? DEMO_TODAY_CACHE : todayIso();
}
let DEMO_TODAY_CACHE = todayIso();

function recompute(base: Map<string, CsvTable>, settings: Settings, ops: Op[], source: Source | null): Model {
  return buildModel(applyOps(base, ops), settings, today(source));
}

const device = (): 'phone' | 'desktop' =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop';

function toOp(s: StoredOp): Op {
  return {
    id: s.id,
    file: s.file as RootFile,
    kind: s.kind,
    key: s.key,
    row: s.row,
    at: s.at,
    label: s.label,
  };
}

export const useApp = create<AppState>((set, get) => {
  function setFiles(files: FileMap, ops = get().ops) {
    const base = parseTables(files);
    const settings = parseSettings(files['settings.json']);
    set({ base, settings, ops, model: recompute(base, settings, ops, get().source) });
  }

  function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  function scheduleFlush(ms = 3000) {
    if (get().source?.kind !== 'github') return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void get().flush(), ms);
  }

  return {
    phase: 'boot',
    source: null,
    error: null,
    base: new Map(),
    settings: parseSettings(undefined),
    ops: [],
    model: null,
    sync: { state: 'idle', lastSync: null, error: null },

    async boot() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('demo') === '1') return get().startDemo();
      try {
        const c = await getConnection();
        if (c) {
          set({
            phase: 'locked',
            source: { kind: 'github', owner: c.owner, repo: c.repo, branch: c.branch },
          });
          return;
        }
      } catch {
        /* IndexedDB unavailable (private window): fall through to connect */
      }
      set({ phase: 'connect' });
    },

    async startDemo() {
      set({ source: { kind: 'demo' }, phase: 'loading', error: null, ops: [] });
      try {
        const { demoFiles, DEMO_TODAY } = await import('../demo/files');
        DEMO_TODAY_CACHE = DEMO_TODAY;
        setFiles(demoFiles, []);
        set({ phase: 'ready', sync: { state: 'idle', lastSync: null, error: null } });
      } catch (e) {
        set({ phase: 'error', error: errMsg(e) });
      }
    },

    async connect(ref, token, pin) {
      if (!isValidPin(pin)) throw new Error('The PIN must be 4 to 6 digits.');
      const gh = new GitHub(token, ref);
      const sealed = await seal(token, pin);
      await saveConnection({ ...ref, connectedAt: nowLocalTimestamp(), pinLength: pin.length }, sealed);
      session = { gh };
      set({ source: { kind: 'github', ...ref }, phase: 'loading', error: null });
      try {
        const r = await syncDown(gh, nowLocalTimestamp);
        setFiles(r.files, []);
        set({ phase: 'ready', sync: { state: 'idle', lastSync: nowLocalTimestamp(), error: null } });
        void navigator.storage?.persist?.();
      } catch (e) {
        set({ phase: 'error', error: errMsg(e) });
      }
    },

    async unlock(pin) {
      const sealed = await getSealedToken();
      const c = await getConnection();
      if (!sealed || !c) {
        set({ phase: 'connect' });
        return false;
      }
      const token = await unseal(sealed, pin);
      if (token === null) return false;
      const ref = { owner: c.owner, repo: c.repo, branch: c.branch };
      session = { gh: new GitHub(token, ref) };
      // Offline-first: open with the cached files and queued ops, then sync in the background.
      if (!get().model) {
        const [files, stored, lastSync] = await Promise.all([readAllFiles(), listOps(), getLastSync()]);
        const ops = stored.map(toOp);
        if (files.length) {
          setFiles(toFileMap(files), ops);
          set({ phase: 'ready', sync: { state: 'idle', lastSync: lastSync ?? null, error: null } });
        } else {
          set({ phase: 'loading', ops });
        }
      } else {
        set({ phase: 'ready' });
      }
      void get()
        .syncNow()
        .then(() => {
          if (get().phase === 'loading' && !get().model) set({ phase: 'error', error: get().sync.error });
        });
      if (get().ops.length) scheduleFlush(500);
      return true;
    },

    lock() {
      if (get().source?.kind !== 'github') return;
      session = null;
      set({ phase: 'locked' });
    },

    leaveDemo() {
      set({ source: null, phase: 'connect', model: null, base: new Map(), ops: [] });
    },

    async forgetDevice() {
      session = null;
      await wipeDevice();
      set({ source: null, phase: 'connect', model: null, base: new Map(), ops: [], error: null });
    },

    async syncNow() {
      if (get().source?.kind !== 'github' || !session) return;
      if (flushing) await flushing;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        set((s) => ({ sync: { ...s.sync, state: 'offline' } }));
        return;
      }
      set((s) => ({ sync: { ...s.sync, state: 'syncing', error: null } }));
      try {
        const r = await syncDown(session.gh, nowLocalTimestamp);
        if (r.changed || !get().model) setFiles(r.files);
        set({ phase: 'ready', sync: { state: 'idle', lastSync: nowLocalTimestamp(), error: null } });
        if (get().ops.length) scheduleFlush(500);
      } catch (e) {
        const offline = e instanceof GitHubError && e.status === 0;
        set((s) => ({ sync: { ...s.sync, state: offline ? 'offline' : 'error', error: errMsg(e) } }));
      }
    },

    async commit(partial) {
      // File ownership (DATA_MODEL §2): the app writes only user-owned root files, never transactions/**.
      const bad = partial.find((p) => !APP_WRITABLE.includes(p.file));
      if (bad) throw new Error(`The app may not write ${bad.file}`);
      const at = nowLocalTimestamp();
      const ops: Op[] = partial.map((p) => ({ ...p, id: crypto.randomUUID(), at }));
      if (get().source?.kind === 'github') {
        for (const op of ops) await addOp({ ...op });
      }
      const all = [...get().ops, ...ops];
      set({ ops: all, model: recompute(get().base, get().settings, all, get().source) });
      scheduleFlush();
    },

    async flush() {
      if (flushing) return flushing;
      if (get().source?.kind !== 'github' || !session) return;
      const gh = session.gh;
      flushing = (async () => {
        set((s) => ({ sync: { ...s.sync, state: 'syncing', error: null } }));
        try {
          for (let attempt = 0; attempt < 4; attempt++) {
            const stored = await listOps();
            if (!stored.length) break;
            // Base = the repo as it is now (an ingest session may have pushed since our last sync).
            const remoteHead = await gh.getHeadSha();
            if (remoteHead !== (await getHeadSha())) {
              const r = await syncDown(gh, nowLocalTimestamp);
              setFiles(r.files);
            }
            const head = remoteHead;
            const files = toFileMap(await readAllFiles());
            let tables = parseTables(files);
            const ops = stored.map(toOp);
            const touched = new Set<RootFile>();
            for (const op of ops) {
              tables = new Map(tables).set(op.file, applyOp(tables.get(op.file), op));
              touched.add(op.file);
            }
            const changed = [...touched].map((f) => ({ path: f, text: serializeTable(tables.get(f)!, f) }));
            try {
              const blobs = await Promise.all(
                changed.map(async (c) => ({ ...c, sha: await gh.createBlob(c.text) })),
              );
              const baseTree = await gh.getCommitTreeSha(head);
              const tree = await gh.createTree(
                baseTree,
                blobs.map((b) => ({ path: b.path, sha: b.sha })),
              );
              const commitSha = await gh.createCommit(commitMessage(ops, device()), tree, head);
              await gh.updateRef(commitSha);
              await writeFiles(blobs, [], commitSha, nowLocalTimestamp());
              await removeOps(stored.map((s) => s.seq!));
              const flushedIds = new Set(ops.map((o) => o.id));
              const remaining = get().ops.filter((o) => !flushedIds.has(o.id));
              const newFiles = { ...files };
              for (const b of blobs) newFiles[b.path] = b.text;
              setFiles(newFiles, remaining);
              set({ sync: { state: 'idle', lastSync: nowLocalTimestamp(), error: null } });
              if (remaining.length) scheduleFlush(500);
              return;
            } catch (e) {
              // 422: the ref moved under us (an ingest session pushed). Re-sync and re-apply.
              if (e instanceof GitHubError && (e.status === 422 || e.status === 409) && attempt < 3) {
                await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
                continue;
              }
              throw e;
            }
          }
          set((s) => ({ sync: { ...s.sync, state: 'idle', error: null } }));
        } catch (e) {
          const offline = e instanceof GitHubError && e.status === 0;
          set((s) => ({ sync: { ...s.sync, state: offline ? 'offline' : 'error', error: errMsg(e) } }));
        } finally {
          flushing = null;
        }
      })();
      return flushing;
    },
  };
});

export function useModel(): Model {
  const m = useApp((s) => s.model);
  if (!m) throw new Error('model not loaded');
  return m;
}

/** Test connection: the repo exists, the token can see it, and it is private. */
export async function testConnection(ref: RepoRef, token: string) {
  const gh = new GitHub(token, ref);
  const repo = await gh.getRepo();
  await gh.getHeadSha();
  return repo;
}
