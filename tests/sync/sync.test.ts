/**
 * Sync end to end against an in-memory GitHub: connect, sync down, queue edits, flush one commit,
 * and survive a concurrent push from an ingest session (ARCHITECTURE §3–4).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/state/store';
import { listOps } from '../../src/sync/storage';
import { FakeGitHub } from '../helpers/fakeGitHub';
import { loadDemoFiles } from '../helpers/fixtures';

const ref = { owner: 'o', repo: 'r', branch: 'main' };
let gh: FakeGitHub;

beforeEach(async () => {
  gh = new FakeGitHub(loadDemoFiles());
  globalThis.fetch = gh.fetch as typeof fetch;
  await useApp.getState().forgetDevice();
});

async function connectAndWait() {
  await useApp.getState().connect(ref, 'tok', '1234');
  expect(useApp.getState().phase).toBe('ready');
}

describe('sync', () => {
  it('connects, syncs down and builds the model from the repo', async () => {
    await connectAndWait();
    expect(useApp.getState().model!.ds.txns).toHaveLength(414);
    // a second sync with the same head fetches nothing
    const before = gh.requests.length;
    await useApp.getState().syncNow();
    expect(gh.requests.slice(before)).toEqual(['GET /git/ref/heads/main']);
  });

  it('applies an edit optimistically, persists it, and flushes one commit', async () => {
    await connectAndWait();
    await useApp.getState().commit([
      {
        file: 'overrides.csv',
        kind: 'upsert',
        key: { txn_id: 'd6dbffd947156495' },
        row: { category_id: 'groceries', updated_at: '2026-11-25T10:00:00' },
        label: 'recategorise 1 transaction',
      },
    ]);
    const m = useApp.getState().model!;
    expect(m.view.eff.get('d6dbffd947156495')!.categoryId).toBe('groceries');
    expect(await listOps()).toHaveLength(1);

    await useApp.getState().flush();
    expect(await listOps()).toHaveLength(0);
    expect(useApp.getState().ops).toHaveLength(0);
    expect(gh.file('overrides.csv')).toContain('d6dbffd947156495,groceries,');
    expect(gh.commits.get(gh.head)!.message).toMatch(
      /^app: recategorise 1 transaction\n\nDevice: (phone|desktop)$/,
    );
    // still categorised after the round trip
    expect(useApp.getState().model!.view.eff.get('d6dbffd947156495')!.categoryId).toBe('groceries');
  });

  it('loses nothing when an ingest session pushes while an edit is waiting', async () => {
    await connectAndWait();
    await useApp.getState().commit([
      {
        file: 'overrides.csv',
        kind: 'upsert',
        key: { txn_id: 'abc' },
        row: { note: 'mine' },
        label: 'add note',
      },
    ]);
    // push before the flush starts...
    gh.push({
      'events.csv':
        gh.file('events.csv') + 'ev-x,Proposed,trip,proposed,2026-10-01,2026-10-02,,,claude,,2026-11-25\n',
    });
    // ...and race the ref update during it
    gh.beforeNextRefUpdate = () =>
      gh.push({ 'rules.csv': gh.file('rules.csv') + 'r999,999,^NEW,,,,,,groceries,claude,2026-11-25\n' });
    await useApp.getState().flush();

    expect(useApp.getState().sync.state).toBe('idle');
    expect(gh.file('overrides.csv')).toContain('abc,,,mine,');
    expect(gh.file('events.csv')).toContain('ev-x,Proposed');
    expect(gh.file('rules.csv')).toContain('r999,999,^NEW');
    expect(useApp.getState().model!.ds.events.some((e) => e.id === 'ev-x')).toBe(true);
    expect(await listOps()).toHaveLength(0);
  });

  it('keeps edits queued while offline and reports it', async () => {
    await connectAndWait();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    await useApp.getState().commit([
      {
        file: 'overrides.csv',
        kind: 'upsert',
        key: { txn_id: 'abc' },
        row: { excluded: 'true' },
        label: 'exclude',
      },
    ]);
    await useApp.getState().flush();
    expect(useApp.getState().sync.state).toBe('offline');
    expect(await listOps()).toHaveLength(1);
    globalThis.fetch = realFetch;
    await useApp.getState().flush();
    expect(await listOps()).toHaveLength(0);
    expect(gh.file('overrides.csv')).toContain('abc,,,,true,');
  });

  it('locks, then unlocks offline from the cache with the right PIN only', async () => {
    await connectAndWait();
    useApp.getState().lock();
    useApp.setState({ model: null });
    globalThis.fetch = (() => Promise.reject(new TypeError('offline'))) as typeof fetch;
    expect(await useApp.getState().unlock('0000')).toBe(false);
    expect(await useApp.getState().unlock('1234')).toBe(true);
    expect(useApp.getState().phase).toBe('ready');
    expect(useApp.getState().model!.ds.txns).toHaveLength(414);
  });

  it('keeps an offline edit across a reload (SPEC §4.2 AC)', async () => {
    await connectAndWait();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError('offline'))) as typeof fetch;
    const t = useApp.getState().model!.ds.txns.find((x) => x.amount < 0)!;
    await useApp.getState().commit([
      {
        file: 'overrides.csv',
        kind: 'upsert',
        key: { txn_id: t.id },
        row: { category_id: 'gifts' },
        label: 'recategorise transaction',
      },
    ]);
    // "reload": drop all in-memory state and boot again from IndexedDB, still offline
    useApp.getState().lock();
    useApp.setState({ phase: 'boot', model: null, ops: [], base: new Map() });
    vi.stubGlobal('window', { location: { search: '' } });
    await useApp.getState().boot();
    vi.unstubAllGlobals();
    expect(useApp.getState().phase).toBe('locked');
    expect(await useApp.getState().unlock('1234')).toBe(true);
    expect(useApp.getState().ops).toHaveLength(1);
    expect(useApp.getState().model!.view.eff.get(t.id)!.categoryId).toBe('gifts');
    // back online: the edit reaches the repo
    globalThis.fetch = realFetch;
    await useApp.getState().flush();
    expect(gh.file('overrides.csv')).toContain(`${t.id},gifts,`);
  });
});
