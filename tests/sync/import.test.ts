/** The in-app import through the pending-ops queue to one commit (SPEC §4.8, ARCHITECTURE §4). */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseCgd } from '../../src/import/cgd';
import { importOp, planImport } from '../../src/import/plan';
import { useApp } from '../../src/state/store';
import { listOps } from '../../src/sync/storage';
import { FakeGitHub } from '../helpers/fakeGitHub';
import { loadDemoFiles } from '../helpers/fixtures';
import { pdfItems } from '../helpers/pdfItems';

const ref = { owner: 'o', repo: 'r', branch: 'main' };
const SHA = '5da821979845d593260c73d34a9ddbd3957d1fc694c4d57c22f0d9aab5b32789';
let gh: FakeGitHub;
let demo: Record<string, string>;

function emptyRepo() {
  const files = loadDemoFiles();
  for (const k of Object.keys(files)) if (k.startsWith('transactions/')) delete files[k];
  files['imports.csv'] = files['imports.csv'].split('\n')[0] + '\n';
  return files;
}

beforeEach(async () => {
  demo = loadDemoFiles();
  gh = new FakeGitHub(emptyRepo());
  globalThis.fetch = gh.fetch as typeof fetch;
  await useApp.getState().forgetDevice();
  await useApp.getState().connect(ref, 'tok', '1234');
});

async function plan() {
  const { pages } = await pdfItems('fixtures/cgd/synthetic-statement.pdf');
  const s = await parseCgd(pages, 'cgd-main');
  return planImport(useApp.getState().model!.ds, s, { name: 'synthetic-statement.pdf', sha256: SHA });
}

describe('in-app import sync', () => {
  it('queues the import, shows the rows at once, and pushes month files + imports.csv in one commit', async () => {
    expect(useApp.getState().model!.ds.txns).toHaveLength(2); // the two manual entries
    const p = await plan();
    await useApp.getState().commit([importOp(p, 'app-desktop', new Date(2026, 10, 15, 20, 10, 4))]);
    expect(useApp.getState().model!.ds.txns).toHaveLength(414);
    expect(await listOps()).toHaveLength(1);

    const commitsBefore = gh.commits.size;
    await useApp.getState().flush();
    expect(await listOps()).toHaveLength(0);
    expect(gh.commits.size).toBe(commitsBefore + 1);
    expect(gh.commits.get(gh.head)!.message).toMatch(/^app: import 412 transactions\n/);
    expect(gh.file('transactions/2026/2026-03.csv')).toBe(demo['transactions/2026/2026-03.csv']);
    expect(gh.file('imports.csv')).toContain(
      `,${SHA},2026-01-01,2026-10-31,412,412,0,5552.92,ok,app-desktop`,
    );
    expect(useApp.getState().model!.ds.txns).toHaveLength(414);
  });

  it('writes nothing when an ingest session pushed the same statement first', async () => {
    const p = await plan();
    await useApp.getState().commit([importOp(p, 'app-phone', new Date(2026, 10, 25, 9, 0, 0))]);
    const months = Object.fromEntries(Object.entries(demo).filter(([k]) => k.startsWith('transactions/')));
    gh.push({ ...months, 'imports.csv': demo['imports.csv'] });
    const head = gh.head;
    await useApp.getState().flush();
    expect(gh.head).toBe(head);
    expect(await listOps()).toHaveLength(0);
    expect(useApp.getState().model!.ds.txns).toHaveLength(414);
    expect(useApp.getState().sync.state).toBe('idle');
  });

  it('refuses to write transactions through a plain edit', async () => {
    await expect(
      useApp
        .getState()
        .commit([
          { file: 'imports.csv', kind: 'upsert', key: { id: 'x' }, row: { by: 'me' }, label: 'nope' },
        ]),
    ).rejects.toThrow(/may not write imports.csv/);
  });
});
