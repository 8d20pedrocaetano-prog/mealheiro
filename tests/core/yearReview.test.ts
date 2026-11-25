/** Year in review (M6): figures reconcile with the golden month summary; like-for-like comparison only. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTables } from '../../src/core/dataset';
import { buildModel } from '../../src/core/model';
import { parseMoney } from '../../src/core/money';
import { merchantKey } from '../../src/core/normalize';
import { parseSettings } from '../../src/core/schema';
import { reviewYears, yearReview } from '../../src/core/yearReview';
import { loadDemoFiles } from '../helpers/fixtures';
import { syntheticRepo } from '../helpers/synthetic';

const golden = JSON.parse(readFileSync('fixtures/golden/monthly-summary.json', 'utf8')) as Record<
  string,
  Record<string, string>
>;

function model(files: Record<string, string>) {
  return buildModel(parseTables(files), parseSettings(files['settings.json']), '2026-10-31');
}

describe('year in review', () => {
  const m = model(loadDemoFiles());

  it('adds up to the golden month summary', () => {
    const r = yearReview(m, '2026');
    let income = 0;
    let spend = 0;
    const groups = new Map<string, number>();
    for (const [ym, b] of Object.entries(golden)) {
      if (!ym.startsWith('2026')) continue;
      for (const [k, v] of Object.entries(b)) {
        if (k === 'income') income += parseMoney(v);
        else if (k.startsWith('spend:')) {
          spend += parseMoney(v);
          groups.set(k.slice(6), (groups.get(k.slice(6)) ?? 0) - parseMoney(v));
        }
      }
    }
    expect(r.months.map((x) => x.month)).toEqual(Object.keys(golden).filter((k) => k.startsWith('2026')));
    expect(r.totals.income).toBe(income);
    expect(r.totals.spent).toBe(-spend);
    expect(r.totals.saved).toBe(income + spend);
    expect(r.groups.reduce((s, g) => s + g.spent, 0)).toBe(-spend);
    for (const g of r.groups) expect(g.spent).toBe(groups.get(g.group));
    expect(r.partial).toBe(true);
    expect(r.to).toBe('2026-10-31');
  });

  it('has no comparison without the same months a year earlier, and picks best and hardest month', () => {
    const r = yearReview(m, '2026');
    expect(r.prev).toBeNull();
    expect(r.groups.every((g) => g.prev === null)).toBe(true);
    const saved = r.months.map((x) => x.saved);
    expect(r.best!.saved).toBe(Math.max(...saved));
    expect(r.worst!.saved).toBe(Math.min(...saved));
  });

  it('lists confirmed trips only, and the biggest one-off expenses', () => {
    const r = yearReview(m, '2026');
    expect(r.trips.map((t) => t.event.id)).toEqual(['ev-edinburgh', 'ev-porto']);
    expect(r.biggest).toHaveLength(5);
    expect(r.biggest.every((l) => !m.recurring.has(merchantKey(l.txn.descNorm)))).toBe(true);
    for (let i = 1; i < r.biggest.length; i++)
      expect(r.biggest[i].amount).toBeGreaterThanOrEqual(r.biggest[i - 1].amount);
    expect(r.merchants.length).toBeLessThanOrEqual(10);
  });

  it('compares like for like when the earlier year has the same months', () => {
    const s = model(syntheticRepo(3, 600));
    expect(reviewYears(s)).toEqual(['2026', '2025', '2024']);
    const r = yearReview(s, '2026');
    const prev = yearReview(s, '2025');
    expect(r.prev).not.toBeNull();
    // 2026 runs to October here, so 2025 is compared over January to October only
    expect(r.prev!.from).toBe('2025-01-01');
    expect(r.prev!.to).toBe('2025-10-31');
    const janOct = prev.months.filter((x) => x.month <= '2025-10');
    expect(r.prev!.spent).toBe(janOct.reduce((a, x) => a + x.spent, 0));
    expect(prev.partial).toBe(false);
    expect(prev.prev!.income).toBe(yearReview(s, '2024').totals.income);
  });
});
