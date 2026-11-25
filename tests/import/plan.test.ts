import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTables, loadDataSet } from '../../src/core/dataset';
import { parseCgd } from '../../src/import/cgd';
import { importOp, planImport } from '../../src/import/plan';
import { applyOps, serializePath, type Op } from '../../src/sync/ops';
import { loadDemoFiles } from '../helpers/fixtures';
import { pdfItems } from '../helpers/pdfItems';
import { parseCsv, serializeCsv } from '../../src/core/csv';
import { buildDataSet } from '../../src/core/dataset';
import { parseSettings } from '../../src/core/schema';

const SHA = '5da821979845d593260c73d34a9ddbd3957d1fc694c4d57c22f0d9aab5b32789';
const WHEN = new Date(2026, 10, 15, 20, 10, 4); // the demo import's timestamp

async function statement() {
  const { pages } = await pdfItems('fixtures/cgd/synthetic-statement.pdf');
  return parseCgd(pages, 'cgd-main');
}

/** The demo repo before its statement was ingested: no month files, an empty imports.csv. */
function emptyRepo() {
  const files = loadDemoFiles();
  for (const k of Object.keys(files)) if (k.startsWith('transactions/')) delete files[k];
  files['imports.csv'] = files['imports.csv'].split('\n')[0] + '\n';
  return files;
}

const withId = (op: Omit<Op, 'id' | 'at'>, id = 'op1'): Op => ({ ...op, id, at: '2026-11-25T10:00:00' });

describe('import plan and the append-only import op (DATA_MODEL §4, SPEC §4.8)', () => {
  it('re-importing the demo statement adds nothing', async () => {
    const ds = loadDataSet(loadDemoFiles());
    const plan = planImport(ds, await statement(), { name: 'x.pdf', sha256: SHA });
    expect(plan.alreadyImported?.id).toBe('imp-20261115-201004');
    expect(plan.newRows).toHaveLength(0);
    expect(plan.duplicates).toBe(412);
  });

  it('a renamed copy (different sha) still adds nothing: every id exists', async () => {
    const tables = parseTables(loadDemoFiles());
    const ds = loadDataSet(loadDemoFiles());
    const plan = planImport(ds, await statement(), { name: 'copy.pdf', sha256: 'f'.repeat(64) });
    expect(plan.alreadyImported).toBeNull();
    expect(plan.newRows).toHaveLength(0);
    const after = applyOps(tables, [withId(importOp(plan, 'app-phone', new Date(2026, 10, 25, 9, 0, 0)))]);
    for (const [p, t] of tables) if (p.startsWith('transactions/')) expect(after.get(p)).toBe(t);
    const log = after.get('imports.csv')!.rows;
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ rows_in_file: '412', rows_added: '0', rows_duplicate: '412' });
  });

  it('into an empty repo it writes month files identical to what mh.py ingest wrote', async () => {
    const files = emptyRepo();
    const ds = loadDataSet(files);
    const plan = planImport(ds, await statement(), {
      name: 'synthetic-statement.pdf',
      sha256: SHA,
    });
    expect(plan.newRows).toHaveLength(412);
    expect(plan.gap).toBeNull();
    const after = applyOps(parseTables(files), [withId(importOp(plan, 'demo', WHEN))]);
    const demo = loadDemoFiles();
    const months = Object.keys(demo).filter((k) => k.startsWith('transactions/'));
    expect(months.length).toBe(10);
    for (const p of months) expect(serializePath(after.get(p)!, p)).toBe(demo[p]);
    expect(serializePath(after.get('imports.csv')!, 'imports.csv')).toBe(demo['imports.csv']);

    // applying the same op again (a retry after a conflict) changes nothing
    const again = applyOps(after, [withId(importOp(plan, 'demo', WHEN), 'op2')]);
    for (const p of [...months, 'imports.csv']) expect(again.get(p)).toBe(after.get(p));
  });

  it('an overlapping later statement adds only the rows that are new', async () => {
    const s = await statement();
    const files = emptyRepo();
    // first import: January to June
    const firstHalf = {
      ...s,
      rows: s.rows.filter((r) => r.booking_date < '2026-07-01'),
      periodEnd: '2026-06-30',
    };
    const p1 = planImport(loadDataSet(files), firstHalf, { name: 'a.pdf', sha256: 'a'.repeat(64) });
    const t1 = applyOps(parseTables(files), [withId(importOp(p1, 'app-phone', WHEN))]);
    // second import: the whole year, overlapping
    const ds2 = buildDataSet(t1, parseSettings(files['settings.json']));
    const p2 = planImport(ds2, s, { name: 'b.pdf', sha256: 'b'.repeat(64) });
    expect(p2.duplicates).toBe(firstHalf.rows.length);
    expect(p2.newRows.length).toBe(412 - firstHalf.rows.length);
    expect(p2.gap).toBeNull();
    const t2 = applyOps(t1, [withId(importOp(p2, 'app-phone', new Date(2026, 10, 20, 9, 0, 0)), 'op2')]);
    const ids = [...t2]
      .filter(([p]) => p.startsWith('transactions/'))
      .flatMap(([, t]) => t.rows.map((r) => r.id));
    expect(ids).toHaveLength(412);
    expect(new Set(ids).size).toBe(412);
    // rows from the first import are untouched
    for (const [p, t] of t1)
      if (p.startsWith('transactions/2026/2026-0') && p < 'transactions/2026/2026-06')
        expect(t2.get(p)).toBe(t);
  });

  it('warns about a gap when the first new row does not continue an earlier balance', async () => {
    const s = await statement();
    const files = emptyRepo();
    const early = { ...s, rows: s.rows.filter((r) => r.booking_date < '2026-04-01') };
    const t1 = applyOps(parseTables(files), [
      withId(
        importOp(planImport(loadDataSet(files), early, { name: 'a.pdf', sha256: 'a'.repeat(64) }), 'x', WHEN),
      ),
    ]);
    const late = { ...s, rows: s.rows.filter((r) => r.booking_date >= '2026-06-01') };
    const p = planImport(buildDataSet(t1, parseSettings(files['settings.json'])), late, {
      name: 'b.pdf',
      sha256: 'b'.repeat(64),
    });
    expect(p.gap).toMatch(/^GAP\? opening balance/);
    expect(importOp(p, 'x', WHEN).row!.checks).toMatch(/^ok; GAP\?/);
  });

  it('serialising a month file gives back the same bytes (existing rows are never rewritten)', () => {
    const demo = loadDemoFiles();
    for (const [p, text] of Object.entries(demo)) {
      if (!p.startsWith('transactions/')) continue;
      const t = parseCsv(text);
      expect(serializeCsv(t.header, t.rows)).toBe(text);
    }
    expect(readFileSync('fixtures/cgd/expected.csv', 'utf8').startsWith('id,')).toBe(true);
  });
});
