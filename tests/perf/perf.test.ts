/** Performance pass (SPEC §7): recompute a 10-year, 10,000-row repo; log the timings. */
import { describe, expect, it } from 'vitest';
import { budgetStatuses } from '../../src/core/budgets';
import { parseTables, type FileMap } from '../../src/core/dataset';
import { buildModel } from '../../src/core/model';
import { reviewCards } from '../../src/core/review';
import { parseSettings } from '../../src/core/schema';
import { syntheticRepo } from '../helpers/synthetic';

function time<T>(f: () => T): [T, number] {
  const t0 = performance.now();
  const r = f();
  return [r, performance.now() - t0];
}

describe('performance (10 years × 1,000 transactions)', () => {
  const files: FileMap = syntheticRepo();
  it('parses and recomputes well within budget', () => {
    const [tables, parseMs] = time(() => parseTables(files));
    const settings = parseSettings(files['settings.json']);
    buildModel(tables, settings, '2026-10-31'); // warm up the JIT
    const [m, buildMs] = time(() => buildModel(tables, settings, '2026-10-31'));
    const [, reviewMs] = time(() => reviewCards(m));
    const [, budgetMs] = time(() => budgetStatuses(m.view, m.lines, '2026-10', m.today));
    console.log(
      `txns=${m.ds.txns.length} parse=${parseMs.toFixed(0)}ms model=${buildMs.toFixed(0)}ms review=${reviewMs.toFixed(0)}ms budgets=${budgetMs.toFixed(0)}ms`,
    );
    expect(m.ds.txns.length).toBe(10002);
    // generous bounds for slow CI runners; the logged numbers are what matter
    expect(buildMs).toBeLessThan(2000);
  });
});

describe('pairs index', () => {
  it('gives the same suggestions as the full scan of mh.py cmd_pairs', async () => {
    const { suggestPairs, PAYBACK_TARGET_CATEGORIES } = await import('../../src/core/pairs');
    const { daysBetween } = await import('../../src/core/dates');
    const { effOf } = await import('../../src/core/view');
    const files = syntheticRepo(2, 1000);
    const m = buildModel(parseTables(files), parseSettings(files['settings.json']), '2026-10-31');
    const txns = m.ds.txns.filter((t) => !t.manual);
    const cat = (t: (typeof txns)[number]) => effOf(m.view, t).categoryId;
    const naive = txns
      .filter((t) => t.amount > 0 && cat(t) === 'people-in')
      .flatMap((t) => {
        const exact = txns.find(
          (o) => o.amount === -t.amount && Math.abs(daysBetween(t.value_date, o.value_date)) <= 1,
        );
        if (exact) return [`P ${t.id} ${exact.id}`];
        let best: (typeof txns)[number] | null = null;
        for (const o of txns) {
          const d = daysBetween(o.value_date, t.value_date);
          if (2 * o.amount <= -3 * t.amount && d >= 0 && d <= 3 && PAYBACK_TARGET_CATEGORIES.has(cat(o)))
            if (!best || -o.amount > -best.amount) best = o;
        }
        return best ? [`B ${t.id} ${best.id}`] : [];
      });
    const fast = suggestPairs(m.ds, m.view).map(
      (p) => `${p.type === 'pass-through' ? 'P' : 'B'} ${p.incoming.id} ${p.other.id}`,
    );
    expect(naive.length).toBeGreaterThan(5);
    expect(fast).toEqual(naive);
  });
});
